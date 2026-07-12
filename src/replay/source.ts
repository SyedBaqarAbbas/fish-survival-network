import { z } from "zod";

import {
  cloneGenome,
  createRandomGenome,
  FISH_NETWORK_TOPOLOGY,
  type NetworkGenome,
} from "@/evolution";
import {
  getEpisodeStepCount,
  SeededRandom,
  UINT32_MAX,
  WORLD_CONFIG,
  type CurriculumLevel,
  type WorldConfig,
} from "@/simulation";

export const REPLAY_FISH_COUNT = 48 as const;

export interface ReplaySourceEntry {
  genome: NetworkGenome;
  fitness: number | null;
  survivalRate: number | null;
}

export interface ReplaySource {
  sourceId: string;
  runId: string;
  generation: number;
  level: CurriculumLevel;
  world: WorldConfig;
  championGenomeId: string;
  entries: ReplaySourceEntry[];
}

const curriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const finiteFloat32Schema = (length: number) =>
  z
    .instanceof(Float32Array)
    .refine((value) => value.length === length, `Expected ${length} Float32 values.`)
    .refine((value) => value.every(Number.isFinite), "Values must be finite.");

const networkGenomeSchema: z.ZodType<NetworkGenome> = z.strictObject({
  id: z.string().trim().min(1).max(128),
  inputCount: z.literal(FISH_NETWORK_TOPOLOGY.inputCount),
  hiddenCount: z.literal(FISH_NETWORK_TOPOLOGY.hiddenCount),
  outputCount: z.literal(FISH_NETWORK_TOPOLOGY.outputCount),
  inputToHidden: finiteFloat32Schema(88),
  hiddenBias: finiteFloat32Schema(8),
  hiddenToOutput: finiteFloat32Schema(16),
  outputBias: finiteFloat32Schema(2),
});

const worldSchema: z.ZodType<WorldConfig> = z
  .strictObject({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    fixedDt: z.number().finite().positive(),
    episodeSeconds: z.number().finite().positive(),
  })
  .superRefine((world, context) => {
    try {
      getEpisodeStepCount(world);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid replay world.",
      });
    }
  });

const replaySourceEntrySchema: z.ZodType<ReplaySourceEntry> = z.strictObject({
  genome: networkGenomeSchema,
  fitness: z.number().finite().nullable(),
  survivalRate: z.number().finite().min(0).max(1).nullable(),
});

export const replaySourceSchema: z.ZodType<ReplaySource> = z
  .strictObject({
    sourceId: z.string().trim().min(1).max(256),
    runId: z.string().trim().min(1).max(128),
    generation: z.number().int().min(0).max(UINT32_MAX),
    level: curriculumLevelSchema,
    world: worldSchema,
    championGenomeId: z.string().trim().min(1).max(128),
    entries: z.array(replaySourceEntrySchema).length(REPLAY_FISH_COUNT),
  })
  .superRefine((source, context) => {
    const ids = new Set<string>();
    source.entries.forEach((entry, index) => {
      if (ids.has(entry.genome.id)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "genome", "id"],
          message: `Duplicate replay genome id ${entry.genome.id}.`,
        });
      }
      ids.add(entry.genome.id);
    });
    if (!ids.has(source.championGenomeId)) {
      context.addIssue({
        code: "custom",
        path: ["championGenomeId"],
        message: "Replay champion must be present in the ordered entries.",
      });
    }
  });

export function assertReplaySource(source: unknown): asserts source is ReplaySource {
  replaySourceSchema.parse(source);
}

export function cloneReplaySource(source: ReplaySource): ReplaySource {
  assertReplaySource(source);
  return {
    sourceId: source.sourceId,
    runId: source.runId,
    generation: source.generation,
    level: source.level,
    world: { ...source.world },
    championGenomeId: source.championGenomeId,
    entries: source.entries.map((entry) => ({
      genome: cloneGenome(entry.genome),
      fitness: entry.fitness,
      survivalRate: entry.survivalRate,
    })),
  };
}

export function createDemoReplaySource(seed = 42): ReplaySource {
  const random = new SeededRandom(seed);
  const entries = Array.from({ length: REPLAY_FISH_COUNT }, (_, index) => ({
    genome: createRandomGenome(`demo-${seed}-i${index}`, random, FISH_NETWORK_TOPOLOGY, 6),
    fitness: null,
    survivalRate: null,
  }));
  return {
    sourceId: `demo-${seed}`,
    runId: "bundled-demo",
    generation: 0,
    level: 6,
    world: { ...WORLD_CONFIG },
    championGenomeId: entries[0].genome.id,
    entries,
  };
}
