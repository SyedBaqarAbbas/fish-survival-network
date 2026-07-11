export const CHECKPOINT_SCHEMA_VERSION = 1 as const;

export interface RunCheckpointHeader {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  runId: string;
  generation: number;
  level: number;
  seed: number;
  savedAt: string;
}
