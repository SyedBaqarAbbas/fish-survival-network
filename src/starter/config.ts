import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution/config";
import type { EvolutionConfig } from "@/evolution/types";
import type { CurriculumLevel } from "@/simulation/types";

export const STARTER_RUN_ID = "bundled-level-6-v1" as const;
export const STARTER_RUN_SEED = 85_622_289 as const;
export const STARTER_SAVED_AT = "2026-07-12T00:00:00.000Z" as const;
export const STARTER_REPLAY_SOURCE_ID =
  "bundled-level-6-v1:generation:37" as const;
export const STARTER_REPLAY_SEED = 42 as const;

export const STARTER_EVOLUTION_CONFIG = Object.freeze({
  ...DEFAULT_EVOLUTION_CONFIG,
  eliteCount: 16,
  tournamentSize: 7,
  mutationProbability: 0.18,
  mutationStandardDeviation: 0.25,
}) satisfies Readonly<EvolutionConfig>;

export interface StarterLevelPlanEntry {
  level: CurriculumLevel;
  generations: number;
}

export const STARTER_LEVEL_PLAN = Object.freeze([
  Object.freeze({ level: 0, generations: 3 }),
  Object.freeze({ level: 1, generations: 3 }),
  Object.freeze({ level: 2, generations: 3 }),
  Object.freeze({ level: 3, generations: 3 }),
  Object.freeze({ level: 4, generations: 3 }),
  Object.freeze({ level: 5, generations: 3 }),
  Object.freeze({ level: 6, generations: 20 }),
]) satisfies readonly StarterLevelPlanEntry[];

export const STARTER_COMPLETED_GENERATIONS = STARTER_LEVEL_PLAN.reduce(
  (total, stage) => total + stage.generations,
  0,
);
export const STARTER_FINAL_EVALUATED_GENERATION =
  STARTER_COMPLETED_GENERATIONS - 1;
export const STARTER_EXPECTED_CHAMPION_ID = "g37-i60" as const;
export const STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256 =
  "9cc42380e7c336eba899458a4fcaf1fa97bdf415cc00adfd21464380f2a6cbb3" as const;
export const STARTER_EXPECTED_ARTIFACT_SHA256 =
  "f9d2c8e671da1bbd40ff2c5143366446083cfd30101e29d214c1d75fb53f0212" as const;

export const STARTER_HELD_OUT_RUN_SEED = 0xdeca_fbad as const;
export const STARTER_HELD_OUT_GENERATION = 90 as const;
export const STARTER_HELD_OUT_EPISODE_COUNT = 8 as const;
export const STARTER_EXPECTED_HELD_OUT_SURVIVORS = 7 as const;
export const STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS =
  13.447_916_666_7 as const;
export const STARTER_HELD_OUT_MEAN_TOLERANCE = 1e-10;

export const STARTER_ARTIFACT_FILENAME = "level-6-starter.v1.json" as const;
export const STARTER_CHECKSUM_FILENAME =
  "level-6-starter.v1.json.sha256" as const;

export function starterLevelForGeneration(generation: number): CurriculumLevel {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation >= STARTER_COMPLETED_GENERATIONS
  ) {
    throw new RangeError(
      `Starter generation must be between 0 and ${STARTER_FINAL_EVALUATED_GENERATION}.`,
    );
  }

  let cursor = 0;
  for (const stage of STARTER_LEVEL_PLAN) {
    cursor += stage.generations;
    if (generation < cursor) return stage.level;
  }
  throw new Error("Starter level plan is incomplete.");
}

export function starterChampionGeneration(level: CurriculumLevel) {
  let cursor = 0;
  for (const stage of STARTER_LEVEL_PLAN) {
    cursor += stage.generations;
    if (stage.level === level) return cursor - 1;
  }
  throw new Error(`Starter level plan is missing level ${level}.`);
}
