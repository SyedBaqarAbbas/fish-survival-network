import {
  cloneGenome,
  completeEvaluatedGeneration,
  createEvolutionRun,
  evaluatePopulation,
  setCurriculumLevel,
  type CurriculumChampion,
  type EvolutionRunState,
  type GenomeEvaluation,
  type PopulationEvaluation,
} from "@/evolution";
import {
  createRunCheckpoint,
  type GenerationMetric,
  type RunCheckpoint,
} from "@/persistence";
import { REPLAY_FISH_COUNT, type ReplaySource } from "@/replay";
import { WORLD_CONFIG } from "@/simulation/config";
import type { CurriculumLevel } from "@/simulation/types";

import {
  STARTER_EVOLUTION_CONFIG,
  STARTER_LEVEL_PLAN,
  STARTER_REPLAY_SOURCE_ID,
  STARTER_RUN_ID,
  STARTER_RUN_SEED,
  STARTER_SAVED_AT,
} from "./config";

export interface StarterTrainingProgress {
  generation: number;
  level: CurriculumLevel;
  completedGenerations: number;
  totalGenerations: number;
  championGenomeId: string;
  championSurvivalRate: number;
}

export interface TrainStarterCheckpointOptions {
  onProgress?: (progress: Readonly<StarterTrainingProgress>) => void;
}

function cloneEvaluation(
  evaluation: Readonly<GenomeEvaluation>,
): GenomeEvaluation {
  return {
    ...evaluation,
    episodes: evaluation.episodes.map((episode) => ({
      ...episode,
      stats: { ...episode.stats },
    })),
  };
}

function finiteMean(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? 0
    : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function createChampion(
  level: CurriculumLevel,
  generation: number,
  state: Readonly<EvolutionRunState>,
  evaluation: Readonly<GenomeEvaluation>,
): CurriculumChampion {
  const genome = state.population[evaluation.populationIndex];
  if (!genome || genome.id !== evaluation.genomeId) {
    throw new Error(`Missing starter champion ${evaluation.genomeId}.`);
  }
  return {
    level,
    generation,
    genome: cloneGenome(genome),
    evaluation: cloneEvaluation(evaluation),
  };
}

function createMetric(
  evaluation: Readonly<PopulationEvaluation>,
  ranked: readonly Readonly<GenomeEvaluation>[],
  medianSurvivalRate: number,
  curriculumAdvanced: boolean,
): GenerationMetric {
  const champion = ranked[0];
  if (!champion) throw new Error("Starter evaluation has no champion.");
  return {
    generation: evaluation.generation,
    level: evaluation.level,
    bestFitness: champion.fitness,
    meanFitness: finiteMean(evaluation.genomes.map((item) => item.fitness)),
    championSurvivalRate: champion.survivalRate,
    medianSurvivalRate,
    durationMilliseconds: 0,
    curriculumAdvanced,
  };
}

function createReplaySource(
  state: Readonly<EvolutionRunState>,
  evaluation: Readonly<PopulationEvaluation>,
  ranked: readonly Readonly<GenomeEvaluation>[],
): ReplaySource {
  if (ranked.length < REPLAY_FISH_COUNT) {
    throw new Error(
      `Starter replay requires at least ${REPLAY_FISH_COUNT} ranked genomes.`,
    );
  }
  const entries = ranked.slice(0, REPLAY_FISH_COUNT).map((item) => {
    const genome = state.population[item.populationIndex];
    if (!genome || genome.id !== item.genomeId) {
      throw new Error(`Missing ranked starter genome ${item.genomeId}.`);
    }
    return {
      genome: cloneGenome(genome),
      fitness: item.fitness,
      survivalRate: item.survivalRate,
    };
  });
  return {
    sourceId: STARTER_REPLAY_SOURCE_ID,
    runId: STARTER_RUN_ID,
    generation: evaluation.generation,
    level: evaluation.level,
    world: { ...WORLD_CONFIG },
    championGenomeId: ranked[0].genomeId,
    entries,
  };
}

/**
 * Runs the pinned curriculum recipe. This is intentionally invoked only by the
 * artifact-generation CLI; normal tests and application startup load the
 * committed checkpoint instead of repeating the training run.
 */
export function trainStarterCheckpoint({
  onProgress,
}: TrainStarterCheckpointOptions = {}): RunCheckpoint {
  let state = createEvolutionRun({
    runSeed: STARTER_RUN_SEED,
    config: STARTER_EVOLUTION_CONFIG,
  });
  const metricHistory: GenerationMetric[] = [];
  let replaySource: ReplaySource | undefined;
  const totalGenerations = STARTER_LEVEL_PLAN.reduce(
    (total, stage) => total + stage.generations,
    0,
  );

  for (const stage of STARTER_LEVEL_PLAN) {
    if (state.curriculum.level !== stage.level) {
      state = setCurriculumLevel(state, stage.level);
    }

    for (let stageGeneration = 0; stageGeneration < stage.generations; stageGeneration += 1) {
      const evaluatedState = state;
      const evaluation = evaluatePopulation(evaluatedState.population, {
        runSeed: evaluatedState.runSeed,
        generation: evaluatedState.generation,
        level: stage.level,
        episodesPerGenome: evaluatedState.config.episodesPerGenome,
        world: WORLD_CONFIG,
      });
      const result = completeEvaluatedGeneration(evaluatedState, evaluation);
      const isStageEnd = stageGeneration === stage.generations - 1;
      const curriculumAdvanced = isStageEnd && stage.level < 6;
      metricHistory.push(
        createMetric(
          evaluation,
          result.ranked,
          result.medianSurvivalRate,
          curriculumAdvanced,
        ),
      );

      state = result.state;
      if (isStageEnd) {
        const champion = createChampion(
          stage.level,
          evaluation.generation,
          evaluatedState,
          result.ranked[0],
        );
        state = {
          ...state,
          curriculum: {
            ...state.curriculum,
            stableGenerations: 0,
            champions: {
              ...state.curriculum.champions,
              [stage.level]: champion,
            },
          },
        };
      }
      if (stage.level === 6 && isStageEnd) {
        replaySource = createReplaySource(
          evaluatedState,
          evaluation,
          result.ranked,
        );
      }

      onProgress?.({
        generation: evaluation.generation,
        level: stage.level,
        completedGenerations: metricHistory.length,
        totalGenerations,
        championGenomeId: result.ranked[0].genomeId,
        championSurvivalRate: result.ranked[0].survivalRate,
      });
    }
  }

  if (!replaySource) {
    throw new Error("Starter training did not produce a replay roster.");
  }
  return createRunCheckpoint({
    runId: STARTER_RUN_ID,
    savedAt: STARTER_SAVED_AT,
    world: WORLD_CONFIG,
    state,
    metricHistory,
    replaySource,
  });
}
