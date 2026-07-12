import type { CurriculumLevel, WorldConfig } from "@/simulation/types";

export interface NetworkTopology {
  inputCount: number;
  hiddenCount: number;
  outputCount: number;
}

export interface NetworkGenome extends NetworkTopology {
  id: string;
  inputToHidden: Float32Array;
  hiddenBias: Float32Array;
  hiddenToOutput: Float32Array;
  outputBias: Float32Array;
}

export const FISH_NETWORK_TOPOLOGY = {
  inputCount: 11,
  hiddenCount: 8,
  outputCount: 2,
} as const satisfies NetworkTopology;

export interface EvolutionConfig {
  populationSize: number;
  eliteCount: number;
  tournamentSize: number;
  crossoverProbability: number;
  mutationProbability: number;
  mutationStandardDeviation: number;
  episodesPerGenome: number;
  minimumWeight: number;
  maximumWeight: number;
  automaticCurriculum?: boolean;
}

export interface FishEpisodeFitnessStats {
  aliveSeconds: number;
  survived: boolean;
  meanPredatorDistance: number;
  wallCollisions: number;
  meanAccelerationSquared: number;
}

export interface EpisodeEvaluation {
  seed: number;
  fitness: number;
  stats: FishEpisodeFitnessStats;
}

export interface GenomeEvaluation {
  genomeId: string;
  populationIndex: number;
  fitness: number;
  survivalRate: number;
  meanAliveSeconds: number;
  episodes: EpisodeEvaluation[];
}

export interface PopulationEvaluation {
  generation: number;
  level: CurriculumLevel;
  episodeSeeds: number[];
  genomes: GenomeEvaluation[];
}

export interface CurriculumChampion {
  level: CurriculumLevel;
  generation: number;
  genome: NetworkGenome;
  evaluation: GenomeEvaluation;
}

export interface CurriculumState {
  level: CurriculumLevel;
  stableGenerations: number;
  champions: Partial<Record<CurriculumLevel, CurriculumChampion>>;
}

export interface EvolutionRunState {
  runSeed: number;
  generation: number;
  randomState: number;
  population: NetworkGenome[];
  curriculum: CurriculumState;
  config: Readonly<EvolutionConfig>;
}

export interface CreateEvolutionRunOptions {
  runSeed: number;
  config?: Readonly<EvolutionConfig>;
}

export interface EvolveGenerationOptions {
  world?: Readonly<WorldConfig>;
}

export interface GenerationResult {
  state: EvolutionRunState;
  evaluation: PopulationEvaluation;
  ranked: GenomeEvaluation[];
  medianSurvivalRate: number;
  champion: NetworkGenome;
  curriculumAdvanced: boolean;
}
