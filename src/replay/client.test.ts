import { describe, expect, it } from "vitest";

import { ReplayClient } from "./client";
import { ReplayEngine } from "./engine";
import {
  REPLAY_PROTOCOL_VERSION,
  type ReplayCommand,
  type ReplayEvent,
} from "./protocol";
import { createDemoReplaySource } from "./source";

class FakeWorker {
  readonly posted: unknown[] = [];
  readonly listeners = new Map<string, Array<(event: never) => void>>();
  terminated = false;

  addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  dispatch(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener(event as never));
  }
}

function engineEvents() {
  const events: ReplayEvent[] = [];
  const engine = new ReplayEngine({ emit: (event) => events.push(event) });
  const source = createDemoReplaySource();
  engine.handle({
    type: "LOAD",
    protocolVersion: REPLAY_PROTOCOL_VERSION,
    source,
    replaySeed: 42,
  });
  return { engine, events, source };
}

describe("ReplayClient", () => {
  it("forwards every public command and owns the loaded source clone", () => {
    const worker = new FakeWorker();
    const client = new ReplayClient({ workerFactory: () => worker as unknown as Worker });
    const source = createDemoReplaySource();

    client.load(source, 7);
    client.play();
    client.pause();
    client.restart();
    client.setSpeed(2);
    client.select(47);
    client.select(null);

    expect(
      worker.posted.map((value) => (value as ReplayCommand).type),
    ).toEqual(["LOAD", "PLAY", "PAUSE", "RESTART", "SPEED", "SELECT", "SELECT"]);
    const loaded = worker.posted[0] as Extract<ReplayCommand, { type: "LOAD" }>;
    expect(loaded.protocolVersion).toBe(REPLAY_PROTOCOL_VERSION);
    expect(loaded.source.entries[0].genome.inputToHidden.buffer).not.toBe(
      source.entries[0].genome.inputToHidden.buffer,
    );
  });

  it("delivers snapshots outside the general subscription and rejects stale events", () => {
    const worker = new FakeWorker();
    const client = new ReplayClient({ workerFactory: () => worker as unknown as Worker });
    const received: ReplayEvent[] = [];
    const snapshots: ReplayEvent[] = [];
    client.subscribe((event) => received.push(event as ReplayEvent));
    client.subscribeSnapshots((event) => snapshots.push(event));
    const harness = engineEvents();
    const firstMapping = harness.events[0];
    const firstSnapshot = harness.events[1];
    worker.dispatch("message", { data: firstMapping });
    worker.dispatch("message", { data: firstSnapshot });
    worker.dispatch("message", { data: firstSnapshot });

    harness.engine.handle({
      type: "RESTART",
      protocolVersion: REPLAY_PROTOCOL_VERSION,
    });
    const secondMapping = harness.events[2];
    const secondSnapshot = harness.events[3];
    worker.dispatch("message", { data: secondMapping });
    worker.dispatch("message", {
      data: {
        type: "CATCH",
        episodeId: 1,
        sequence: 50,
        simulationTime: 1,
        fishIndex: 0,
        genomeId: harness.source.entries[0].genome.id,
        x: 1,
        y: 1,
      },
    });
    worker.dispatch("message", { data: secondSnapshot });

    expect(received.map((event) => event.type)).toEqual([
      "MAPPING",
      "SNAPSHOT",
      "MAPPING",
      "SNAPSHOT",
    ]);
    expect(snapshots).toHaveLength(2);
  });

  it("reports invalid worker events and terminates cleanly", () => {
    const worker = new FakeWorker();
    const client = new ReplayClient({ workerFactory: () => worker as unknown as Worker });
    const received: ReplayEvent[] = [];
    client.subscribe((event) => received.push(event as ReplayEvent));

    worker.dispatch("message", { data: { type: "UNKNOWN" } });
    expect(received.at(-1)).toMatchObject({
      type: "ERROR",
      code: "INVALID_EVENT",
      recoverable: false,
    });

    client.dispose();
    client.play();
    worker.dispatch("message", { data: engineEvents().events[0] });
    expect(worker.terminated).toBe(true);
    expect(worker.posted).toHaveLength(0);
    expect(received).toHaveLength(1);
  });
});
