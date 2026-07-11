import { CHECKPOINT_SCHEMA_VERSION } from "@/persistence/types";

export const TRAINER_PROTOCOL_VERSION = 1 as const;

export type TrainerCommand = {
  type: "INITIALIZE";
  protocolVersion: typeof TRAINER_PROTOCOL_VERSION;
};

export type TrainerEvent =
  | {
      type: "READY";
      protocolVersion: typeof TRAINER_PROTOCOL_VERSION;
      checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
    }
  | {
      type: "ERROR";
      message: string;
    };

export function isTrainerCommand(value: unknown): value is TrainerCommand {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<TrainerCommand>;
  return (
    candidate.type === "INITIALIZE" &&
    candidate.protocolVersion === TRAINER_PROTOCOL_VERSION
  );
}

export function isTrainerEvent(value: unknown): value is TrainerEvent {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const candidate = value as Partial<TrainerEvent>;
  if (candidate.type === "READY") {
    return (
      candidate.protocolVersion === TRAINER_PROTOCOL_VERSION &&
      candidate.checkpointSchemaVersion === CHECKPOINT_SCHEMA_VERSION
    );
  }

  return candidate.type === "ERROR" && typeof candidate.message === "string";
}
