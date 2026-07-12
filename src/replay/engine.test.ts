import { describe, expect, it } from "vitest";

import {
  isReplayEvent,
  REPLAY_PROTOCOL_VERSION,
  type ReplayCommand,
  type ReplayEvent,
  type ReplaySnapshotEvent,
  type ReplaySpeed,
} from "./protocol";
import { ReplayEngine } from "./engine";
import { createDemoReplaySource, type ReplaySource } from "./source";

interface ScheduledTask {
  id: number;
  task: () => void;
  canceled: boolean;
}

class FakeScheduler {
  readonly tasks: ScheduledTask[] = [];
  private nextId = 1;

  schedule = (task: () => void) => {
    const scheduled = { id: this.nextId, task, canceled: false };
    this.nextId += 1;
    this.tasks.push(scheduled);
    return scheduled.id;
  };

  cancel = (handle: unknown) => {
    const task = this.tasks.find((candidate) => candidate.id === handle);
    if (task) task.canceled = true;
  };

  runNext() {
    while (this.tasks.length > 0) {
      const scheduled = this.tasks.shift() as ScheduledTask;
      if (scheduled.canceled) continue;
      scheduled.task();
      return scheduled;
    }
    throw new Error("No replay pulse is scheduled.");
  }
}

type CommandInput = ReplayCommand extends infer Command
  ? Command extends ReplayCommand
    ? Omit<Command, "protocolVersion">
    : never
  : never;

function command(value: CommandInput) {
  return {
    ...value,
    protocolVersion: REPLAY_PROTOCOL_VERSION,
  } as ReplayCommand;
}

function createHarness() {
  const events: ReplayEvent[] = [];
  const scheduler = new FakeScheduler();
  const engine = new ReplayEngine({
    emit: (event) => events.push(event),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  return { engine, events, scheduler };
}

function load(
  harness: ReturnType<typeof createHarness>,
  source: ReplaySource = createDemoReplaySource(),
  replaySeed = 99,
) {
  harness.engine.handle(command({ type: "LOAD", source, replaySeed }));
}

function eventsOfType<Type extends ReplayEvent["type"]>(
  events: ReplayEvent[],
  type: Type,
) {
  return events.filter(
    (event): event is Extract<ReplayEvent, { type: Type }> => event.type === type,
  );
}

function bytes(snapshot: ReplaySnapshotEvent) {
  return [...new Uint8Array(snapshot.positions.buffer)];
}

describe("ReplayEngine", () => {
  it("loads paused with a stable mapping and canonical step-zero snapshot", () => {
    const harness = createHarness();
    const source = createDemoReplaySource();
    load(harness, source, 123);

    expect(harness.engine.getStatus()).toBe("paused");
    expect(harness.engine.getEpisodeId()).toBe(1);
    expect(harness.events.map((event) => event.type)).toEqual([
      "MAPPING",
      "SNAPSHOT",
    ]);
    expect(eventsOfType(harness.events, "MAPPING")[0]).toMatchObject({
      sourceId: source.sourceId,
      replaySeed: 123,
      episodeId: 1,
      status: "paused",
    });
    expect(
      eventsOfType(harness.events, "MAPPING")[0].entries.map(
        (entry) => entry.genomeId,
      ),
    ).toEqual(source.entries.map((entry) => entry.genome.id));
    expect(eventsOfType(harness.events, "SNAPSHOT")[0]).toMatchObject({
      simulationTime: 0,
      episodeId: 1,
    });
  });

  it.each([
    [0.5, 2],
    [1, 4],
    [2, 8],
  ] as const)("advances speed %sx by exactly %s fixed steps per 15 Hz pulse", (speed, steps) => {
    const harness = createHarness();
    load(harness);
    harness.engine.handle(command({ type: "SPEED", speed: speed as ReplaySpeed }));
    harness.engine.handle(command({ type: "PLAY" }));
    harness.scheduler.runNext();

    const snapshot = eventsOfType(harness.events, "SNAPSHOT").at(-1);
    expect(snapshot?.simulationTime).toBeCloseTo(steps / 60, 12);
    expect(harness.engine.getSpeed()).toBe(speed);
  });

  it("invalidates an already queued pulse when paused", () => {
    const harness = createHarness();
    load(harness);
    harness.engine.handle(command({ type: "PLAY" }));
    const queued = harness.scheduler.tasks[0];
    harness.engine.handle(command({ type: "PAUSE" }));
    queued.task();

    expect(harness.engine.getStatus()).toBe("paused");
    expect(eventsOfType(harness.events, "SNAPSHOT")).toHaveLength(1);
    expect(eventsOfType(harness.events, "SNAPSHOT")[0].simulationTime).toBe(0);
  });

  it("restarts byte-identically while keeping sequence and episode IDs monotonic", () => {
    const harness = createHarness();
    load(harness, createDemoReplaySource(), 77);
    const first = eventsOfType(harness.events, "SNAPSHOT")[0];
    const expected = bytes(first);
    harness.engine.handle(command({ type: "PLAY" }));
    harness.scheduler.runNext();
    harness.engine.handle(command({ type: "PAUSE" }));
    harness.engine.handle(command({ type: "RESTART" }));

    const restarted = eventsOfType(harness.events, "SNAPSHOT").at(-1);
    expect(restarted?.simulationTime).toBe(0);
    expect(restarted?.episodeId).toBe(2);
    expect(restarted && bytes(restarted)).toEqual(expected);
    expect(eventsOfType(harness.events, "MAPPING")).toHaveLength(2);
    expect(harness.events.map((event) => event.sequence)).toEqual(
      [...harness.events.map((event) => event.sequence)].sort((a, b) => a - b),
    );
  });

  it("applies a new source immediately only while paused at step zero", () => {
    const harness = createHarness();
    const first = createDemoReplaySource(1);
    const second = createDemoReplaySource(2);
    load(harness, first);
    load(harness, second);

    expect(eventsOfType(harness.events, "MAPPING").at(-1)?.sourceId).toBe(
      second.sourceId,
    );
    expect(harness.engine.getEpisodeId()).toBe(2);

    harness.engine.handle(command({ type: "PLAY" }));
    harness.scheduler.runNext();
    harness.engine.handle(command({ type: "PAUSE" }));
    load(harness, first);
    expect(eventsOfType(harness.events, "MAPPING").at(-1)?.sourceId).toBe(
      second.sourceId,
    );
    harness.engine.handle(command({ type: "RESTART" }));
    expect(eventsOfType(harness.events, "MAPPING").at(-1)?.sourceId).toBe(
      first.sourceId,
    );
  });

  it("coalesces pending loads and applies the latest at the natural boundary", () => {
    const harness = createHarness();
    const first = createDemoReplaySource(1);
    const second = createDemoReplaySource(2);
    const latest = createDemoReplaySource(3);
    load(harness, first);
    harness.engine.handle(command({ type: "PLAY" }));
    harness.scheduler.runNext();
    load(harness, second);
    load(harness, latest);

    while (eventsOfType(harness.events, "EPISODE_END").length === 0) {
      harness.scheduler.runNext();
    }

    const end = eventsOfType(harness.events, "EPISODE_END")[0];
    const mappings = eventsOfType(harness.events, "MAPPING");
    const catches = eventsOfType(harness.events, "CATCH").filter(
      (event) => event.episodeId === 1,
    );
    expect(end).toMatchObject({ sourceId: first.sourceId, simulationTime: 15 });
    expect(end.survivors + end.caught).toBe(48);
    expect(catches).toHaveLength(end.caught);
    expect(new Set(catches.map((event) => event.fishIndex)).size).toBe(
      catches.length,
    );
    catches.forEach((event) => {
      expect(event.genomeId).toBe(first.entries[event.fishIndex].genome.id);
    });
    expect(mappings.at(-1)).toMatchObject({
      sourceId: latest.sourceId,
      episodeId: 2,
      status: "playing",
    });
    expect(eventsOfType(harness.events, "SNAPSHOT").at(-1)).toMatchObject({
      episodeId: 2,
      simulationTime: 0,
    });
    expect(harness.events.every(isReplayEvent)).toBe(true);
  });

  it("emits selected activations, edge weights, and metadata without stepping", () => {
    const harness = createHarness();
    const source = createDemoReplaySource();
    source.entries[4].fitness = 7.5;
    source.entries[4].survivalRate = 0.75;
    load(harness, source);
    harness.engine.handle(command({ type: "SELECT", fishIndex: 4 }));

    const activation = eventsOfType(harness.events, "ACTIVATION").at(-1);
    expect(activation).toMatchObject({
      fishIndex: 4,
      genomeId: source.entries[4].genome.id,
      fitness: 7.5,
      survivalRate: 0.75,
      alive: true,
      simulationTime: 0,
    });
    expect(activation?.inputs).toHaveLength(11);
    expect(activation?.hidden).toHaveLength(8);
    expect(activation?.outputs).toHaveLength(2);
    expect(activation?.inputToHidden).toHaveLength(88);
    expect(activation?.hiddenToOutput).toHaveLength(16);
    expect(eventsOfType(harness.events, "SNAPSHOT")).toHaveLength(1);
  });

  it("produces identical event streams for the same source, seed, and pulses", () => {
    const run = () => {
      const harness = createHarness();
      load(harness, createDemoReplaySource(12), 54);
      harness.engine.handle(command({ type: "SELECT", fishIndex: 0 }));
      harness.engine.handle(command({ type: "PLAY" }));
      for (let pulse = 0; pulse < 20; pulse += 1) harness.scheduler.runNext();
      return harness.events.map((event) => {
        if (event.type === "SNAPSHOT") {
          return { ...event, bytes: bytes(event), positions: undefined, velocities: undefined, alive: undefined, predator: undefined };
        }
        if (event.type === "ACTIVATION") {
          return {
            ...event,
            inputs: [...event.inputs],
            hidden: [...event.hidden],
            outputs: [...event.outputs],
            inputToHidden: [...event.inputToHidden],
            hiddenToOutput: [...event.hiddenToOutput],
          };
        }
        return event;
      });
    };

    expect(run()).toEqual(run());
  });

  it("reports recoverable invalid-state errors and disposes scheduled work", () => {
    const harness = createHarness();
    harness.engine.handle(command({ type: "PLAY" }));
    expect(eventsOfType(harness.events, "ERROR").at(-1)).toMatchObject({
      code: "INVALID_STATE",
      recoverable: true,
      episodeId: null,
    });

    load(harness);
    harness.engine.handle(command({ type: "PLAY" }));
    const queued = harness.scheduler.tasks.at(-1) as ScheduledTask;
    harness.engine.dispose();
    queued.task();
    expect(harness.engine.getStatus()).toBe("disposed");
    expect(eventsOfType(harness.events, "SNAPSHOT")).toHaveLength(1);
  });
});
