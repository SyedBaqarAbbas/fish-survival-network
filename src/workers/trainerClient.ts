import { DEFAULT_EVOLUTION_CONFIG, type EvolutionConfig } from "@/evolution";
import {
  restoreCheckpointReplaySource,
  type CheckpointRepository,
  type GenerationMetric,
  type PersistenceBackendName,
  type PersistenceWarning,
  type RunCheckpoint,
} from "@/persistence";
import type { ReplaySource } from "@/replay";
import type { CurriculumLevel, WorldConfig } from "@/simulation/types";

import { createTrainerWorker } from "./createTrainerWorker";
import {
  isTrainerEvent,
  TRAINER_PROTOCOL_VERSION,
  type TrainerCommand,
  type TrainerEvent,
} from "./protocol";

export type TrainerClientStatus =
  | "starting"
  | "ready"
  | "running"
  | "paused"
  | "error";

export interface TrainerProgress {
  generation: number;
  level: CurriculumLevel;
  completedGenomes: number;
  totalGenomes: number;
  completedEpisodes: number;
  totalEpisodes: number;
  elapsedMilliseconds: number;
}

export interface TrainerClientState {
  status: TrainerClientStatus;
  runId?: string;
  runSeed?: number;
  evolutionConfig?: Readonly<EvolutionConfig>;
  generation?: number;
  level?: CurriculumLevel;
  progress?: TrainerProgress;
  latestMetric?: Readonly<GenerationMetric>;
  metricHistory: readonly Readonly<GenerationMetric>[];
  replaySource?: ReplaySource;
  persistenceBackend?: PersistenceBackendName;
  warning?: PersistenceWarning;
  error?: string;
  recovered: boolean;
  restoredFromCheckpoint: boolean;
}

export interface FreshRunOptions {
  runId: string;
  runSeed: number;
  evolutionConfig?: Readonly<EvolutionConfig>;
  world?: Readonly<WorldConfig>;
}

export interface TrainerClientOptions extends FreshRunOptions {
  persistence: CheckpointRepository;
  workerFactory?: () => Worker;
}

type StateListener = (state: Readonly<TrainerClientState>) => void;

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ownEvolutionConfig(
  config: Readonly<EvolutionConfig> = DEFAULT_EVOLUTION_CONFIG,
) {
  return Object.freeze({ ...config }) satisfies Readonly<EvolutionConfig>;
}

function ownMetricHistory(
  history: readonly Readonly<GenerationMetric>[],
): readonly Readonly<GenerationMetric>[] {
  return Object.freeze(
    history.map((metric) => Object.freeze({ ...metric })),
  );
}

export class TrainerClient {
  private readonly persistence: CheckpointRepository;
  private readonly workerFactory: () => Worker;
  private readonly listeners = new Set<StateListener>();
  private freshRun: FreshRunOptions;
  private state: TrainerClientState;
  private worker?: Worker;
  private workerToken = 0;
  private initialized = false;
  private disposed = false;
  private recovering = false;
  private lastCheckpoint?: RunCheckpoint;

  constructor({
    persistence,
    workerFactory = createTrainerWorker,
    ...freshRun
  }: TrainerClientOptions) {
    this.persistence = persistence;
    this.workerFactory = workerFactory;
    const evolutionConfig = ownEvolutionConfig(freshRun.evolutionConfig);
    this.freshRun = {
      runId: freshRun.runId,
      runSeed: freshRun.runSeed,
      ...(freshRun.evolutionConfig ? { evolutionConfig } : {}),
      ...(freshRun.world ? { world: { ...freshRun.world } } : {}),
    };
    this.state = {
      status: "starting",
      runId: freshRun.runId,
      runSeed: freshRun.runSeed,
      evolutionConfig,
      metricHistory: ownMetricHistory([]),
      recovered: false,
      restoredFromCheckpoint: false,
    };
  }

  getState() {
    return this.state;
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    const initializationToken = this.workerToken;

    try {
      const loaded = await this.persistence.loadActive();
      if (this.disposed || initializationToken !== this.workerToken) return;
      this.lastCheckpoint = loaded.checkpoint;
      if (loaded.checkpoint) {
        const replaySource = restoreCheckpointReplaySource(loaded.checkpoint);
        const evolutionConfig = ownEvolutionConfig(
          loaded.checkpoint.evolution.config,
        );
        const metricHistory = ownMetricHistory(loaded.checkpoint.metricHistory);
        this.freshRun = {
          runId: loaded.checkpoint.runId,
          runSeed: loaded.checkpoint.evolution.runSeed,
          evolutionConfig,
          world: { ...loaded.checkpoint.world },
        };
        this.patchState({
          runId: loaded.checkpoint.runId,
          runSeed: loaded.checkpoint.evolution.runSeed,
          evolutionConfig,
          generation: loaded.checkpoint.evolution.generation,
          level: loaded.checkpoint.evolution.curriculum.level,
          latestMetric: metricHistory.at(-1),
          metricHistory,
          replaySource,
          restoredFromCheckpoint: true,
        });
      }
      this.patchState({
        persistenceBackend: loaded.backend,
        ...(loaded.warning ? { warning: loaded.warning } : {}),
      });
      this.createAndInitializeWorker(loaded.checkpoint, false);
    } catch (error) {
      if (this.disposed || initializationToken !== this.workerToken) return;
      this.patchState({
        warning: {
          code: "INDEXED_DB_UNAVAILABLE",
          message: messageFrom(error),
        },
        persistenceBackend: "memory",
      });
      this.createAndInitializeWorker(undefined, false);
    }
  }

  start() {
    this.post({ type: "START", protocolVersion: TRAINER_PROTOCOL_VERSION });
  }

  pause() {
    this.post({ type: "PAUSE", protocolVersion: TRAINER_PROTOCOL_VERSION });
  }

  reset(options: FreshRunOptions = this.freshRun) {
    if (this.disposed) return;
    if (!this.initialized) {
      this.patchState({
        status: "error",
        error: "Trainer must be initialized before resetting.",
      });
      return;
    }
    const requestedEvolutionConfig =
      options.evolutionConfig ?? this.freshRun.evolutionConfig;
    const evolutionConfig = ownEvolutionConfig(requestedEvolutionConfig);
    const nextRun: FreshRunOptions = {
      ...this.freshRun,
      ...options,
      evolutionConfig: requestedEvolutionConfig
        ? evolutionConfig
        : undefined,
      world: options.world
        ? { ...options.world }
        : this.freshRun.world
          ? { ...this.freshRun.world }
          : undefined,
    };
    this.freshRun = nextRun;
    this.lastCheckpoint = undefined;
    void this.persistence.clearActive().then((result) => {
      this.patchState({
        persistenceBackend: result.backend,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    });
    this.workerToken += 1;
    this.worker?.terminate();
    this.worker = undefined;
    this.state = {
      status: "starting",
      runId: nextRun.runId,
      runSeed: nextRun.runSeed,
      evolutionConfig,
      generation: 0,
      level: 0,
      metricHistory: ownMetricHistory([]),
      persistenceBackend: this.state.persistenceBackend,
      warning: this.state.warning,
      recovered: false,
      restoredFromCheckpoint: false,
    };
    for (const listener of this.listeners) listener(this.state);
    this.createAndInitializeWorker(undefined, false);
  }

  setCurriculum(level: CurriculumLevel) {
    this.post({
      type: "CURRICULUM",
      protocolVersion: TRAINER_PROTOCOL_VERSION,
      level,
    });
  }

  requestCheckpoint() {
    this.post({ type: "CHECKPOINT", protocolVersion: TRAINER_PROTOCOL_VERSION });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.workerToken += 1;
    this.worker?.terminate();
    this.worker = undefined;
    this.listeners.clear();
    void this.persistence.close();
  }

  private patchState(patch: Partial<TrainerClientState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private createAndInitializeWorker(
    checkpoint: RunCheckpoint | undefined,
    recovering: boolean,
  ) {
    const token = ++this.workerToken;
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      this.recovering = recovering;
      worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (token === this.workerToken) this.handleMessage(event.data);
      });
      worker.addEventListener("error", (event) => {
        if (token === this.workerToken) {
          this.recover(event.message || "The training worker failed.");
        }
      });
      worker.addEventListener("messageerror", () => {
        if (token === this.workerToken) {
          this.recover("The training worker sent an unreadable response.");
        }
      });

      const command: TrainerCommand = checkpoint
        ? {
            type: "INITIALIZE",
            protocolVersion: TRAINER_PROTOCOL_VERSION,
            checkpoint,
          }
        : {
            type: "INITIALIZE",
            protocolVersion: TRAINER_PROTOCOL_VERSION,
            runId: this.freshRun.runId,
            runSeed: this.freshRun.runSeed,
            evolutionConfig: this.freshRun.evolutionConfig,
            world: this.freshRun.world,
          };
      worker.postMessage(command);
    } catch (error) {
      this.recovering = false;
      this.patchState({ status: "error", error: messageFrom(error) });
    }
  }

  private handleMessage(value: unknown) {
    if (!isTrainerEvent(value)) {
      this.recover("The training worker sent an invalid response.");
      return;
    }

    switch (value.type) {
      case "READY": {
        const recovered = this.recovering;
        this.recovering = false;
        this.patchState({
          status: recovered ? "paused" : "ready",
          runId: value.runId,
          runSeed: this.freshRun.runSeed,
          evolutionConfig: ownEvolutionConfig(this.freshRun.evolutionConfig),
          generation: value.generation,
          level: value.level,
          progress: undefined,
          error: undefined,
          recovered,
          restoredFromCheckpoint: value.restored,
        });
        break;
      }
      case "PROGRESS":
        this.patchState({
          status: value.status,
          runId: value.runId,
          generation: value.generation,
          level: value.level,
          error: undefined,
          progress: {
            generation: value.generation,
            level: value.level,
            completedGenomes: value.completedGenomes,
            totalGenomes: value.totalGenomes,
            completedEpisodes: value.completedEpisodes,
            totalEpisodes: value.totalEpisodes,
            elapsedMilliseconds: value.elapsedMilliseconds,
          },
        });
        break;
      case "GENERATION": {
        const metric = Object.freeze({ ...value.metric });
        const metricHistory = ownMetricHistory([
          ...this.state.metricHistory.filter(
            (existing) => existing.generation !== metric.generation,
          ),
          metric,
        ]);
        this.patchState({ latestMetric: metric, metricHistory, error: undefined });
        break;
      }
      case "LEVEL":
        this.patchState({
          generation: value.generation,
          level: value.level,
          error: undefined,
        });
        break;
      case "CHECKPOINT":
        this.acceptCheckpoint(value);
        break;
      case "ERROR":
        if (value.recoverable) {
          this.patchState({ error: value.message });
        } else {
          this.recover(value.message);
        }
        break;
    }
  }

  private acceptCheckpoint(
    event: Extract<TrainerEvent, { type: "CHECKPOINT" }>,
  ) {
    const replaySource = restoreCheckpointReplaySource(event.checkpoint);
    const evolutionConfig = ownEvolutionConfig(
      event.checkpoint.evolution.config,
    );
    const metricHistory = ownMetricHistory(event.checkpoint.metricHistory);
    this.lastCheckpoint = event.checkpoint;
    this.freshRun = {
      runId: event.checkpoint.runId,
      runSeed: event.checkpoint.evolution.runSeed,
      evolutionConfig,
      world: { ...event.checkpoint.world },
    };
    this.patchState({
      runId: event.runId,
      runSeed: event.checkpoint.evolution.runSeed,
      evolutionConfig,
      generation: event.checkpoint.evolution.generation,
      level: event.checkpoint.evolution.curriculum.level,
      latestMetric: metricHistory.at(-1),
      metricHistory,
      replaySource,
      error: undefined,
    });
    void this.persistence.saveActive(event.checkpoint).then((result) => {
      this.patchState({
        persistenceBackend: result.backend,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    });
  }

  private post(command: TrainerCommand) {
    if (!this.worker || this.disposed) {
      this.patchState({ status: "error", error: "Trainer is not initialized." });
      return;
    }
    this.worker.postMessage(command);
  }

  private recover(reason: string) {
    if (this.disposed) return;
    if (this.recovering) {
      this.recovering = false;
      this.workerToken += 1;
      this.worker?.terminate();
      this.worker = undefined;
      this.patchState({ status: "error", error: reason });
      return;
    }

    this.workerToken += 1;
    this.worker?.terminate();
    this.worker = undefined;
    const checkpoint =
      this.lastCheckpoint ?? this.persistence.getLastKnownGood().checkpoint;
    this.patchState({
      status: "starting",
      error: `Recovering from worker failure: ${reason}`,
    });
    this.createAndInitializeWorker(checkpoint, true);
  }
}
