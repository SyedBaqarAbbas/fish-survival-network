import {
  completeEvaluatedGeneration,
  createEvolutionRun,
  deriveGenerationEpisodeSeeds,
  evaluateGenome,
  setCurriculumLevel,
  type EvolutionRunState,
  type GenomeEvaluation,
  type PopulationEvaluation,
} from "@/evolution";
import {
  CHECKPOINT_SCHEMA_VERSION,
  createRunCheckpoint,
  restoreRunCheckpoint,
  type GenerationMetric,
  type RunCheckpoint,
} from "@/persistence";
import { WORLD_CONFIG } from "@/simulation/config";
import type { CurriculumLevel, WorldConfig } from "@/simulation/types";

import {
  TRAINER_PROTOCOL_VERSION,
  type TrainerCommand,
  type TrainerErrorCode,
  type TrainerEvent,
} from "./protocol";

export type TrainerEngineStatus = "uninitialized" | "paused" | "running";

export interface TrainerEngineDependencies {
  emit: (event: TrainerEvent) => void;
  schedule?: (task: () => void) => void;
  now?: () => number;
  savedAt?: () => string;
  chunkSize?: number;
}

interface ActiveRun {
  runId: string;
  world: Readonly<WorldConfig>;
  state: EvolutionRunState;
  metricHistory: GenerationMetric[];
  lastCheckpoint: RunCheckpoint;
}

interface PartialGeneration {
  generation: number;
  level: CurriculumLevel;
  episodeSeeds: number[];
  evaluations: GenomeEvaluation[];
  lastActiveAt: number;
  elapsedMilliseconds: number;
}

function defaultSchedule(task: () => void) {
  setTimeout(task, 0);
}

function defaultNow() {
  return performance.now();
}

function defaultSavedAt() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloneWorld(world: Readonly<WorldConfig>): WorldConfig {
  return { ...world };
}

function finiteMean(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export class TrainerEngine {
  private readonly emit: (event: TrainerEvent) => void;
  private readonly schedule: (task: () => void) => void;
  private readonly now: () => number;
  private readonly savedAt: () => string;
  private readonly chunkSize: number;
  private status: TrainerEngineStatus = "uninitialized";
  private run?: ActiveRun;
  private partial?: PartialGeneration;
  private scheduleToken = 0;

  constructor({
    emit,
    schedule = defaultSchedule,
    now = defaultNow,
    savedAt = defaultSavedAt,
    chunkSize = 4,
  }: TrainerEngineDependencies) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
      throw new RangeError("Trainer chunkSize must be a positive safe integer.");
    }
    this.emit = emit;
    this.schedule = schedule;
    this.now = now;
    this.savedAt = savedAt;
    this.chunkSize = chunkSize;
  }

  getStatus() {
    return this.status;
  }

  handle(command: TrainerCommand) {
    switch (command.type) {
      case "INITIALIZE":
        this.initialize(command);
        break;
      case "START":
        this.start();
        break;
      case "PAUSE":
        this.pause();
        break;
      case "RESET":
        this.reset(command);
        break;
      case "CURRICULUM":
        this.setCurriculum(command.level);
        break;
      case "CHECKPOINT":
        this.emitCheckpoint();
        break;
    }
  }

  private emitError(
    code: TrainerErrorCode,
    message: string,
    recoverable: boolean,
  ) {
    this.emit({ type: "ERROR", code, message, recoverable });
  }

  private initialize(command: Extract<TrainerCommand, { type: "INITIALIZE" }>) {
    if (this.run) {
      this.emitError("INVALID_STATE", "Trainer is already initialized.", true);
      return;
    }

    try {
      let run: ActiveRun;
      let restored = false;
      if (command.checkpoint !== undefined) {
        const checkpoint = restoreRunCheckpoint(command.checkpoint);
        run = {
          runId: checkpoint.runId,
          world: cloneWorld(checkpoint.world),
          state: checkpoint.state,
          metricHistory: [...checkpoint.metricHistory],
          lastCheckpoint: createRunCheckpoint({
            runId: checkpoint.runId,
            savedAt: checkpoint.savedAt,
            world: checkpoint.world,
            state: checkpoint.state,
            metricHistory: checkpoint.metricHistory,
          }),
        };
        restored = true;
      } else {
        if (command.runId === undefined || command.runSeed === undefined) {
          throw new Error("Fresh initialization requires runId and runSeed.");
        }
        const world = cloneWorld(command.world ?? WORLD_CONFIG);
        const state = createEvolutionRun({
          runSeed: command.runSeed,
          config: command.evolutionConfig,
        });
        run = {
          runId: command.runId,
          world,
          state,
          metricHistory: [],
          lastCheckpoint: createRunCheckpoint({
            runId: command.runId,
            savedAt: this.savedAt(),
            world,
            state,
            metricHistory: [],
          }),
        };
      }

      this.run = run;
      this.partial = undefined;
      this.status = "paused";
      this.scheduleToken += 1;
      this.emitReady(restored);
    } catch (error) {
      this.emitError("INITIALIZATION_FAILED", errorMessage(error), false);
    }
  }

  private emitReady(restored: boolean) {
    const run = this.requireRun();
    this.emit({
      type: "READY",
      protocolVersion: TRAINER_PROTOCOL_VERSION,
      checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
      runId: run.runId,
      generation: run.state.generation,
      level: run.state.curriculum.level,
      status: this.status === "running" ? "running" : "paused",
      restored,
    });
  }

  private start() {
    if (!this.run) {
      this.emitError("INVALID_STATE", "Trainer must be initialized before starting.", true);
      return;
    }
    if (this.status === "running") {
      this.emitError("INVALID_STATE", "Trainer is already running.", true);
      return;
    }

    this.status = "running";
    const partial = this.ensurePartial();
    partial.lastActiveAt = this.now();
    const token = ++this.scheduleToken;
    this.scheduleChunk(token);
  }

  private pause() {
    if (!this.run) {
      this.emitError("INVALID_STATE", "Trainer must be initialized before pausing.", true);
      return;
    }

    if (this.status === "running" && this.partial) {
      this.recordElapsed(this.partial);
    }
    this.status = "paused";
    this.scheduleToken += 1;
    this.emitProgress();
  }

  private reset(command: Extract<TrainerCommand, { type: "RESET" }>) {
    if (!this.run) {
      this.emitError("INVALID_STATE", "Trainer must be initialized before resetting.", true);
      return;
    }

    try {
      const world = cloneWorld(command.world ?? this.run.world);
      const state = createEvolutionRun({
        runSeed: command.runSeed,
        config: command.evolutionConfig ?? this.run.state.config,
      });
      this.status = "paused";
      this.partial = undefined;
      this.scheduleToken += 1;
      this.run = {
        runId: command.runId,
        world,
        state,
        metricHistory: [],
        lastCheckpoint: createRunCheckpoint({
          runId: command.runId,
          savedAt: this.savedAt(),
          world,
          state,
          metricHistory: [],
        }),
      };
      this.emitReady(false);
    } catch (error) {
      this.emitError("INITIALIZATION_FAILED", errorMessage(error), false);
    }
  }

  private setCurriculum(level: CurriculumLevel) {
    if (!this.run) {
      this.emitError(
        "INVALID_STATE",
        "Trainer must be initialized before changing curriculum.",
        true,
      );
      return;
    }
    if (this.status === "running") {
      this.emitError("INVALID_STATE", "Pause training before changing curriculum.", true);
      return;
    }
    if (this.partial) {
      this.emitError(
        "INVALID_STATE",
        "Reset or complete the partial generation before changing curriculum.",
        true,
      );
      return;
    }

    try {
      const previousLevel = this.run.state.curriculum.level;
      const state = setCurriculumLevel(this.run.state, level);
      const checkpoint = createRunCheckpoint({
        runId: this.run.runId,
        savedAt: this.savedAt(),
        world: this.run.world,
        state,
        metricHistory: this.run.metricHistory,
      });
      this.run.state = state;
      this.partial = undefined;
      this.scheduleToken += 1;
      this.run.lastCheckpoint = checkpoint;
      this.emit({
        type: "LEVEL",
        runId: this.run.runId,
        generation: this.run.state.generation,
        previousLevel,
        level,
      });
      this.emit({
        type: "CHECKPOINT",
        runId: this.run.runId,
        checkpoint: this.run.lastCheckpoint,
      });
    } catch (error) {
      this.emitError("CHECKPOINT_FAILED", errorMessage(error), true);
    }
  }

  private emitCheckpoint() {
    if (!this.run) {
      this.emitError(
        "INVALID_STATE",
        "Trainer must be initialized before requesting a checkpoint.",
        true,
      );
      return;
    }
    this.emit({
      type: "CHECKPOINT",
      runId: this.run.runId,
      checkpoint: this.run.lastCheckpoint,
    });
  }

  private requireRun() {
    if (!this.run) throw new Error("Trainer is not initialized.");
    return this.run;
  }

  private ensurePartial() {
    if (this.partial) return this.partial;
    const run = this.requireRun();
    this.partial = {
      generation: run.state.generation,
      level: run.state.curriculum.level,
      episodeSeeds: deriveGenerationEpisodeSeeds(
        run.state.runSeed,
        run.state.generation,
        run.state.config.episodesPerGenome,
      ),
      evaluations: [],
      lastActiveAt: this.now(),
      elapsedMilliseconds: 0,
    };
    return this.partial;
  }

  private scheduleChunk(token: number) {
    this.schedule(() => this.processChunk(token));
  }

  private processChunk(token: number) {
    if (token !== this.scheduleToken || this.status !== "running" || !this.run) {
      return;
    }

    const partial = this.ensurePartial();
    try {
      const stop = Math.min(
        partial.evaluations.length + this.chunkSize,
        this.run.state.population.length,
      );
      while (partial.evaluations.length < stop) {
        const populationIndex = partial.evaluations.length;
        partial.evaluations.push(
          evaluateGenome({
            genome: this.run.state.population[populationIndex],
            populationIndex,
            episodeSeeds: partial.episodeSeeds,
            level: partial.level,
            world: this.run.world,
          }),
        );
      }
      this.recordElapsed(partial);
      this.emitProgress();

      if (partial.evaluations.length === this.run.state.population.length) {
        this.finishGeneration(partial);
      }
      if (token === this.scheduleToken && this.status === "running") {
        this.scheduleChunk(token);
      }
    } catch (error) {
      this.status = "paused";
      this.partial = undefined;
      this.scheduleToken += 1;
      this.emitError("EVALUATION_FAILED", errorMessage(error), false);
    }
  }

  private recordElapsed(partial: PartialGeneration) {
    const now = this.now();
    partial.elapsedMilliseconds += Math.max(0, now - partial.lastActiveAt);
    partial.lastActiveAt = now;
  }

  private emitProgress() {
    const run = this.requireRun();
    const partial = this.partial;
    const completedGenomes = partial?.evaluations.length ?? 0;
    const episodesPerGenome = run.state.config.episodesPerGenome;
    this.emit({
      type: "PROGRESS",
      runId: run.runId,
      generation: partial?.generation ?? run.state.generation,
      level: partial?.level ?? run.state.curriculum.level,
      status: this.status === "running" ? "running" : "paused",
      completedGenomes,
      totalGenomes: run.state.population.length,
      completedEpisodes: completedGenomes * episodesPerGenome,
      totalEpisodes: run.state.population.length * episodesPerGenome,
      elapsedMilliseconds: partial?.elapsedMilliseconds ?? 0,
    });
  }

  private finishGeneration(partial: PartialGeneration) {
    const run = this.requireRun();
    const evaluation: PopulationEvaluation = {
      generation: partial.generation,
      level: partial.level,
      episodeSeeds: partial.episodeSeeds,
      genomes: partial.evaluations,
    };
    const previousLevel = run.state.curriculum.level;
    const result = completeEvaluatedGeneration(run.state, evaluation);
    const best = result.ranked[0];
    const metric: GenerationMetric = {
      generation: evaluation.generation,
      level: evaluation.level,
      bestFitness: Number.isFinite(best.fitness) ? best.fitness : 0,
      meanFitness: finiteMean(evaluation.genomes.map((item) => item.fitness)),
      championSurvivalRate: best.survivalRate,
      medianSurvivalRate: result.medianSurvivalRate,
      durationMilliseconds: partial.elapsedMilliseconds,
      curriculumAdvanced: result.curriculumAdvanced,
    };
    const metricHistory = [...run.metricHistory, metric];
    const checkpoint = createRunCheckpoint({
      runId: run.runId,
      savedAt: this.savedAt(),
      world: run.world,
      state: result.state,
      metricHistory,
    });

    run.state = result.state;
    run.metricHistory = metricHistory;
    run.lastCheckpoint = checkpoint;
    this.partial = undefined;
    this.emit({ type: "GENERATION", runId: run.runId, metric });
    if (run.state.curriculum.level !== previousLevel) {
      this.emit({
        type: "LEVEL",
        runId: run.runId,
        generation: run.state.generation,
        previousLevel,
        level: run.state.curriculum.level,
      });
    }
    this.emit({
      type: "CHECKPOINT",
      runId: run.runId,
      checkpoint: run.lastCheckpoint,
    });
  }
}
