import type {
  EvolutionConfig,
  EvolutionRunState,
  GenomeEvaluation,
} from "@/evolution/types";
import type { ReplaySource } from "@/replay";
import type { CurriculumLevel, WorldConfig } from "@/simulation/types";

export const CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const RUN_CHECKPOINT_KIND = "run" as const;

export interface GenerationMetric {
  generation: number;
  level: CurriculumLevel;
  bestFitness: number;
  meanFitness: number;
  championSurvivalRate: number;
  medianSurvivalRate: number;
  durationMilliseconds: number;
  curriculumAdvanced: boolean;
}

export interface EncodedFloat32Vector {
  encoding: "f32-le-base64";
  length: number;
  data: string;
}

export interface SerializedNetworkGenome {
  id: string;
  inputCount: 11;
  hiddenCount: 8;
  outputCount: 2;
  inputToHidden: EncodedFloat32Vector;
  hiddenBias: EncodedFloat32Vector;
  hiddenToOutput: EncodedFloat32Vector;
  outputBias: EncodedFloat32Vector;
}

export interface SerializedCurriculumChampion {
  level: CurriculumLevel;
  generation: number;
  genome: SerializedNetworkGenome;
  evaluation: GenomeEvaluation;
}

export interface SerializedReplaySourceEntry {
  genome: SerializedNetworkGenome;
  fitness: number | null;
  survivalRate: number | null;
}

export interface SerializedReplaySource {
  sourceId: string;
  runId: string;
  generation: number;
  level: CurriculumLevel;
  championGenomeId: string;
  entries: SerializedReplaySourceEntry[];
}

export interface SerializedEvolutionRunState {
  runSeed: number;
  generation: number;
  randomState: number;
  population: SerializedNetworkGenome[];
  curriculum: {
    level: CurriculumLevel;
    stableGenerations: number;
    champions: SerializedCurriculumChampion[];
  };
  config: EvolutionConfig;
}

export interface RunCheckpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  kind: typeof RUN_CHECKPOINT_KIND;
  runId: string;
  savedAt: string;
  world: WorldConfig;
  evolution: SerializedEvolutionRunState;
  metricHistory: GenerationMetric[];
  replaySource?: SerializedReplaySource;
}

export interface RestoredRunCheckpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  kind: typeof RUN_CHECKPOINT_KIND;
  runId: string;
  savedAt: string;
  world: WorldConfig;
  state: EvolutionRunState;
  metricHistory: GenerationMetric[];
  replaySource?: ReplaySource;
}

export interface CreateRunCheckpointOptions {
  runId: string;
  savedAt?: string;
  world: Readonly<WorldConfig>;
  state: Readonly<EvolutionRunState>;
  metricHistory: readonly Readonly<GenerationMetric>[];
  replaySource?: Readonly<ReplaySource>;
}

export type CheckpointValidationReason =
  | "INVALID_CHECKPOINT"
  | "UNSUPPORTED_VERSION";

export interface CheckpointValidationIssue {
  path: Array<string | number>;
  code: string;
  message: string;
}

export type ParseRunCheckpointResult =
  | {
      success: true;
      checkpoint: RunCheckpoint;
      restored: RestoredRunCheckpoint;
    }
  | {
      success: false;
      reason: CheckpointValidationReason;
      issues: CheckpointValidationIssue[];
    };

export type PersistenceBackendName = "indexeddb" | "memory";

export type PersistenceWarningCode =
  | "INDEXED_DB_UNAVAILABLE"
  | "INDEXED_DB_WRITE_FAILED"
  | "CHECKPOINT_QUARANTINED"
  | "CHECKPOINT_REJECTED"
  | "CLEAR_FAILED";

export interface PersistenceWarning {
  code: PersistenceWarningCode;
  message: string;
  validationReason?: CheckpointValidationReason;
  issues?: CheckpointValidationIssue[];
}

export interface CheckpointRepositoryResult {
  checkpoint?: RunCheckpoint;
  backend: PersistenceBackendName;
  warning?: PersistenceWarning;
}

export interface CheckpointRepository {
  loadActive(): Promise<CheckpointRepositoryResult>;
  saveActive(checkpoint: RunCheckpoint): Promise<CheckpointRepositoryResult>;
  clearActive(): Promise<CheckpointRepositoryResult>;
  getLastKnownGood(): CheckpointRepositoryResult;
  close(): Promise<void>;
}

export interface QuarantinedCheckpoint {
  quarantinedAt: string;
  reason: CheckpointValidationReason;
  issues: CheckpointValidationIssue[];
  raw: unknown;
}
