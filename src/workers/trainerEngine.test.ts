import { describe, expect, it } from "vitest";

import {
  createEvolutionRun,
  evolveGeneration,
  type EvolutionConfig,
} from "@/evolution";
import { restoreRunCheckpoint } from "@/persistence";
import { WORLD_CONFIG } from "@/simulation/config";
import type { WorldConfig } from "@/simulation/types";

import {
  TRAINER_PROTOCOL_VERSION,
  type TrainerCommand,
  type TrainerEvent,
} from "./protocol";
import { TrainerEngine } from "./trainerEngine";

const CONFIG: Readonly<EvolutionConfig> = Object.freeze({
  populationSize: 6,
  eliteCount: 1,
  tournamentSize: 2,
  crossoverProbability: 0.65,
  mutationProbability: 0.12,
  mutationStandardDeviation: 0.18,
  episodesPerGenome: 2,
  minimumWeight: -5,
  maximumWeight: 5,
});
const SHORT_WORLD: Readonly<WorldConfig> = Object.freeze({
  ...WORLD_CONFIG,
  episodeSeconds: 0.1,
});

class ManualScheduler {
  readonly tasks: Array<() => void> = [];

  readonly schedule = (task: () => void) => {
    this.tasks.push(task);
  };

  runNext() {
    const task = this.tasks.shift();
    if (!task) throw new Error("No scheduled trainer task.");
    task();
  }

  runUntil(predicate: () => boolean, maximumTasks = 100) {
    for (let index = 0; index < maximumTasks && !predicate(); index += 1) {
      this.runNext();
    }
    if (!predicate()) throw new Error("Trainer condition was not reached.");
  }
}

type UnversionedTrainerCommand = TrainerCommand extends infer Command
  ? Command extends TrainerCommand
    ? Omit<Command, "protocolVersion">
    : never
  : never;

function command(value: UnversionedTrainerCommand): TrainerCommand {
  return {
    ...value,
    protocolVersion: TRAINER_PROTOCOL_VERSION,
  } as TrainerCommand;
}

function eventOfType<Type extends TrainerEvent["type"]>(
  events: readonly TrainerEvent[],
  type: Type,
) {
  return events.filter(
    (event): event is Extract<TrainerEvent, { type: Type }> => event.type === type,
  );
}

function latestCheckpoint(events: readonly TrainerEvent[]) {
  const checkpoints = eventOfType(events, "CHECKPOINT");
  const checkpoint = checkpoints.at(-1)?.checkpoint;
  if (!checkpoint) throw new Error("Missing checkpoint event.");
  return checkpoint;
}

function createHarness(chunkSize = 2) {
  const events: TrainerEvent[] = [];
  const scheduler = new ManualScheduler();
  let time = 0;
  const engine = new TrainerEngine({
    emit: (event) => events.push(event),
    schedule: scheduler.schedule,
    now: () => time,
    savedAt: () => "2026-07-12T00:00:00.000Z",
    chunkSize,
  });
  return {
    engine,
    events,
    scheduler,
    advanceTime(milliseconds: number) {
      time += milliseconds;
    },
  };
}

function initialize(
  engine: TrainerEngine,
  runId = "run-1",
  runSeed = 42,
) {
  engine.handle(
    command({
      type: "INITIALIZE",
      runId,
      runSeed,
      evolutionConfig: CONFIG,
      world: SHORT_WORLD,
    }),
  );
}

function runOneGeneration(harness: ReturnType<typeof createHarness>) {
  const checkpointCount = eventOfType(harness.events, "CHECKPOINT").length;
  harness.engine.handle(command({ type: "START" }));
  harness.scheduler.runUntil(
    () => eventOfType(harness.events, "CHECKPOINT").length > checkpointCount,
  );
  harness.engine.handle(command({ type: "PAUSE" }));
  return latestCheckpoint(harness.events);
}

describe("TrainerEngine", () => {
  it("enforces command ordering with typed recoverable errors", () => {
    const { engine, events } = createHarness();

    engine.handle(command({ type: "START" }));
    engine.handle(command({ type: "PAUSE" }));
    engine.handle(command({ type: "CHECKPOINT" }));
    expect(eventOfType(events, "ERROR").map((event) => event.code)).toEqual([
      "INVALID_STATE",
      "INVALID_STATE",
      "INVALID_STATE",
    ]);

    initialize(engine);
    expect(eventOfType(events, "READY")).toHaveLength(1);
    initialize(engine);
    engine.handle(command({ type: "START" }));
    engine.handle(command({ type: "START" }));
    engine.handle(command({ type: "CURRICULUM", level: 2 }));

    expect(eventOfType(events, "ERROR").slice(-3).map((event) => event.code)).toEqual([
      "INVALID_STATE",
      "INVALID_STATE",
      "INVALID_STATE",
    ]);
  });

  it("evaluates bounded chunks, reports every chunk, and matches sync evolution", () => {
    const harness = createHarness(2);
    initialize(harness.engine);
    const checkpoint = runOneGeneration(harness);

    const runningProgress = eventOfType(harness.events, "PROGRESS").filter(
      (event) => event.status === "running",
    );
    expect(runningProgress.map((event) => event.completedGenomes)).toEqual([2, 4, 6]);
    expect(runningProgress.map((event) => event.completedEpisodes)).toEqual([4, 8, 12]);

    const expected = evolveGeneration(
      createEvolutionRun({ runSeed: 42, config: CONFIG }),
      { world: SHORT_WORLD },
    );
    const restored = restoreRunCheckpoint(checkpoint);
    expect(restored.state).toEqual(expected.state);
    expect(restored.metricHistory).toHaveLength(1);
    expect(restored.metricHistory[0]).toMatchObject({
      generation: 0,
      level: 0,
      bestFitness: expected.ranked[0].fitness,
      championSurvivalRate: expected.ranked[0].survivalRate,
      medianSurvivalRate: expected.medianSurvivalRate,
      curriculumAdvanced: expected.curriculumAdvanced,
    });
  });

  it("pauses at a chunk boundary and resumes the retained partial generation", () => {
    const harness = createHarness(2);
    initialize(harness.engine);
    harness.engine.handle(command({ type: "START" }));
    harness.scheduler.runNext();
    expect(eventOfType(harness.events, "PROGRESS").at(-1)?.completedGenomes).toBe(2);

    harness.engine.handle(command({ type: "PAUSE" }));
    expect(harness.engine.getStatus()).toBe("paused");
    expect(eventOfType(harness.events, "PROGRESS").at(-1)).toMatchObject({
      status: "paused",
      completedGenomes: 2,
    });
    harness.scheduler.runNext();
    expect(eventOfType(harness.events, "PROGRESS").at(-1)?.completedGenomes).toBe(2);

    harness.engine.handle(command({ type: "START" }));
    harness.scheduler.runUntil(
      () => eventOfType(harness.events, "CHECKPOINT").length === 1,
    );
    expect(restoreRunCheckpoint(latestCheckpoint(harness.events)).state.generation).toBe(1);
    expect(
      eventOfType(harness.events, "PROGRESS")
        .filter((event) => event.status === "running")
        .map((event) => event.completedGenomes),
    ).toEqual([2, 4, 6]);
  });

  it("excludes paused time from complete-generation duration", () => {
    const harness = createHarness(2);
    initialize(harness.engine);
    harness.engine.handle(command({ type: "START" }));
    harness.advanceTime(10);
    harness.scheduler.runNext();
    harness.advanceTime(5);
    harness.engine.handle(command({ type: "PAUSE" }));
    harness.scheduler.runNext();
    harness.advanceTime(1_000);

    harness.engine.handle(command({ type: "START" }));
    harness.advanceTime(5);
    harness.scheduler.runNext();
    harness.advanceTime(5);
    harness.scheduler.runNext();

    expect(eventOfType(harness.events, "GENERATION")[0].metric).toMatchObject({
      durationMilliseconds: 25,
    });
  });

  it("invalidates stale scheduled work and partial evaluation on reset", () => {
    const harness = createHarness(2);
    initialize(harness.engine, "old-run", 10);
    harness.engine.handle(command({ type: "START" }));
    harness.scheduler.runNext();

    harness.engine.handle(
      command({
        type: "RESET",
        runId: "new-run",
        runSeed: 11,
      }),
    );
    const progressBeforeStaleTask = eventOfType(harness.events, "PROGRESS").length;
    harness.scheduler.runNext();
    expect(eventOfType(harness.events, "PROGRESS")).toHaveLength(
      progressBeforeStaleTask,
    );

    const checkpoint = runOneGeneration(harness);
    const restored = restoreRunCheckpoint(checkpoint);
    expect(restored.runId).toBe("new-run");
    expect(restored.state.runSeed).toBe(11);
    expect(restored.state.generation).toBe(1);
  });

  it("never exposes partial work through a checkpoint request", () => {
    const harness = createHarness(2);
    initialize(harness.engine);
    harness.engine.handle(command({ type: "START" }));
    harness.scheduler.runNext();
    harness.engine.handle(command({ type: "CHECKPOINT" }));

    const partialBoundary = restoreRunCheckpoint(latestCheckpoint(harness.events));
    expect(partialBoundary.state.generation).toBe(0);
    expect(partialBoundary.metricHistory).toEqual([]);

    harness.scheduler.runUntil(
      () =>
        eventOfType(harness.events, "CHECKPOINT").some(
          (event) => restoreRunCheckpoint(event.checkpoint).state.generation === 1,
        ),
    );
    expect(restoreRunCheckpoint(latestCheckpoint(harness.events)).state.generation).toBe(1);
  });

  it("restores paused and continues with the exact next deterministic generation", () => {
    const first = createHarness(3);
    initialize(first.engine);
    const firstCheckpoint = runOneGeneration(first);
    const firstRestored = restoreRunCheckpoint(firstCheckpoint);
    const expectedNext = evolveGeneration(firstRestored.state, {
      world: firstRestored.world,
    });

    const second = createHarness(3);
    second.engine.handle(
      command({ type: "INITIALIZE", checkpoint: firstCheckpoint }),
    );
    expect(second.engine.getStatus()).toBe("paused");
    expect(eventOfType(second.events, "READY")[0]).toMatchObject({
      restored: true,
      generation: 1,
      status: "paused",
    });

    const secondCheckpoint = runOneGeneration(second);
    const secondRestored = restoreRunCheckpoint(secondCheckpoint);
    expect(secondRestored.state).toEqual(expectedNext.state);
    expect(secondRestored.metricHistory.map((metric) => metric.generation)).toEqual([0, 1]);
  });

  it("changes curriculum only while paused and checkpoints the coherent boundary", () => {
    const harness = createHarness();
    initialize(harness.engine);
    harness.engine.handle(command({ type: "CURRICULUM", level: 3 }));
    harness.engine.handle(command({ type: "CHECKPOINT" }));

    const levelEvent = eventOfType(harness.events, "LEVEL").at(-1);
    expect(levelEvent).toMatchObject({ previousLevel: 0, level: 3, generation: 0 });
    expect(
      restoreRunCheckpoint(latestCheckpoint(harness.events)).state.curriculum.level,
    ).toBe(3);
  });

  it("rejects a curriculum change while a paused partial generation exists", () => {
    const harness = createHarness(2);
    initialize(harness.engine);
    harness.engine.handle(command({ type: "START" }));
    harness.scheduler.runNext();
    harness.engine.handle(command({ type: "PAUSE" }));
    harness.engine.handle(command({ type: "CURRICULUM", level: 2 }));

    expect(eventOfType(harness.events, "ERROR").at(-1)).toMatchObject({
      code: "INVALID_STATE",
      recoverable: true,
    });
    expect(eventOfType(harness.events, "LEVEL")).toHaveLength(0);
  });

  it("rejects invalid chunk sizes", () => {
    expect(
      () =>
        new TrainerEngine({
          emit: () => undefined,
          chunkSize: 0,
        }),
    ).toThrow(RangeError);
  });
});
