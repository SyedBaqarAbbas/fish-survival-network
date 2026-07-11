import { describe, expect, it } from "vitest";

import { WORLD_CONFIG } from "@/simulation/config";
import { SeededRandom } from "@/simulation/random";

import { DEFAULT_EVOLUTION_CONFIG } from "./config";
import { evaluatePopulation } from "./evaluation";
import { createRandomGenome } from "./genome";

const SHORT_WORLD = Object.freeze({ ...WORLD_CONFIG, episodeSeconds: 0.5 });

describe("population evaluation", () => {
  it("uses the same derived episode seeds for every genome", () => {
    const population = [
      createRandomGenome("a", new SeededRandom(8)),
      createRandomGenome("b", new SeededRandom(9)),
    ];
    const result = evaluatePopulation(population, {
      runSeed: 17,
      generation: 3,
      level: 0,
      episodesPerGenome: DEFAULT_EVOLUTION_CONFIG.episodesPerGenome,
      world: SHORT_WORLD,
    });

    expect(result.episodeSeeds).toHaveLength(8);
    result.genomes.forEach((evaluation) => {
      expect(evaluation.episodes.map((episode) => episode.seed)).toEqual(
        result.episodeSeeds,
      );
    });
  });

  it("is deterministic per genome regardless of population evaluation order", () => {
    const population = [
      createRandomGenome("a", new SeededRandom(3)),
      createRandomGenome("b", new SeededRandom(4)),
      createRandomGenome("c", new SeededRandom(5)),
    ];
    const options = {
      runSeed: 92,
      generation: 1,
      level: 0 as const,
      episodesPerGenome: 2,
      world: SHORT_WORLD,
    };
    const forward = evaluatePopulation(population, options);
    const reverse = evaluatePopulation([...population].reverse(), options);
    const byId = (result: typeof forward) =>
      Object.fromEntries(
        result.genomes.map((evaluation) => [
          evaluation.genomeId,
          {
            genomeId: evaluation.genomeId,
            fitness: evaluation.fitness,
            survivalRate: evaluation.survivalRate,
            meanAliveSeconds: evaluation.meanAliveSeconds,
            episodes: evaluation.episodes,
          },
        ]),
      );

    expect(byId(reverse)).toEqual(byId(forward));
    expect(evaluatePopulation(population, options)).toEqual(forward);
  });

  it("uses different fair seeds for the next generation", () => {
    const population = [createRandomGenome("a", new SeededRandom(2))];
    const base = {
      runSeed: 4,
      level: 0 as const,
      episodesPerGenome: 2,
      world: SHORT_WORLD,
    };
    const first = evaluatePopulation(population, { ...base, generation: 0 });
    const second = evaluatePopulation(population, { ...base, generation: 1 });
    expect(second.episodeSeeds).not.toEqual(first.episodeSeeds);
    expect(second.genomes[0].episodes.every((episode) => Number.isFinite(episode.fitness))).toBe(
      true,
    );
  });
});
