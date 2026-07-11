import type {
  EpisodeEvaluation,
  FishEpisodeFitnessStats,
  GenomeEvaluation,
} from "./types";
import { FISH_FITNESS_WEIGHTS } from "./config";

export function calculateFishFitness(stats: Readonly<FishEpisodeFitnessStats>) {
  return (
    FISH_FITNESS_WEIGHTS.aliveSeconds * stats.aliveSeconds +
    (stats.survived ? FISH_FITNESS_WEIGHTS.survivedEpisode : 0) +
    FISH_FITNESS_WEIGHTS.meanPredatorDistance * stats.meanPredatorDistance +
    FISH_FITNESS_WEIGHTS.wallCollision * stats.wallCollisions +
    FISH_FITNESS_WEIGHTS.meanAccelerationSquared * stats.meanAccelerationSquared
  );
}

function mean(values: readonly number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateEpisodeEvaluations(
  genomeId: string,
  populationIndex: number,
  episodes: EpisodeEvaluation[],
): GenomeEvaluation {
  if (episodes.length === 0) {
    throw new RangeError("At least one episode is required to evaluate a genome.");
  }

  return {
    genomeId,
    populationIndex,
    fitness: mean(episodes.map((episode) => episode.fitness)),
    survivalRate:
      episodes.filter((episode) => episode.stats.survived).length / episodes.length,
    meanAliveSeconds: mean(episodes.map((episode) => episode.stats.aliveSeconds)),
    episodes,
  };
}

export function medianSurvivalRate(evaluations: readonly GenomeEvaluation[]) {
  if (evaluations.length === 0) {
    throw new RangeError("At least one genome evaluation is required.");
  }

  const values = evaluations
    .map((evaluation) =>
      Number.isFinite(evaluation.survivalRate) ? evaluation.survivalRate : 0,
    )
    .sort((first, second) => first - second);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}
