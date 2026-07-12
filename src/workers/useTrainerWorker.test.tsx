import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution";

import type { TrainerCommand, TrainerEvent } from "./protocol";
import { useTrainerWorker } from "./useTrainerWorker";

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  readonly posted: TrainerCommand[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(command: TrainerCommand) {
    this.posted.push(command);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(event: TrainerEvent) {
    this.listeners
      .get("message")
      ?.forEach((listener) => listener({ data: event } as never));
  }
}

function readyEvent(): TrainerEvent {
  return {
    type: "READY",
    protocolVersion: 1,
    checkpointSchemaVersion: 1,
    runId: "local-active-run",
    generation: 0,
    level: 0,
    status: "paused",
    restored: false,
  };
}

describe("useTrainerWorker", () => {
  afterEach(() => {
    FakeWorker.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("applies reset settings and queues a manual level until READY", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { result, unmount } = renderHook(() => useTrainerWorker());

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const initialWorker = FakeWorker.instances[0];
    expect(initialWorker.posted[0]).toMatchObject({
      type: "INITIALIZE",
      runId: "local-active-run",
      runSeed: 42,
    });
    act(() => initialWorker.emitMessage(readyEvent()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const evolutionConfig = {
      ...DEFAULT_EVOLUTION_CONFIG,
      populationSize: 64,
      episodesPerGenome: 4,
      automaticCurriculum: false,
    };
    act(() => {
      result.current.reset({
        runSeed: 91,
        evolutionConfig,
        manualLevel: 4,
      });
    });

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const resetWorker = FakeWorker.instances[1];
    expect(initialWorker.terminated).toBe(true);
    expect(resetWorker.posted).toEqual([
      {
        type: "INITIALIZE",
        protocolVersion: 1,
        runId: "local-active-run",
        runSeed: 91,
        evolutionConfig,
        world: undefined,
      },
    ]);
    expect(result.current).toMatchObject({
      runSeed: 91,
      evolutionConfig,
      metricHistory: [],
      restoredFromCheckpoint: false,
    });

    act(() => resetWorker.emitMessage(readyEvent()));
    await waitFor(() =>
      expect(resetWorker.posted.at(-1)).toEqual({
        type: "CURRICULUM",
        protocolVersion: 1,
        level: 4,
      }),
    );

    unmount();
  });
});
