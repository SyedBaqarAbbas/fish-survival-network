import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVOLUTION_CONFIG,
  createEvolutionRun,
  evolveGeneration,
} from "@/evolution";
import {
  createRunCheckpoint,
  type CheckpointRepository,
  type CheckpointRepositoryResult,
  type PersistenceWarning,
  type RunCheckpoint,
} from "@/persistence";
import type { ReplaySource } from "@/replay";
import { WORLD_CONFIG } from "@/simulation/config";

import { TrainerClient } from "./trainerClient";
import type { TrainerCommand, TrainerEvent } from "./protocol";

const TEST_CONFIG = {
  ...DEFAULT_EVOLUTION_CONFIG,
  populationSize: 2,
  eliteCount: 1,
  tournamentSize: 1,
  episodesPerGenome: 1,
};

const TEST_METRIC = Object.freeze({
  generation: 0,
  level: 0 as const,
  bestFitness: 2,
  meanFitness: 1,
  championSurvivalRate: 0.5,
  medianSurvivalRate: 0.25,
  durationMilliseconds: 5,
  curriculumAdvanced: false,
});

function makeCheckpoint() {
  return createRunCheckpoint({
    runId: "test-run",
    savedAt: "2026-07-12T00:00:00.000Z",
    world: { ...WORLD_CONFIG, episodeSeconds: 0.1 },
    state: createEvolutionRun({ runSeed: 42, config: TEST_CONFIG }),
    metricHistory: [],
  });
}

function makeReplayCheckpoint() {
  const state = createEvolutionRun({
    runSeed: 42,
    config: {
      ...DEFAULT_EVOLUTION_CONFIG,
      populationSize: 48,
      episodesPerGenome: 1,
    },
  });
  const replaySource: ReplaySource = {
    sourceId: "test-run:generation:0",
    runId: "test-run",
    generation: 0,
    level: 0,
    world: { ...WORLD_CONFIG, episodeSeconds: 0.1 },
    championGenomeId: state.population[0].id,
    entries: state.population.map((genome, index) => ({
      genome,
      fitness: 48 - index,
      survivalRate: index / 48,
    })),
  };
  return createRunCheckpoint({
    runId: "test-run",
    savedAt: "2026-07-12T00:00:00.000Z",
    world: replaySource.world,
    state,
    metricHistory: [],
    replaySource,
  });
}

function makeCheckpointWithHistory() {
  const world = { ...WORLD_CONFIG, episodeSeconds: 0.1 };
  const initial = createEvolutionRun({
    runSeed: 84,
    config: { ...TEST_CONFIG, automaticCurriculum: false },
  });
  const evolved = evolveGeneration(initial, { world });
  return createRunCheckpoint({
    runId: "test-run",
    savedAt: "2026-07-12T00:00:00.000Z",
    world,
    state: evolved.state,
    metricHistory: [TEST_METRIC],
  });
}

class FakeRepository implements CheckpointRepository {
  checkpoint?: RunCheckpoint;
  warning?: PersistenceWarning;
  saved: RunCheckpoint[] = [];
  clearCount = 0;

  async loadActive(): Promise<CheckpointRepositoryResult> {
    return {
      backend: this.warning ? "memory" : "indexeddb",
      ...(this.checkpoint ? { checkpoint: structuredClone(this.checkpoint) } : {}),
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }

  async saveActive(checkpoint: RunCheckpoint): Promise<CheckpointRepositoryResult> {
    this.checkpoint = structuredClone(checkpoint);
    this.saved.push(structuredClone(checkpoint));
    return {
      backend: this.warning ? "memory" : "indexeddb",
      checkpoint: structuredClone(checkpoint),
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }

  async clearActive(): Promise<CheckpointRepositoryResult> {
    this.checkpoint = undefined;
    this.clearCount += 1;
    return { backend: this.warning ? "memory" : "indexeddb" };
  }

  getLastKnownGood(): CheckpointRepositoryResult {
    return {
      backend: this.warning ? "memory" : "indexeddb",
      ...(this.checkpoint ? { checkpoint: structuredClone(this.checkpoint) } : {}),
    };
  }

  async close() {}
}

class FakeWorker {
  readonly posted: TrainerCommand[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

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
    this.emit("message", { data: event } as never);
  }

  emitError(message: string) {
    this.emit("error", { message } as never);
  }

  private emit(type: string, event: never) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function readyEvent(restored: boolean): TrainerEvent {
  return {
    type: "READY",
    protocolVersion: 1,
    checkpointSchemaVersion: 1,
    runId: "test-run",
    generation: 0,
    level: 0,
    status: "paused",
    restored,
  };
}

function createClient(repository: FakeRepository, workers: FakeWorker[]) {
  return new TrainerClient({
    persistence: repository,
    runId: "test-run",
    runSeed: 42,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
}

describe("trainer client", () => {
  it("rejects reset before initialization without creating a worker", () => {
    const repository = new FakeRepository();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);

    client.reset({ runId: "too-early", runSeed: 1 });

    expect(workers).toHaveLength(0);
    expect(client.getState()).toMatchObject({
      status: "error",
      error: "Trainer must be initialized before resetting.",
    });
    client.dispose();
  });

  it("restores the active checkpoint before initializing the worker", async () => {
    const repository = new FakeRepository();
    repository.checkpoint = makeCheckpoint();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);

    await client.initialize();

    expect(workers).toHaveLength(1);
    expect(workers[0].posted[0]).toMatchObject({
      type: "INITIALIZE",
      checkpoint: { runId: "test-run" },
    });
    workers[0].emitMessage(readyEvent(true));
    expect(client.getState()).toMatchObject({
      status: "ready",
      generation: 0,
      recovered: false,
      restoredFromCheckpoint: true,
      runSeed: 42,
      evolutionConfig: TEST_CONFIG,
      metricHistory: [],
      persistenceBackend: "indexeddb",
    });

    client.reset({ runId: "reset-run", runSeed: 9 });
    expect(workers[1].posted[0]).toMatchObject({
      type: "INITIALIZE",
      runId: "reset-run",
      runSeed: 9,
      evolutionConfig: TEST_CONFIG,
      world: { episodeSeconds: 0.1 },
    });
    client.dispose();
  });

  it("owns restored config and full history, then appends generation metrics", async () => {
    const repository = new FakeRepository();
    repository.checkpoint = makeCheckpointWithHistory();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);

    await client.initialize();

    expect(client.getState()).toMatchObject({
      runSeed: 84,
      evolutionConfig: { automaticCurriculum: false },
      metricHistory: [TEST_METRIC],
      latestMetric: TEST_METRIC,
      restoredFromCheckpoint: true,
      persistenceBackend: "indexeddb",
    });
    expect(Object.isFrozen(client.getState().evolutionConfig)).toBe(true);
    expect(Object.isFrozen(client.getState().metricHistory)).toBe(true);

    workers[0].emitMessage(readyEvent(true));
    const nextMetric = { ...TEST_METRIC, generation: 1, bestFitness: 3 };
    workers[0].emitMessage({
      type: "GENERATION",
      runId: "test-run",
      metric: nextMetric,
    });

    expect(client.getState().metricHistory).toEqual([TEST_METRIC, nextMetric]);
    expect(client.getState().latestMetric).toEqual(nextMetric);
    client.dispose();
  });

  it("keeps training available when persistence falls back to memory", async () => {
    const repository = new FakeRepository();
    repository.warning = {
      code: "INDEXED_DB_UNAVAILABLE",
      message: "blocked",
    };
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);

    await client.initialize();
    workers[0].emitMessage(readyEvent(false));

    expect(client.getState()).toMatchObject({
      status: "ready",
      warning: { code: "INDEXED_DB_UNAVAILABLE" },
    });
    client.dispose();
  });

  it("caches completed checkpoints before asynchronous persistence", async () => {
    const repository = new FakeRepository();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);
    await client.initialize();
    workers[0].emitMessage(readyEvent(false));
    const checkpoint = makeCheckpoint();

    workers[0].emitMessage({
      type: "CHECKPOINT",
      runId: "test-run",
      checkpoint,
    });
    await Promise.resolve();

    expect(repository.saved).toHaveLength(1);
    expect(client.getState()).toMatchObject({ generation: 0, level: 0 });
    client.dispose();
  });

  it("exposes decoded replay sources from load and checkpoint events and clears on reset", async () => {
    const repository = new FakeRepository();
    repository.checkpoint = makeReplayCheckpoint();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);

    await client.initialize();
    expect(client.getState().replaySource).toMatchObject({
      sourceId: "test-run:generation:0",
      championGenomeId: "g0-i0",
    });
    expect(client.getState().replaySource?.entries).toHaveLength(48);
    expect(
      client.getState().replaySource?.entries[0].genome.inputToHidden,
    ).toBeInstanceOf(Float32Array);

    const replaySource = client.getState().replaySource;
    if (!replaySource) {
      throw new Error("Missing decoded replay source.");
    }
    const firstWeight = replaySource.entries[0].genome.inputToHidden[0];
    replaySource.entries[0].genome.inputToHidden[0] = 4;
    workers[0].emitMessage({
      type: "CHECKPOINT",
      runId: "test-run",
      checkpoint: makeReplayCheckpoint(),
    });
    expect(
      client.getState().replaySource?.entries[0].genome.inputToHidden[0],
    ).toBe(firstWeight);

    client.reset({ runId: "replacement", runSeed: 7 });
    expect(client.getState().replaySource).toBeUndefined();
    client.dispose();
  });

  it("recreates a failed worker from the last checkpoint and leaves it paused", async () => {
    const repository = new FakeRepository();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);
    await client.initialize();
    workers[0].emitMessage(readyEvent(false));
    const checkpoint = makeCheckpoint();
    workers[0].emitMessage({
      type: "CHECKPOINT",
      runId: "test-run",
      checkpoint,
    });

    workers[0].emitError("worker crashed");

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toEqual([
      expect.objectContaining({ type: "INITIALIZE", checkpoint }),
    ]);
    expect(workers[1].posted.some((command) => command.type === "START")).toBe(
      false,
    );
    workers[1].emitMessage(readyEvent(true));
    expect(client.getState()).toMatchObject({
      status: "paused",
      recovered: true,
      error: undefined,
    });

    workers[0].emitMessage({
      type: "PROGRESS",
      runId: "stale",
      generation: 99,
      level: 6,
      status: "running",
      completedGenomes: 1,
      totalGenomes: 2,
      completedEpisodes: 1,
      totalEpisodes: 2,
      elapsedMilliseconds: 1,
    });
    expect(client.getState().generation).toBe(0);
    client.dispose();
  });

  it("clears persistence and replaces the worker for a coherent reset", async () => {
    const repository = new FakeRepository();
    const workers: FakeWorker[] = [];
    const client = createClient(repository, workers);
    await client.initialize();
    workers[0].emitMessage(readyEvent(false));
    workers[0].emitMessage({
      type: "PROGRESS",
      runId: "test-run",
      generation: 4,
      level: 2,
      status: "paused",
      completedGenomes: 1,
      totalGenomes: 2,
      completedEpisodes: 1,
      totalEpisodes: 2,
      elapsedMilliseconds: 5,
    });
    workers[0].emitMessage({
      type: "GENERATION",
      runId: "test-run",
      metric: {
        generation: 3,
        level: 2,
        bestFitness: 2,
        meanFitness: 1,
        championSurvivalRate: 0.5,
        medianSurvivalRate: 0.25,
        durationMilliseconds: 5,
        curriculumAdvanced: false,
      },
    });

    client.reset({ runId: "replacement", runSeed: 7 });
    await Promise.resolve();

    expect(repository.clearCount).toBe(1);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toEqual([{
      type: "INITIALIZE",
      protocolVersion: 1,
      runId: "replacement",
      runSeed: 7,
      evolutionConfig: undefined,
      world: undefined,
    }]);
    expect(client.getState()).toEqual({
      status: "starting",
      runId: "replacement",
      runSeed: 7,
      evolutionConfig: DEFAULT_EVOLUTION_CONFIG,
      generation: 0,
      level: 0,
      metricHistory: [],
      persistenceBackend: "indexeddb",
      warning: undefined,
      recovered: false,
      restoredFromCheckpoint: false,
    });

    workers[0].emitMessage({
      type: "CHECKPOINT",
      runId: "test-run",
      checkpoint: makeCheckpoint(),
    });
    await Promise.resolve();
    expect(repository.saved).toHaveLength(0);
    client.dispose();
  });
});
