import { SeededRandom } from "@/simulation/random";
import type { CurriculumLevel } from "@/simulation/types";

import {
  CURRICULUM_STABLE_GENERATIONS,
  CURRICULUM_SURVIVAL_THRESHOLD,
  UNLOCKED_WEIGHT_STANDARD_DEVIATION,
} from "./config";
import { cloneGenome } from "./genome";
import { getInputsUnlockedAtLevel } from "./inputs";
import { gaussianRandom } from "./stochastic";
import type {
  CurriculumChampion,
  CurriculumState,
  EvolutionConfig,
  GenomeEvaluation,
  NetworkGenome,
} from "./types";

export function createCurriculumState(level: CurriculumLevel = 0): CurriculumState {
  return { level, stableGenerations: 0, champions: {} };
}

function cloneEvaluation(evaluation: Readonly<GenomeEvaluation>): GenomeEvaluation {
  return {
    ...evaluation,
    episodes: evaluation.episodes.map((episode) => ({
      ...episode,
      stats: { ...episode.stats },
    })),
  };
}

function createChampion(
  level: CurriculumLevel,
  generation: number,
  genome: Readonly<NetworkGenome>,
  evaluation: Readonly<GenomeEvaluation>,
): CurriculumChampion {
  return {
    level,
    generation,
    genome: cloneGenome(genome),
    evaluation: cloneEvaluation(evaluation),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function initializeNewInputWeights(
  population: readonly Readonly<NetworkGenome>[],
  nextLevel: CurriculumLevel,
  random: SeededRandom,
  config: Readonly<EvolutionConfig>,
) {
  const newInputs = getInputsUnlockedAtLevel(nextLevel);
  return population.map((source) => {
    const genome = cloneGenome(source);
    for (const inputIndex of newInputs) {
      if (inputIndex >= genome.inputCount) {
        throw new RangeError("Unlocked input is outside the genome topology.");
      }
      for (let hiddenIndex = 0; hiddenIndex < genome.hiddenCount; hiddenIndex += 1) {
        const weightIndex = hiddenIndex * genome.inputCount + inputIndex;
        genome.inputToHidden[weightIndex] = clamp(
          gaussianRandom(random) * UNLOCKED_WEIGHT_STANDARD_DEVIATION,
          config.minimumWeight,
          config.maximumWeight,
        );
      }
    }
    return genome;
  });
}

export interface UpdateCurriculumOptions {
  state: Readonly<CurriculumState>;
  medianSurvivalRate: number;
  generation: number;
  champion: Readonly<NetworkGenome>;
  championEvaluation: Readonly<GenomeEvaluation>;
  population: readonly Readonly<NetworkGenome>[];
  random: SeededRandom;
  config: Readonly<EvolutionConfig>;
}

export function updateCurriculum({
  state,
  medianSurvivalRate,
  generation,
  champion,
  championEvaluation,
  population,
  random,
  config,
}: UpdateCurriculumOptions) {
  const qualifies =
    Number.isFinite(medianSurvivalRate) &&
    medianSurvivalRate >= CURRICULUM_SURVIVAL_THRESHOLD;
  if (!qualifies) {
    return {
      state: { ...state, stableGenerations: 0 },
      population,
      advanced: false,
      archived: false,
    };
  }

  if (state.level === 6 && state.champions[6]) {
    return {
      state: { ...state, stableGenerations: 0 },
      population,
      advanced: false,
      archived: false,
    };
  }

  const stableGenerations = state.stableGenerations + 1;
  if (stableGenerations < CURRICULUM_STABLE_GENERATIONS) {
    return {
      state: { ...state, stableGenerations },
      population,
      advanced: false,
      archived: false,
    };
  }

  const champions = {
    ...state.champions,
    [state.level]: createChampion(
      state.level,
      generation,
      champion,
      championEvaluation,
    ),
  };
  if (state.level === 6) {
    return {
      state: { level: 6 as const, stableGenerations: 0, champions },
      population,
      advanced: false,
      archived: true,
    };
  }

  const nextLevel = (state.level + 1) as CurriculumLevel;
  return {
    state: { level: nextLevel, stableGenerations: 0, champions },
    population: initializeNewInputWeights(population, nextLevel, random, config),
    advanced: true,
    archived: true,
  };
}
