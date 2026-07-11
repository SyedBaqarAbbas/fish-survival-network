import type { EvolutionConfig } from "./types";

export const DEFAULT_EVOLUTION_CONFIG = Object.freeze({
  populationSize: 256,
  eliteCount: 13,
  tournamentSize: 5,
  crossoverProbability: 0.65,
  mutationProbability: 0.12,
  mutationStandardDeviation: 0.18,
  episodesPerGenome: 8,
  minimumWeight: -5,
  maximumWeight: 5,
}) satisfies Readonly<EvolutionConfig>;

export const CURRICULUM_SURVIVAL_THRESHOLD = 0.75;
export const CURRICULUM_STABLE_GENERATIONS = 5;
export const UNLOCKED_WEIGHT_STANDARD_DEVIATION = 0.02;
export const FISH_FITNESS_WEIGHTS = Object.freeze({
  aliveSeconds: 1,
  survivedEpisode: 5,
  meanPredatorDistance: 0.15,
  wallCollision: -0.4,
  meanAccelerationSquared: -0.01,
});

function assertProbability(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between zero and one.`);
  }
}

export function validateEvolutionConfig(config: Readonly<EvolutionConfig>) {
  const integerFields = [
    [config.populationSize, "populationSize"],
    [config.eliteCount, "eliteCount"],
    [config.tournamentSize, "tournamentSize"],
    [config.episodesPerGenome, "episodesPerGenome"],
  ] as const;

  for (const [value, name] of integerFields) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (config.eliteCount > config.populationSize) {
    throw new RangeError("eliteCount cannot exceed populationSize.");
  }
  if (config.tournamentSize > config.populationSize) {
    throw new RangeError("tournamentSize cannot exceed populationSize.");
  }

  assertProbability(config.crossoverProbability, "crossoverProbability");
  assertProbability(config.mutationProbability, "mutationProbability");
  if (
    !Number.isFinite(config.mutationStandardDeviation) ||
    config.mutationStandardDeviation < 0
  ) {
    throw new RangeError("mutationStandardDeviation must be finite and non-negative.");
  }
  if (
    !Number.isFinite(config.minimumWeight) ||
    !Number.isFinite(config.maximumWeight) ||
    config.maximumWeight <= config.minimumWeight
  ) {
    throw new RangeError("maximumWeight must be greater than minimumWeight.");
  }

  return config;
}
