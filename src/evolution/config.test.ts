import { describe, expect, it } from "vitest";

import { DEFAULT_EVOLUTION_CONFIG, validateEvolutionConfig } from "./config";

describe("evolution configuration", () => {
  it("matches the fixed v1 genetic algorithm defaults", () => {
    expect(DEFAULT_EVOLUTION_CONFIG).toMatchObject({
      populationSize: 256,
      eliteCount: 13,
      tournamentSize: 5,
      crossoverProbability: 0.65,
      mutationProbability: 0.12,
      mutationStandardDeviation: 0.18,
      episodesPerGenome: 8,
      minimumWeight: -5,
      maximumWeight: 5,
    });
  });

  it("rejects invalid counts, probabilities, and bounds", () => {
    expect(() =>
      validateEvolutionConfig({ ...DEFAULT_EVOLUTION_CONFIG, populationSize: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      validateEvolutionConfig({ ...DEFAULT_EVOLUTION_CONFIG, eliteCount: 257 }),
    ).toThrow(RangeError);
    expect(() =>
      validateEvolutionConfig({
        ...DEFAULT_EVOLUTION_CONFIG,
        mutationProbability: 1.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateEvolutionConfig({
        ...DEFAULT_EVOLUTION_CONFIG,
        minimumWeight: 5,
        maximumWeight: 5,
      }),
    ).toThrow(RangeError);
  });
});
