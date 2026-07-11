import { SeededRandom } from "@/simulation/random";
import type { CurriculumLevel } from "@/simulation/types";

import { validateEvolutionConfig } from "./config";
import { cloneGenome, assertGenomeShape } from "./genome";
import { isInputUnlocked } from "./inputs";
import { gaussianRandom } from "./stochastic";
import type {
  EvolutionConfig,
  GenomeEvaluation,
  NetworkGenome,
} from "./types";

function finiteFitness(evaluation: Readonly<GenomeEvaluation>) {
  return Number.isFinite(evaluation.fitness) ? evaluation.fitness : undefined;
}

export function compareGenomeEvaluations(
  first: Readonly<GenomeEvaluation>,
  second: Readonly<GenomeEvaluation>,
) {
  const firstFitness = finiteFitness(first);
  const secondFitness = finiteFitness(second);
  if (firstFitness !== undefined && secondFitness === undefined) return -1;
  if (firstFitness === undefined && secondFitness !== undefined) return 1;
  if (
    firstFitness !== undefined &&
    secondFitness !== undefined &&
    firstFitness !== secondFitness
  ) {
    return secondFitness - firstFitness;
  }
  return first.populationIndex - second.populationIndex;
}

export function rankGenomeEvaluations(evaluations: readonly GenomeEvaluation[]) {
  return [...evaluations].sort(compareGenomeEvaluations);
}

function assertMatchingTopology(
  first: Readonly<NetworkGenome>,
  second: Readonly<NetworkGenome>,
) {
  assertGenomeShape(first);
  assertGenomeShape(second);
  if (
    first.inputCount !== second.inputCount ||
    first.hiddenCount !== second.hiddenCount ||
    first.outputCount !== second.outputCount
  ) {
    throw new RangeError("Parent genome topologies must match.");
  }
}

function crossoverArray(
  first: Float32Array,
  second: Float32Array,
  random: SeededRandom,
) {
  const child = new Float32Array(first.length);
  for (let index = 0; index < child.length; index += 1) {
    child[index] = random.next() < 0.5 ? first[index] : second[index];
  }
  return child;
}

export function uniformCrossover(
  first: Readonly<NetworkGenome>,
  second: Readonly<NetworkGenome>,
  childId: string,
  random: SeededRandom,
): NetworkGenome {
  assertMatchingTopology(first, second);
  return {
    id: childId,
    inputCount: first.inputCount,
    hiddenCount: first.hiddenCount,
    outputCount: first.outputCount,
    inputToHidden: crossoverArray(first.inputToHidden, second.inputToHidden, random),
    hiddenBias: crossoverArray(first.hiddenBias, second.hiddenBias, random),
    hiddenToOutput: crossoverArray(
      first.hiddenToOutput,
      second.hiddenToOutput,
      random,
    ),
    outputBias: crossoverArray(first.outputBias, second.outputBias, random),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mutateValue(
  value: number,
  random: SeededRandom,
  config: Readonly<EvolutionConfig>,
) {
  if (random.next() >= config.mutationProbability) return value;
  return clamp(
    value + gaussianRandom(random) * config.mutationStandardDeviation,
    config.minimumWeight,
    config.maximumWeight,
  );
}

export function mutateGenomeInPlace(
  genome: NetworkGenome,
  random: SeededRandom,
  config: Readonly<EvolutionConfig>,
  level: CurriculumLevel,
) {
  assertGenomeShape(genome);
  validateEvolutionConfig(config);

  for (let hiddenIndex = 0; hiddenIndex < genome.hiddenCount; hiddenIndex += 1) {
    for (let inputIndex = 0; inputIndex < genome.inputCount; inputIndex += 1) {
      if (!isInputUnlocked(inputIndex, level)) continue;
      const weightIndex = hiddenIndex * genome.inputCount + inputIndex;
      genome.inputToHidden[weightIndex] = mutateValue(
        genome.inputToHidden[weightIndex],
        random,
        config,
      );
    }
  }

  const remainingArrays = [
    genome.hiddenBias,
    genome.hiddenToOutput,
    genome.outputBias,
  ];
  for (const values of remainingArrays) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = mutateValue(values[index], random, config);
    }
  }
  return genome;
}

export function tournamentSelect(
  evaluations: readonly GenomeEvaluation[],
  random: SeededRandom,
  tournamentSize: number,
) {
  if (evaluations.length === 0) {
    throw new RangeError("Tournament requires at least one evaluation.");
  }
  if (!Number.isSafeInteger(tournamentSize) || tournamentSize <= 0) {
    throw new RangeError("tournamentSize must be a positive safe integer.");
  }

  let winner: GenomeEvaluation | undefined;
  for (let draw = 0; draw < tournamentSize; draw += 1) {
    const candidate = evaluations[random.nextInt(0, evaluations.length)];
    if (!winner || compareGenomeEvaluations(candidate, winner) < 0) {
      winner = candidate;
    }
  }
  return winner as GenomeEvaluation;
}

export interface ReproducePopulationOptions {
  population: readonly Readonly<NetworkGenome>[];
  evaluations: readonly GenomeEvaluation[];
  random: SeededRandom;
  config: Readonly<EvolutionConfig>;
  level: CurriculumLevel;
  nextGeneration: number;
}

export function reproducePopulation({
  population,
  evaluations,
  random,
  config,
  level,
  nextGeneration,
}: ReproducePopulationOptions) {
  validateEvolutionConfig(config);
  if (population.length !== config.populationSize) {
    throw new RangeError("Population size does not match the evolution config.");
  }
  if (evaluations.length !== population.length) {
    throw new RangeError("Every genome requires one evaluation.");
  }

  const genomeById = new Map(population.map((genome) => [genome.id, genome]));
  if (genomeById.size !== population.length) {
    throw new Error("Genome IDs must be unique.");
  }
  const evaluatedGenomeIds = new Set<string>();
  for (const evaluation of evaluations) {
    if (!genomeById.has(evaluation.genomeId)) {
      throw new Error(`Missing genome ${evaluation.genomeId}.`);
    }
    if (evaluatedGenomeIds.has(evaluation.genomeId)) {
      throw new Error(`Duplicate evaluation for genome ${evaluation.genomeId}.`);
    }
    const genomeAtIndex = population[evaluation.populationIndex];
    if (genomeAtIndex?.id !== evaluation.genomeId) {
      throw new Error(
        `Evaluation index does not match genome ${evaluation.genomeId}.`,
      );
    }
    evaluatedGenomeIds.add(evaluation.genomeId);
  }
  const ranked = rankGenomeEvaluations(evaluations);
  const nextPopulation: NetworkGenome[] = [];

  for (let eliteIndex = 0; eliteIndex < config.eliteCount; eliteIndex += 1) {
    const source = genomeById.get(ranked[eliteIndex].genomeId);
    if (!source) throw new Error(`Missing genome ${ranked[eliteIndex].genomeId}.`);
    nextPopulation.push(cloneGenome(source));
  }

  while (nextPopulation.length < config.populationSize) {
    const childIndex = nextPopulation.length;
    const childId = `g${nextGeneration}-i${childIndex}`;
    const firstEvaluation = tournamentSelect(
      evaluations,
      random,
      config.tournamentSize,
    );
    const firstParent = genomeById.get(firstEvaluation.genomeId);
    if (!firstParent) throw new Error(`Missing genome ${firstEvaluation.genomeId}.`);

    let child: NetworkGenome;
    if (random.next() < config.crossoverProbability) {
      const secondEvaluation = tournamentSelect(
        evaluations,
        random,
        config.tournamentSize,
      );
      const secondParent = genomeById.get(secondEvaluation.genomeId);
      if (!secondParent) {
        throw new Error(`Missing genome ${secondEvaluation.genomeId}.`);
      }
      child = uniformCrossover(firstParent, secondParent, childId, random);
    } else {
      child = cloneGenome(firstParent, childId);
    }
    mutateGenomeInPlace(child, random, config, level);
    nextPopulation.push(child);
  }

  return { population: nextPopulation, ranked };
}
