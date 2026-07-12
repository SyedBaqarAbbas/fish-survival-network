import { SeededRandom } from "@/simulation/random";
import type { CurriculumLevel } from "@/simulation/types";

import { DEFAULT_EVOLUTION_CONFIG, validateEvolutionConfig } from "./config";
import {
  createCurriculumState,
  initializeNewInputWeights,
  updateCurriculum,
} from "./curriculum";
import {
  deriveGenerationEpisodeSeeds,
  evaluatePopulation,
} from "./evaluation";
import { medianSurvivalRate } from "./fitness";
import { reproducePopulation, rankGenomeEvaluations } from "./genetics";
import { cloneGenome, createRandomGenome } from "./genome";
import { getUnlockedInputIndices } from "./inputs";
import type {
  CreateEvolutionRunOptions,
  EvolveGenerationOptions,
  EvolutionConfig,
  EvolutionRunState,
  GenerationResult,
  NetworkGenome,
  PopulationEvaluation,
} from "./types";

export function createPopulation(
  size: number,
  random: SeededRandom,
  generation = 0,
) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError("Population size must be a positive safe integer.");
  }
  return Array.from({ length: size }, (_, index) =>
    createRandomGenome(`g${generation}-i${index}`, random),
  );
}

function ownConfig(config: Readonly<EvolutionConfig>) {
  validateEvolutionConfig(config);
  return Object.freeze({ ...config });
}

export function createEvolutionRun({
  runSeed,
  config = DEFAULT_EVOLUTION_CONFIG,
}: CreateEvolutionRunOptions): EvolutionRunState {
  const ownedConfig = ownConfig(config);
  const random = new SeededRandom(runSeed);
  const population = createPopulation(ownedConfig.populationSize, random);
  return {
    runSeed,
    generation: 0,
    randomState: random.getState(),
    population,
    curriculum: createCurriculumState(),
    config: ownedConfig,
  };
}

function findGenome(population: readonly NetworkGenome[], genomeId: string) {
  const genome = population.find((candidate) => candidate.id === genomeId);
  if (!genome) throw new Error(`Missing genome ${genomeId}.`);
  return genome;
}

function assertCurriculumLevel(level: number): asserts level is CurriculumLevel {
  if (!Number.isSafeInteger(level) || level < 0 || level > 6) {
    throw new RangeError("Curriculum level must be an integer between 0 and 6.");
  }
}

export function setCurriculumLevel(
  currentState: Readonly<EvolutionRunState>,
  targetLevel: CurriculumLevel,
): EvolutionRunState {
  assertCurriculumLevel(targetLevel);
  const random = new SeededRandom(currentState.randomState);
  let population = currentState.population.map((genome) => cloneGenome(genome));

  for (
    let level = currentState.curriculum.level + 1;
    level <= targetLevel;
    level += 1
  ) {
    population = initializeNewInputWeights(
      population,
      level as CurriculumLevel,
      random,
      currentState.config,
    );
  }

  const unlockedInputs = new Set(getUnlockedInputIndices(targetLevel));
  for (const genome of population) {
    for (let hiddenIndex = 0; hiddenIndex < genome.hiddenCount; hiddenIndex += 1) {
      const offset = hiddenIndex * genome.inputCount;
      for (let inputIndex = 0; inputIndex < genome.inputCount; inputIndex += 1) {
        if (!unlockedInputs.has(inputIndex)) {
          genome.inputToHidden[offset + inputIndex] = 0;
        }
      }
    }
  }

  return {
    ...currentState,
    randomState: random.getState(),
    population,
    curriculum: {
      ...currentState.curriculum,
      level: targetLevel,
      stableGenerations: 0,
    },
  };
}

function assertEvaluationMatchesState(
  currentState: Readonly<EvolutionRunState>,
  evaluation: Readonly<PopulationEvaluation>,
) {
  if (evaluation.generation !== currentState.generation) {
    throw new Error("Evaluation generation does not match the run state.");
  }
  if (evaluation.level !== currentState.curriculum.level) {
    throw new Error("Evaluation level does not match the run state.");
  }
  if (currentState.population.length !== currentState.config.populationSize) {
    throw new Error("Run population size does not match the evolution config.");
  }

  const expectedSeeds = deriveGenerationEpisodeSeeds(
    currentState.runSeed,
    currentState.generation,
    currentState.config.episodesPerGenome,
  );
  if (
    evaluation.episodeSeeds.length !== expectedSeeds.length ||
    evaluation.episodeSeeds.some((seed, index) => seed !== expectedSeeds[index])
  ) {
    throw new Error("Evaluation seeds do not match the run state.");
  }
  if (evaluation.genomes.length !== currentState.population.length) {
    throw new Error("Evaluation count does not match the run population.");
  }

  const populationIds = new Set<string>();
  for (let index = 0; index < currentState.population.length; index += 1) {
    const genome = currentState.population[index];
    const genomeEvaluation = evaluation.genomes[index];
    if (populationIds.has(genome.id)) {
      throw new Error(`Duplicate genome ID ${genome.id}.`);
    }
    populationIds.add(genome.id);
    if (
      genomeEvaluation.populationIndex !== index ||
      genomeEvaluation.genomeId !== genome.id
    ) {
      throw new Error(`Evaluation does not match population index ${index}.`);
    }
    if (genomeEvaluation.episodes.length !== expectedSeeds.length) {
      throw new Error(`Evaluation for ${genome.id} has the wrong episode count.`);
    }
    if (
      genomeEvaluation.episodes.some(
        (episode, episodeIndex) => episode.seed !== expectedSeeds[episodeIndex],
      )
    ) {
      throw new Error(`Evaluation for ${genome.id} does not use the shared seeds.`);
    }
  }
}

export function completeEvaluatedGeneration(
  currentState: Readonly<EvolutionRunState>,
  evaluation: PopulationEvaluation,
): GenerationResult {
  assertEvaluationMatchesState(currentState, evaluation);
  const ranked = rankGenomeEvaluations(evaluation.genomes);
  const champion = cloneGenome(
    findGenome(currentState.population, ranked[0].genomeId),
  );
  const median = medianSurvivalRate(evaluation.genomes);
  const random = new SeededRandom(currentState.randomState);
  const reproduction = reproducePopulation({
    population: currentState.population,
    evaluations: evaluation.genomes,
    random,
    config: currentState.config,
    level: currentState.curriculum.level,
    nextGeneration: currentState.generation + 1,
  });
  const curriculum =
    currentState.config.automaticCurriculum === false
      ? {
          state: {
            ...currentState.curriculum,
            stableGenerations: 0,
          },
          population: reproduction.population,
          advanced: false,
        }
      : updateCurriculum({
          state: currentState.curriculum,
          medianSurvivalRate: median,
          generation: currentState.generation,
          champion,
          championEvaluation: ranked[0],
          population: reproduction.population,
          random,
          config: currentState.config,
        });
  const state: EvolutionRunState = {
    runSeed: currentState.runSeed,
    generation: currentState.generation + 1,
    randomState: random.getState(),
    population: curriculum.population.map((genome) => cloneGenome(genome)),
    curriculum: curriculum.state,
    config: currentState.config,
  };
  return {
    state,
    evaluation,
    ranked,
    medianSurvivalRate: median,
    champion,
    curriculumAdvanced: curriculum.advanced,
  };
}

export function evolveGeneration(
  currentState: Readonly<EvolutionRunState>,
  { world }: EvolveGenerationOptions = {},
): GenerationResult {
  const evaluation = evaluatePopulation(currentState.population, {
    runSeed: currentState.runSeed,
    generation: currentState.generation,
    level: currentState.curriculum.level,
    episodesPerGenome: currentState.config.episodesPerGenome,
    world,
  });
  return completeEvaluatedGeneration(currentState, evaluation);
}
