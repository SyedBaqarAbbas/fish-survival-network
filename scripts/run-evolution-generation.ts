import { UINT32_MAX } from "../src/simulation";
import {
  createEvolutionRun,
  DEFAULT_EVOLUTION_CONFIG,
  evolveGeneration,
} from "../src/evolution";

const runSeed = Number(process.argv[2] ?? 42);
if (!Number.isSafeInteger(runSeed) || runSeed < 0 || runSeed > UINT32_MAX) {
  throw new RangeError(`Seed must be an integer from 0 to ${UINT32_MAX}.`);
}

const startedAt = performance.now();
const initialState = createEvolutionRun({ runSeed });
const result = evolveGeneration(initialState);
const elapsedMilliseconds = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      runSeed,
      populationSize: DEFAULT_EVOLUTION_CONFIG.populationSize,
      episodesPerGenome: DEFAULT_EVOLUTION_CONFIG.episodesPerGenome,
      evaluatedEpisodes:
        DEFAULT_EVOLUTION_CONFIG.populationSize *
        DEFAULT_EVOLUTION_CONFIG.episodesPerGenome,
      generation: result.evaluation.generation,
      nextGeneration: result.state.generation,
      level: result.state.curriculum.level,
      bestFitness: result.ranked[0].fitness,
      meanFitness:
        result.evaluation.genomes.reduce(
          (sum, evaluation) => sum + evaluation.fitness,
          0,
        ) / result.evaluation.genomes.length,
      medianSurvivalRate: result.medianSurvivalRate,
      curriculumAdvanced: result.curriculumAdvanced,
      randomState: result.state.randomState,
      runtimeMilliseconds: Number(elapsedMilliseconds.toFixed(1)),
    },
    null,
    2,
  ),
);
