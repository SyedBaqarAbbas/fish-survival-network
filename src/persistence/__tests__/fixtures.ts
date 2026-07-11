import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution/config";
import { createEvolutionRun, evolveGeneration } from "@/evolution/population";
import type { EvolutionConfig } from "@/evolution/types";
import { WORLD_CONFIG } from "@/simulation/config";

import { createRunCheckpoint } from "../checkpoint";
import type { GenerationMetric } from "../types";

export const TEST_EVOLUTION_CONFIG: EvolutionConfig = {
  ...DEFAULT_EVOLUTION_CONFIG,
  populationSize: 3,
  eliteCount: 1,
  tournamentSize: 2,
  episodesPerGenome: 1,
};

export const SHORT_TEST_WORLD = Object.freeze({
  ...WORLD_CONFIG,
  episodeSeconds: 0.1,
});

function makeGenerationOne() {
  const initial = createEvolutionRun({
    runSeed: 321,
    config: TEST_EVOLUTION_CONFIG,
  });
  const result = evolveGeneration(initial, { world: SHORT_TEST_WORLD });
  const best = result.ranked[0];
  const metric: GenerationMetric = {
    generation: result.evaluation.generation,
    level: result.evaluation.level,
    bestFitness: best.fitness,
    meanFitness:
      result.evaluation.genomes.reduce(
        (total, evaluation) => total + evaluation.fitness,
        0,
      ) / result.evaluation.genomes.length,
    championSurvivalRate: best.survivalRate,
    medianSurvivalRate: result.medianSurvivalRate,
    durationMilliseconds: 12.5,
    curriculumAdvanced: result.curriculumAdvanced,
  };
  return { state: result.state, metric };
}

export function makeCheckpoint(generation = 0) {
  if (generation === 1) {
    const evolved = makeGenerationOne();
    return createRunCheckpoint({
      runId: "test-run",
      savedAt: "2026-07-12T00:00:00.000Z",
      world: SHORT_TEST_WORLD,
      state: evolved.state,
      metricHistory: [evolved.metric],
    });
  }
  const state = createEvolutionRun({
    runSeed: 321,
    config: TEST_EVOLUTION_CONFIG,
  });
  return createRunCheckpoint({
    runId: "test-run",
    savedAt: "2026-07-12T00:00:00.000Z",
    world: SHORT_TEST_WORLD,
    state,
    metricHistory: [],
  });
}
