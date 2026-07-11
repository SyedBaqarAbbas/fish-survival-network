import { z } from "zod";

import {
  CHECKPOINT_SCHEMA_VERSION,
  isRunCheckpoint,
  type GenerationMetric,
  type RunCheckpoint,
} from "@/persistence";

export const TRAINER_PROTOCOL_VERSION = 1 as const;

const uint32Schema = z.number().int().min(0).max(0xffff_ffff);
const curriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const evolutionConfigSchema = z.strictObject({
  populationSize: z.number().int().positive(),
  eliteCount: z.number().int().positive(),
  tournamentSize: z.number().int().positive(),
  crossoverProbability: z.number().min(0).max(1),
  mutationProbability: z.number().min(0).max(1),
  mutationStandardDeviation: z.number().finite().nonnegative(),
  episodesPerGenome: z.number().int().positive(),
  minimumWeight: z.number().finite(),
  maximumWeight: z.number().finite(),
});

const worldConfigSchema = z.strictObject({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fixedDt: z.number().finite().positive(),
  episodeSeconds: z.number().finite().positive(),
});

const runCheckpointSchema = z.custom<RunCheckpoint>(
  (value) => isRunCheckpoint(value),
  "Invalid run checkpoint.",
);

const protocolVersionSchema = z.literal(TRAINER_PROTOCOL_VERSION);

const initializeCommandSchema = z
  .strictObject({
    type: z.literal("INITIALIZE"),
    protocolVersion: protocolVersionSchema,
    checkpoint: runCheckpointSchema.optional(),
    runId: z.string().min(1).optional(),
    runSeed: uint32Schema.optional(),
    evolutionConfig: evolutionConfigSchema.optional(),
    world: worldConfigSchema.optional(),
  })
  .superRefine((command, context) => {
    const restoring = command.checkpoint !== undefined;
    const creating = command.runId !== undefined || command.runSeed !== undefined;
    if (restoring === creating) {
      context.addIssue({
        code: "custom",
        message: "Initialize requires either a checkpoint or a fresh run.",
      });
    }
    if (!restoring && (command.runId === undefined || command.runSeed === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Fresh initialization requires runId and runSeed.",
      });
    }
    if (
      restoring &&
      (command.runId !== undefined ||
        command.runSeed !== undefined ||
        command.evolutionConfig !== undefined ||
        command.world !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Checkpoint initialization cannot override checkpoint fields.",
      });
    }
  });

const resetCommandSchema = z.strictObject({
  type: z.literal("RESET"),
  protocolVersion: protocolVersionSchema,
  runId: z.string().min(1),
  runSeed: uint32Schema,
  evolutionConfig: evolutionConfigSchema.optional(),
  world: worldConfigSchema.optional(),
});

const simpleCommandSchema = <Type extends "START" | "PAUSE" | "CHECKPOINT">(
  type: Type,
) =>
  z.strictObject({
    type: z.literal(type),
    protocolVersion: protocolVersionSchema,
  });

export const trainerCommandSchema = z.union([
  initializeCommandSchema,
  simpleCommandSchema("START"),
  simpleCommandSchema("PAUSE"),
  resetCommandSchema,
  z.strictObject({
    type: z.literal("CURRICULUM"),
    protocolVersion: protocolVersionSchema,
    level: curriculumLevelSchema,
  }),
  simpleCommandSchema("CHECKPOINT"),
]);

export type TrainerCommand = z.infer<typeof trainerCommandSchema>;

const generationMetricSchema: z.ZodType<GenerationMetric> = z.strictObject({
  generation: z.number().int().nonnegative(),
  level: curriculumLevelSchema,
  bestFitness: z.number().finite(),
  meanFitness: z.number().finite(),
  championSurvivalRate: z.number().min(0).max(1),
  medianSurvivalRate: z.number().min(0).max(1),
  durationMilliseconds: z.number().finite().nonnegative(),
  curriculumAdvanced: z.boolean(),
});

const readyEventSchema = z.strictObject({
  type: z.literal("READY"),
  protocolVersion: protocolVersionSchema,
  checkpointSchemaVersion: z.literal(CHECKPOINT_SCHEMA_VERSION),
  runId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  level: curriculumLevelSchema,
  status: z.union([z.literal("paused"), z.literal("running")]),
  restored: z.boolean(),
});

const progressEventSchema = z.strictObject({
  type: z.literal("PROGRESS"),
  runId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  level: curriculumLevelSchema,
  status: z.union([z.literal("paused"), z.literal("running")]),
  completedGenomes: z.number().int().nonnegative(),
  totalGenomes: z.number().int().positive(),
  completedEpisodes: z.number().int().nonnegative(),
  totalEpisodes: z.number().int().positive(),
  elapsedMilliseconds: z.number().finite().nonnegative(),
});

export const TRAINER_ERROR_CODES = [
  "INVALID_COMMAND",
  "INVALID_STATE",
  "INITIALIZATION_FAILED",
  "EVALUATION_FAILED",
  "CHECKPOINT_FAILED",
] as const;

export type TrainerErrorCode = (typeof TRAINER_ERROR_CODES)[number];

const checkpointEventSchema = z
  .strictObject({
    type: z.literal("CHECKPOINT"),
    runId: z.string().min(1),
    checkpoint: runCheckpointSchema,
  })
  .superRefine((event, context) => {
    if (event.runId !== event.checkpoint.runId) {
      context.addIssue({
        code: "custom",
        path: ["runId"],
        message: "Checkpoint event runId must match the checkpoint runId.",
      });
    }
  });

export const trainerEventSchema = z.union([
  readyEventSchema,
  progressEventSchema,
  z.strictObject({
    type: z.literal("GENERATION"),
    runId: z.string().min(1),
    metric: generationMetricSchema,
  }),
  z.strictObject({
    type: z.literal("LEVEL"),
    runId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    previousLevel: curriculumLevelSchema,
    level: curriculumLevelSchema,
  }),
  checkpointEventSchema,
  z.strictObject({
    type: z.literal("ERROR"),
    code: z.enum(TRAINER_ERROR_CODES),
    message: z.string().min(1),
    recoverable: z.boolean(),
  }),
]);

export type TrainerEvent = z.infer<typeof trainerEventSchema>;

export function isTrainerCommand(value: unknown): value is TrainerCommand {
  return trainerCommandSchema.safeParse(value).success;
}

export function isTrainerEvent(value: unknown): value is TrainerEvent {
  return trainerEventSchema.safeParse(value).success;
}
