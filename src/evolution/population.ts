import { SeededRandom } from "@/simulation/random";

import { DEFAULT_EVOLUTION_CONFIG, validateEvolutionConfig } from "./config";
import { createCurriculumState, updateCurriculum } from "./curriculum";
import { evaluatePopulation } from "./evaluation";
import { medianSurvivalRate } from "./fitness";
import { reproducePopulation, rankGenomeEvaluations } from "./genetics";
import { cloneGenome, createRandomGenome } from "./genome";
import type {
  CreateEvolutionRunOptions,
  EvolveGenerationOptions,
  EvolutionConfig,
  EvolutionRunState,
  GenerationResult,
  NetworkGenome,
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
  const curriculum = updateCurriculum({
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
