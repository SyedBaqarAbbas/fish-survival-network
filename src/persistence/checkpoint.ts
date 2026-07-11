import { z } from "zod";

import { validateEvolutionConfig } from "@/evolution/config";
import { assertGenomeShape } from "@/evolution/genome";
import {
  FISH_NETWORK_TOPOLOGY,
  type CurriculumChampion,
  type EvolutionRunState,
  type NetworkGenome,
} from "@/evolution/types";
import { getEpisodeStepCount } from "@/simulation/config";
import { deriveEpisodeSeed } from "@/simulation/random";

import {
  CHECKPOINT_SCHEMA_VERSION,
  RUN_CHECKPOINT_KIND,
  type CheckpointValidationIssue,
  type CheckpointValidationReason,
  type CreateRunCheckpointOptions,
  type GenerationMetric,
  type ParseRunCheckpointResult,
  type RestoredRunCheckpoint,
  type RunCheckpoint,
} from "./types";

const FLOAT32_ENCODING = "f32-le-base64" as const;
const MAX_VALIDATION_ISSUES = 50;

const CurriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const WorldConfigSchema = z.strictObject({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fixedDt: z.number().finite().positive(),
  episodeSeconds: z.number().finite().positive(),
});

export const GenerationMetricSchema = z.strictObject({
  generation: z.uint32(),
  level: CurriculumLevelSchema,
  bestFitness: z.number().finite(),
  meanFitness: z.number().finite(),
  championSurvivalRate: z.number().finite().min(0).max(1),
  medianSurvivalRate: z.number().finite().min(0).max(1),
  durationMilliseconds: z.number().finite().nonnegative(),
  curriculumAdvanced: z.boolean(),
});

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeFloat32Vector(value: Float32Array) {
  const bytes = new Uint8Array(value.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value[index], true);
  }
  return {
    encoding: FLOAT32_ENCODING,
    length: value.length,
    data: bytesToBase64(bytes),
  };
}

function decodeFloat32Vector(data: string, length: number) {
  const bytes = base64ToBytes(data);
  if (bytes.byteLength !== length * Float32Array.BYTES_PER_ELEMENT) {
    throw new RangeError(`Expected ${length * Float32Array.BYTES_PER_ELEMENT} bytes.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    value[index] = view.getFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      true,
    );
  }
  return value;
}

function createFloat32VectorCodec(length: number) {
  const byteLength = length * Float32Array.BYTES_PER_ELEMENT;
  const base64Length = 4 * Math.ceil(byteLength / 3);
  return z.codec(
    z.strictObject({
      encoding: z.literal(FLOAT32_ENCODING),
      length: z.literal(length),
      data: z
        .base64()
        .length(base64Length)
        .refine((data) => {
          try {
            const bytes = base64ToBytes(data);
            return (
              bytes.byteLength === byteLength && bytesToBase64(bytes) === data
            );
          } catch {
            return false;
          }
        }, "Float32 payload must use canonical Base64 for the exact byte length."),
    }),
    z
      .instanceof(Float32Array)
      .refine((value) => value.length === length, {
        message: `Expected ${length} Float32 values.`,
      })
      .refine((value) => value.every(Number.isFinite), {
        message: "Float32 vectors must contain only finite values.",
      }),
    {
      decode: (value) => decodeFloat32Vector(value.data, length),
      encode: (value) => encodeFloat32Vector(value),
    },
  );
}

const NetworkGenomeCodec = z.strictObject({
  id: z.string().trim().min(1).max(128),
  inputCount: z.literal(FISH_NETWORK_TOPOLOGY.inputCount),
  hiddenCount: z.literal(FISH_NETWORK_TOPOLOGY.hiddenCount),
  outputCount: z.literal(FISH_NETWORK_TOPOLOGY.outputCount),
  inputToHidden: createFloat32VectorCodec(88),
  hiddenBias: createFloat32VectorCodec(8),
  hiddenToOutput: createFloat32VectorCodec(16),
  outputBias: createFloat32VectorCodec(2),
});

const FitnessStatsSchema = z.strictObject({
  aliveSeconds: z.number().finite().nonnegative(),
  survived: z.boolean(),
  meanPredatorDistance: z.number().finite().min(0).max(1),
  wallCollisions: z.number().int().nonnegative(),
  meanAccelerationSquared: z.number().finite().min(0).max(1),
});

const EpisodeEvaluationSchema = z.strictObject({
  seed: z.uint32(),
  fitness: z.number().finite(),
  stats: FitnessStatsSchema,
});

const GenomeEvaluationSchema = z.strictObject({
  genomeId: z.string().trim().min(1).max(128),
  populationIndex: z.number().int().nonnegative(),
  fitness: z.number().finite(),
  survivalRate: z.number().finite().min(0).max(1),
  meanAliveSeconds: z.number().finite().nonnegative(),
  episodes: z.array(EpisodeEvaluationSchema).min(1),
});

const CurriculumChampionCodec = z.strictObject({
  level: CurriculumLevelSchema,
  generation: z.uint32(),
  genome: NetworkGenomeCodec,
  evaluation: GenomeEvaluationSchema,
});

const EvolutionConfigSchema = z.strictObject({
  populationSize: z.number().int().positive(),
  eliteCount: z.number().int().positive(),
  tournamentSize: z.number().int().positive(),
  crossoverProbability: z.number().finite().min(0).max(1),
  mutationProbability: z.number().finite().min(0).max(1),
  mutationStandardDeviation: z.number().finite().nonnegative(),
  episodesPerGenome: z.number().int().positive(),
  minimumWeight: z.number().finite(),
  maximumWeight: z.number().finite(),
});

const DecodedCheckpointSchema = z
  .strictObject({
    schemaVersion: z.literal(CHECKPOINT_SCHEMA_VERSION),
    kind: z.literal(RUN_CHECKPOINT_KIND),
    runId: z.string().trim().min(1).max(128),
    savedAt: z.iso.datetime({ offset: true }),
    world: WorldConfigSchema,
    evolution: z.strictObject({
      runSeed: z.uint32(),
      generation: z.uint32(),
      randomState: z.uint32(),
      population: z.array(NetworkGenomeCodec).min(1),
      curriculum: z.strictObject({
        level: CurriculumLevelSchema,
        stableGenerations: z.number().int().min(0).max(4),
        champions: z.array(CurriculumChampionCodec).max(7),
      }),
      config: EvolutionConfigSchema,
    }),
    metricHistory: z.array(GenerationMetricSchema),
  })
  .superRefine((checkpoint, context) => {
    try {
      validateEvolutionConfig(checkpoint.evolution.config);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["evolution", "config"],
        message:
          error instanceof Error ? error.message : "Invalid evolution config.",
      });
    }

    try {
      getEpisodeStepCount(checkpoint.world);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["world"],
        message: error instanceof Error ? error.message : "Invalid world config.",
      });
    }

    const { evolution, metricHistory } = checkpoint;
    if (evolution.population.length !== evolution.config.populationSize) {
      context.addIssue({
        code: "custom",
        path: ["evolution", "population"],
        message: "Population length must equal config.populationSize.",
      });
    }

    const genomeIds = new Set<string>();
    evolution.population.forEach((genome, index) => {
      if (genomeIds.has(genome.id)) {
        context.addIssue({
          code: "custom",
          path: ["evolution", "population", index, "id"],
          message: `Duplicate genome id ${genome.id}.`,
        });
      }
      genomeIds.add(genome.id);
    });

    const championLevels = new Set<number>();
    evolution.curriculum.champions.forEach((champion, championIndex) => {
      const path = [
        "evolution",
        "curriculum",
        "champions",
        championIndex,
      ] as const;
      if (championLevels.has(champion.level)) {
        context.addIssue({
          code: "custom",
          path: [...path, "level"],
          message: `Duplicate champion for level ${champion.level}.`,
        });
      }
      championLevels.add(champion.level);
      if (champion.generation >= evolution.generation) {
        context.addIssue({
          code: "custom",
          path: [...path, "generation"],
          message: "Champion generation must already be completed.",
        });
      }
      if (champion.evaluation.genomeId !== champion.genome.id) {
        context.addIssue({
          code: "custom",
          path: [...path, "evaluation", "genomeId"],
          message: "Champion evaluation must reference the champion genome.",
        });
      }
      if (
        champion.evaluation.populationIndex >=
        evolution.config.populationSize
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, "evaluation", "populationIndex"],
          message: "Champion population index is outside the configured population.",
        });
      }
      if (
        champion.evaluation.episodes.length !==
        evolution.config.episodesPerGenome
      ) {
        context.addIssue({
          code: "custom",
          path: [...path, "evaluation", "episodes"],
          message: "Champion episode count must match config.episodesPerGenome.",
        });
      }
      champion.evaluation.episodes.forEach((episode, episodeIndex) => {
        if (episode.stats.aliveSeconds > checkpoint.world.episodeSeconds) {
          context.addIssue({
            code: "custom",
            path: [
              ...path,
              "evaluation",
              "episodes",
              episodeIndex,
              "stats",
              "aliveSeconds",
            ],
            message: "Alive time cannot exceed the episode duration.",
          });
        }
        const expectedSeed = deriveEpisodeSeed(
          evolution.runSeed,
          champion.generation,
          episodeIndex,
        );
        if (episode.seed !== expectedSeed) {
          context.addIssue({
            code: "custom",
            path: [
              ...path,
              "evaluation",
              "episodes",
              episodeIndex,
              "seed",
            ],
            message: "Champion episode seed is inconsistent with the run.",
          });
        }
      });
    });

    if (metricHistory.length !== evolution.generation) {
      context.addIssue({
        code: "custom",
        path: ["metricHistory"],
        message: "Metric history must contain every completed generation.",
      });
    }
    metricHistory.forEach((metric, index) => {
      if (metric.generation !== index) {
        context.addIssue({
          code: "custom",
          path: ["metricHistory", index, "generation"],
          message: "Metric generations must be contiguous from zero.",
        });
      }
    });
  });

export const RunCheckpointCodec = DecodedCheckpointSchema;

type DecodedRunCheckpoint = z.output<typeof RunCheckpointCodec>;

function plainIssues(error: z.ZodError): CheckpointValidationIssue[] {
  return error.issues.slice(0, MAX_VALIDATION_ISSUES).map((issue) => ({
    path: issue.path.map((part) =>
      typeof part === "symbol" ? part.description ?? part.toString() : part,
    ),
    code: issue.code,
    message: issue.message,
  }));
}

function cloneWireCheckpoint(checkpoint: RunCheckpoint) {
  return structuredClone(checkpoint);
}

function mapChampionRecord(
  champions: EvolutionRunState["curriculum"]["champions"],
): Array<z.output<typeof CurriculumChampionCodec>> {
  return Object.values(champions)
    .filter((champion): champion is CurriculumChampion => champion !== undefined)
    .sort((left, right) => left.level - right.level)
    .map((champion) => ({
      ...champion,
      genome: toDecodedGenome(champion.genome),
    }));
}

function toDecodedGenome(
  genome: Readonly<NetworkGenome>,
): z.output<typeof NetworkGenomeCodec> {
  assertGenomeShape(genome);
  if (
    genome.inputCount !== FISH_NETWORK_TOPOLOGY.inputCount ||
    genome.hiddenCount !== FISH_NETWORK_TOPOLOGY.hiddenCount ||
    genome.outputCount !== FISH_NETWORK_TOPOLOGY.outputCount
  ) {
    throw new RangeError("Checkpoint genomes must use the fish network topology.");
  }
  return {
    id: genome.id,
    inputCount: FISH_NETWORK_TOPOLOGY.inputCount,
    hiddenCount: FISH_NETWORK_TOPOLOGY.hiddenCount,
    outputCount: FISH_NETWORK_TOPOLOGY.outputCount,
    inputToHidden: new Float32Array(genome.inputToHidden),
    hiddenBias: new Float32Array(genome.hiddenBias),
    hiddenToOutput: new Float32Array(genome.hiddenToOutput),
    outputBias: new Float32Array(genome.outputBias),
  };
}

function toDecodedCheckpoint({
  runId,
  savedAt = new Date().toISOString(),
  world,
  state,
  metricHistory,
}: CreateRunCheckpointOptions): DecodedRunCheckpoint {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    kind: RUN_CHECKPOINT_KIND,
    runId,
    savedAt,
    world: { ...world },
    evolution: {
      runSeed: state.runSeed,
      generation: state.generation,
      randomState: state.randomState,
      population: state.population.map(toDecodedGenome),
      curriculum: {
        level: state.curriculum.level,
        stableGenerations: state.curriculum.stableGenerations,
        champions: mapChampionRecord(state.curriculum.champions),
      },
      config: { ...state.config },
    },
    metricHistory: metricHistory.map((metric) => ({ ...metric })),
  };
}

function restoreDecodedCheckpoint(
  checkpoint: DecodedRunCheckpoint,
): RestoredRunCheckpoint {
  const champions: EvolutionRunState["curriculum"]["champions"] = {};
  for (const champion of checkpoint.evolution.curriculum.champions) {
    champions[champion.level] = champion as CurriculumChampion;
  }
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    kind: RUN_CHECKPOINT_KIND,
    runId: checkpoint.runId,
    savedAt: checkpoint.savedAt,
    world: { ...checkpoint.world },
    state: {
      runSeed: checkpoint.evolution.runSeed,
      generation: checkpoint.evolution.generation,
      randomState: checkpoint.evolution.randomState,
      population: checkpoint.evolution.population as NetworkGenome[],
      curriculum: {
        level: checkpoint.evolution.curriculum.level,
        stableGenerations: checkpoint.evolution.curriculum.stableGenerations,
        champions,
      },
      config: Object.freeze({ ...checkpoint.evolution.config }),
    },
    metricHistory: checkpoint.metricHistory.map(
      (metric): GenerationMetric => ({ ...metric }),
    ),
  };
}

export function createRunCheckpoint(
  options: CreateRunCheckpointOptions,
): RunCheckpoint {
  return z.encode(RunCheckpointCodec, toDecodedCheckpoint(options)) as RunCheckpoint;
}

const VersionProbeSchema = z.object({
  schemaVersion: z.number().int(),
});

export function parseRunCheckpoint(value: unknown): ParseRunCheckpointResult {
  const version = VersionProbeSchema.safeParse(value);
  if (!version.success) {
    return {
      success: false,
      reason: "INVALID_CHECKPOINT",
      issues: plainIssues(version.error),
    };
  }
  if (version.data.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    return {
      success: false,
      reason: "UNSUPPORTED_VERSION",
      issues: [
        {
          path: ["schemaVersion"],
          code: "unsupported_version",
          message: `Unsupported checkpoint schema version ${version.data.schemaVersion}.`,
        },
      ],
    };
  }

  const decoded = RunCheckpointCodec.safeParse(value);
  if (!decoded.success) {
    return {
      success: false,
      reason: "INVALID_CHECKPOINT",
      issues: plainIssues(decoded.error),
    };
  }
  return {
    success: true,
    checkpoint: cloneWireCheckpoint(value as RunCheckpoint),
    restored: restoreDecodedCheckpoint(decoded.data),
  };
}

export class CheckpointValidationError extends Error {
  readonly reason: CheckpointValidationReason;
  readonly issues: CheckpointValidationIssue[];

  constructor(
    reason: CheckpointValidationReason,
    issues: CheckpointValidationIssue[],
  ) {
    super(
      issues[0]?.message ??
        (reason === "UNSUPPORTED_VERSION"
          ? "Unsupported checkpoint version."
          : "Invalid checkpoint."),
    );
    this.name = "CheckpointValidationError";
    this.reason = reason;
    this.issues = issues;
  }
}

export function restoreRunCheckpoint(value: unknown): RestoredRunCheckpoint {
  const result = parseRunCheckpoint(value);
  if (!result.success) {
    throw new CheckpointValidationError(result.reason, result.issues);
  }
  return result.restored;
}

export const hydrateRunCheckpoint = restoreRunCheckpoint;

export function isRunCheckpoint(value: unknown): value is RunCheckpoint {
  return parseRunCheckpoint(value).success;
}

export function genomeFloat32Bytes(genome: Readonly<NetworkGenome>) {
  assertGenomeShape(genome);
  const vectors = [
    genome.inputToHidden,
    genome.hiddenBias,
    genome.hiddenToOutput,
    genome.outputBias,
  ];
  const bytes = new Uint8Array(
    vectors.reduce((total, vector) => total + vector.byteLength, 0),
  );
  let offset = 0;
  for (const vector of vectors) {
    const encoded = encodeFloat32Vector(vector);
    const vectorBytes = base64ToBytes(encoded.data);
    bytes.set(vectorBytes, offset);
    offset += vectorBytes.length;
  }
  return bytes;
}
