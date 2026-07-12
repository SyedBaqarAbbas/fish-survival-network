import { z } from "zod";

import type { CurriculumLevel, WorldConfig } from "@/simulation";

import {
  REPLAY_FISH_COUNT,
  replaySourceSchema,
  type ReplaySource,
} from "./source";

export const REPLAY_PROTOCOL_VERSION = 1 as const;
export const REPLAY_SPEEDS = [0.5, 1, 2] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayMappingEntry {
  fishIndex: number;
  genomeId: string;
  fitness: number | null;
  survivalRate: number | null;
}

export interface ReplayMappingEvent {
  type: "MAPPING";
  protocolVersion: typeof REPLAY_PROTOCOL_VERSION;
  episodeId: number;
  sequence: number;
  sourceId: string;
  runId: string;
  generation: number;
  level: CurriculumLevel;
  replaySeed: number;
  world: WorldConfig;
  championGenomeId: string;
  entries: ReplayMappingEntry[];
  selectedFishIndex: number | null;
  status: "paused" | "playing";
}

export interface ReplaySnapshotEvent {
  type: "SNAPSHOT";
  episodeId: number;
  sequence: number;
  simulationTime: number;
  positions: Float32Array;
  velocities: Float32Array;
  alive: Uint8Array;
  predator: Float32Array;
}

export interface ReplayCatchEvent {
  type: "CATCH";
  episodeId: number;
  sequence: number;
  simulationTime: number;
  fishIndex: number;
  genomeId: string;
  x: number;
  y: number;
}

export interface ReplayActivationEvent {
  type: "ACTIVATION";
  episodeId: number;
  sequence: number;
  simulationTime: number;
  fishIndex: number;
  genomeId: string;
  alive: boolean;
  fitness: number | null;
  survivalRate: number | null;
  inputs: Float32Array;
  hidden: Float32Array;
  outputs: Float32Array;
  inputToHidden: Float32Array;
  hiddenToOutput: Float32Array;
}

export interface ReplayEpisodeEndEvent {
  type: "EPISODE_END";
  episodeId: number;
  sequence: number;
  simulationTime: number;
  sourceId: string;
  survivors: number;
  caught: number;
}

export const REPLAY_ERROR_CODES = [
  "INVALID_COMMAND",
  "INVALID_STATE",
  "LOAD_FAILED",
  "SIMULATION_FAILED",
  "INVALID_EVENT",
  "WORKER_FAILED",
] as const;
export type ReplayErrorCode = (typeof REPLAY_ERROR_CODES)[number];

export interface ReplayErrorEvent {
  type: "ERROR";
  episodeId: number | null;
  sequence: number;
  code: ReplayErrorCode;
  message: string;
  recoverable: boolean;
}

export type ReplayEvent =
  | ReplayMappingEvent
  | ReplaySnapshotEvent
  | ReplayCatchEvent
  | ReplayActivationEvent
  | ReplayEpisodeEndEvent
  | ReplayErrorEvent;

export type ReplayCommand =
  | {
      type: "LOAD";
      protocolVersion: typeof REPLAY_PROTOCOL_VERSION;
      source: ReplaySource;
      replaySeed: number;
    }
  | { type: "PLAY"; protocolVersion: typeof REPLAY_PROTOCOL_VERSION }
  | { type: "PAUSE"; protocolVersion: typeof REPLAY_PROTOCOL_VERSION }
  | { type: "RESTART"; protocolVersion: typeof REPLAY_PROTOCOL_VERSION }
  | {
      type: "SPEED";
      protocolVersion: typeof REPLAY_PROTOCOL_VERSION;
      speed: ReplaySpeed;
    }
  | {
      type: "SELECT";
      protocolVersion: typeof REPLAY_PROTOCOL_VERSION;
      fishIndex: number | null;
    };

const protocolVersionSchema = z.literal(REPLAY_PROTOCOL_VERSION);
const safeSequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uint32Schema = z.number().int().min(0).max(0xffff_ffff);
const episodeIdSchema = safeSequenceSchema;
const curriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const worldSchema = z.strictObject({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fixedDt: z.number().finite().positive(),
  episodeSeconds: z.number().finite().positive(),
});
const fishIndexSchema = z.number().int().min(0).max(REPLAY_FISH_COUNT - 1);
const simpleCommandSchema = <Type extends "PLAY" | "PAUSE" | "RESTART">(
  type: Type,
) =>
  z.strictObject({
    type: z.literal(type),
    protocolVersion: protocolVersionSchema,
  });

export const replayCommandSchema: z.ZodType<ReplayCommand> = z.union([
  z.strictObject({
    type: z.literal("LOAD"),
    protocolVersion: protocolVersionSchema,
    source: replaySourceSchema,
    replaySeed: uint32Schema,
  }),
  simpleCommandSchema("PLAY"),
  simpleCommandSchema("PAUSE"),
  simpleCommandSchema("RESTART"),
  z.strictObject({
    type: z.literal("SPEED"),
    protocolVersion: protocolVersionSchema,
    speed: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
  }),
  z.strictObject({
    type: z.literal("SELECT"),
    protocolVersion: protocolVersionSchema,
    fishIndex: fishIndexSchema.nullable(),
  }),
]);

const finiteFloat32Schema = (length: number) =>
  z
    .instanceof(Float32Array)
    .refine((value) => value.length === length, `Expected ${length} Float32 values.`)
    .refine((value) => value.every(Number.isFinite), "Values must be finite.");

const mappingEntrySchema: z.ZodType<ReplayMappingEntry> = z.strictObject({
  fishIndex: fishIndexSchema,
  genomeId: z.string().trim().min(1).max(128),
  fitness: z.number().finite().nullable(),
  survivalRate: z.number().finite().min(0).max(1).nullable(),
});

const mappingEventSchema: z.ZodType<ReplayMappingEvent> = z
  .strictObject({
    type: z.literal("MAPPING"),
    protocolVersion: protocolVersionSchema,
    episodeId: episodeIdSchema,
    sequence: safeSequenceSchema,
    sourceId: z.string().trim().min(1).max(256),
    runId: z.string().trim().min(1).max(128),
    generation: uint32Schema,
    level: curriculumLevelSchema,
    replaySeed: uint32Schema,
    world: worldSchema,
    championGenomeId: z.string().trim().min(1).max(128),
    entries: z.array(mappingEntrySchema).length(REPLAY_FISH_COUNT),
    selectedFishIndex: fishIndexSchema.nullable(),
    status: z.union([z.literal("paused"), z.literal("playing")]),
  })
  .superRefine((event, context) => {
    event.entries.forEach((entry, index) => {
      if (entry.fishIndex !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "fishIndex"],
          message: "Mapping entries must remain in fish-index order.",
        });
      }
    });
    if (!event.entries.some((entry) => entry.genomeId === event.championGenomeId)) {
      context.addIssue({
        code: "custom",
        path: ["championGenomeId"],
        message: "Mapped champion genome is missing.",
      });
    }
  });

const snapshotEventSchema: z.ZodType<ReplaySnapshotEvent> = z
  .strictObject({
    type: z.literal("SNAPSHOT"),
    episodeId: episodeIdSchema,
    sequence: safeSequenceSchema,
    simulationTime: z.number().finite().nonnegative(),
    positions: finiteFloat32Schema(REPLAY_FISH_COUNT * 2),
    velocities: finiteFloat32Schema(REPLAY_FISH_COUNT * 2),
    alive: z
      .instanceof(Uint8Array)
      .refine((value) => value.length === REPLAY_FISH_COUNT)
      .refine((value) => value.every((flag) => flag === 0 || flag === 1)),
    predator: finiteFloat32Schema(4),
  })
  .superRefine((event, context) => {
    const buffer = event.positions.buffer;
    if (
      buffer !== event.velocities.buffer ||
      buffer !== event.alive.buffer ||
      buffer !== event.predator.buffer ||
      buffer.byteLength !== 832 ||
      event.positions.byteOffset !== 0 ||
      event.velocities.byteOffset !== 384 ||
      event.alive.byteOffset !== 768 ||
      event.predator.byteOffset !== 816
    ) {
      context.addIssue({
        code: "custom",
        message: "Replay snapshots must use the canonical packed buffer layout.",
      });
    }
  });

const catchEventSchema: z.ZodType<ReplayCatchEvent> = z.strictObject({
  type: z.literal("CATCH"),
  episodeId: episodeIdSchema,
  sequence: safeSequenceSchema,
  simulationTime: z.number().finite().nonnegative(),
  fishIndex: fishIndexSchema,
  genomeId: z.string().trim().min(1).max(128),
  x: z.number().finite(),
  y: z.number().finite(),
});

const activationEventSchema: z.ZodType<ReplayActivationEvent> = z.strictObject({
  type: z.literal("ACTIVATION"),
  episodeId: episodeIdSchema,
  sequence: safeSequenceSchema,
  simulationTime: z.number().finite().nonnegative(),
  fishIndex: fishIndexSchema,
  genomeId: z.string().trim().min(1).max(128),
  alive: z.boolean(),
  fitness: z.number().finite().nullable(),
  survivalRate: z.number().finite().min(0).max(1).nullable(),
  inputs: finiteFloat32Schema(11),
  hidden: finiteFloat32Schema(8),
  outputs: finiteFloat32Schema(2),
  inputToHidden: finiteFloat32Schema(88),
  hiddenToOutput: finiteFloat32Schema(16),
});

const episodeEndEventSchema: z.ZodType<ReplayEpisodeEndEvent> = z
  .strictObject({
    type: z.literal("EPISODE_END"),
    episodeId: episodeIdSchema,
    sequence: safeSequenceSchema,
    simulationTime: z.number().finite().nonnegative(),
    sourceId: z.string().trim().min(1).max(256),
    survivors: z.number().int().min(0).max(REPLAY_FISH_COUNT),
    caught: z.number().int().min(0).max(REPLAY_FISH_COUNT),
  })
  .superRefine((event, context) => {
    if (event.survivors + event.caught !== REPLAY_FISH_COUNT) {
      context.addIssue({
        code: "custom",
        message: "Episode survivor and catch counts must cover the replay roster.",
      });
    }
  });

const errorEventSchema: z.ZodType<ReplayErrorEvent> = z.strictObject({
  type: z.literal("ERROR"),
  episodeId: episodeIdSchema.nullable(),
  sequence: safeSequenceSchema,
  code: z.enum(REPLAY_ERROR_CODES),
  message: z.string().min(1),
  recoverable: z.boolean(),
});

export const replayEventSchema: z.ZodType<ReplayEvent> = z.union([
  mappingEventSchema,
  snapshotEventSchema,
  catchEventSchema,
  activationEventSchema,
  episodeEndEventSchema,
  errorEventSchema,
]);

export function isReplayCommand(value: unknown): value is ReplayCommand {
  return replayCommandSchema.safeParse(value).success;
}

export function isReplayEvent(value: unknown): value is ReplayEvent {
  return replayEventSchema.safeParse(value).success;
}
