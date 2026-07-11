import { DEFAULT_EVOLUTION_CONFIG } from "../config";
import type {
  EvolutionConfig,
  GenomeEvaluation,
  NetworkGenome,
} from "../types";

export function makeGenome(id: string, value = 0): NetworkGenome {
  return {
    id,
    inputCount: 11,
    hiddenCount: 8,
    outputCount: 2,
    inputToHidden: new Float32Array(88).fill(value),
    hiddenBias: new Float32Array(8).fill(value),
    hiddenToOutput: new Float32Array(16).fill(value),
    outputBias: new Float32Array(2).fill(value),
  };
}

export function makeEvaluation(
  genomeId: string,
  populationIndex: number,
  fitness: number,
  survivalRate = 0,
): GenomeEvaluation {
  const stats = {
    aliveSeconds: survivalRate * 15,
    survived: survivalRate === 1,
    meanPredatorDistance: 0.5,
    wallCollisions: 0,
    meanAccelerationSquared: 0.25,
  };
  return {
    genomeId,
    populationIndex,
    fitness,
    survivalRate,
    meanAliveSeconds: stats.aliveSeconds,
    episodes: [{ seed: 1, fitness, stats }],
  };
}

export function makeEvolutionConfig(
  overrides: Partial<EvolutionConfig> = {},
): EvolutionConfig {
  return {
    ...DEFAULT_EVOLUTION_CONFIG,
    populationSize: 4,
    eliteCount: 1,
    tournamentSize: 2,
    episodesPerGenome: 2,
    ...overrides,
  };
}
