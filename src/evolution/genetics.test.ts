import { afterEach, describe, expect, it, vi } from "vitest";

import { SeededRandom } from "@/simulation/random";

import { DEFAULT_EVOLUTION_CONFIG } from "./config";
import {
  compareGenomeEvaluations,
  mutateGenomeInPlace,
  rankGenomeEvaluations,
  reproducePopulation,
  tournamentSelect,
  uniformCrossover,
} from "./genetics";
import { cloneGenome, genomeParametersEqual } from "./genome";
import { makeEvaluation, makeEvolutionConfig, makeGenome } from "./__tests__/fixtures";

describe("genetic operations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ranks finite fitness first, descending, with source-index ties", () => {
    const evaluations = [
      makeEvaluation("nan", 0, Number.NaN),
      makeEvaluation("low", 1, 2),
      makeEvaluation("tie-later", 3, 8),
      makeEvaluation("positive-infinity", 4, Number.POSITIVE_INFINITY),
      makeEvaluation("tie-first", 2, 8),
      makeEvaluation("negative-infinity", 5, Number.NEGATIVE_INFINITY),
    ];
    expect(rankGenomeEvaluations(evaluations).map((item) => item.genomeId)).toEqual([
      "tie-first",
      "tie-later",
      "low",
      "nan",
      "positive-infinity",
      "negative-infinity",
    ]);
    expect(compareGenomeEvaluations(evaluations[2], evaluations[4])).toBeGreaterThan(0);
  });

  it("creates a deterministic uniform child from parent genes", () => {
    const first = makeGenome("first", 1);
    const second = makeGenome("second", -1);
    const child = uniformCrossover(first, second, "child", new SeededRandom(5));
    const repeat = uniformCrossover(first, second, "child", new SeededRandom(5));
    expect(child).toEqual(repeat);
    for (const values of [
      child.inputToHidden,
      child.hiddenBias,
      child.hiddenToOutput,
      child.outputBias,
    ]) {
      expect(Array.from(values).every((value) => value === 1 || value === -1)).toBe(
        true,
      );
    }
  });

  it("mutates active inputs and downstream parameters but not locked columns", () => {
    const genome = makeGenome("fish", 0.5);
    const before = cloneGenome(genome);
    const config = makeEvolutionConfig({
      mutationProbability: 1,
      mutationStandardDeviation: 100,
    });
    mutateGenomeInPlace(genome, new SeededRandom(14), config, 0);

    for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
      const offset = hidden * genome.inputCount;
      expect(genome.inputToHidden[offset]).not.toBe(before.inputToHidden[offset]);
      for (let input = 1; input < genome.inputCount; input += 1) {
        expect(genome.inputToHidden[offset + input]).toBe(
          before.inputToHidden[offset + input],
        );
      }
    }
    for (const values of [
      genome.inputToHidden,
      genome.hiddenBias,
      genome.hiddenToOutput,
      genome.outputBias,
    ]) {
      values.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(-5);
        expect(value).toBeLessThanOrEqual(5);
      });
    }
  });

  it("copies elites byte-for-byte as deep clones and reproduces deterministically", () => {
    const population = [
      makeGenome("a", 1),
      makeGenome("b", 2),
      makeGenome("c", 3),
      makeGenome("d", 4),
    ];
    const evaluations = [
      makeEvaluation("a", 0, 1),
      makeEvaluation("b", 1, 10),
      makeEvaluation("c", 2, 4),
      makeEvaluation("d", 3, 3),
    ];
    const config = makeEvolutionConfig();
    const first = reproducePopulation({
      population,
      evaluations,
      random: new SeededRandom(44),
      config,
      level: 0,
      nextGeneration: 1,
    });
    const second = reproducePopulation({
      population,
      evaluations,
      random: new SeededRandom(44),
      config,
      level: 0,
      nextGeneration: 1,
    });

    expect(first.population).toEqual(second.population);
    expect(first.population[0].id).toBe("b");
    expect(genomeParametersEqual(first.population[0], population[1])).toBe(true);
    expect(
      Array.from(new Uint8Array(first.population[0].inputToHidden.buffer)),
    ).toEqual(Array.from(new Uint8Array(population[1].inputToHidden.buffer)));
    expect(first.population[0].inputToHidden).not.toBe(population[1].inputToHidden);
    population[1].inputToHidden[0] = -99;
    expect(first.population[0].inputToHidden[0]).toBe(2);
  });

  it("requires exactly one correctly indexed evaluation per genome", () => {
    const population = [
      makeGenome("a", 1),
      makeGenome("b", 2),
      makeGenome("c", 3),
      makeGenome("d", 4),
    ];
    const reproduce = (evaluations: ReturnType<typeof makeEvaluation>[]) =>
      reproducePopulation({
        population,
        evaluations,
        random: new SeededRandom(44),
        config: makeEvolutionConfig(),
        level: 0,
        nextGeneration: 1,
      });

    expect(() =>
      reproduce([
        makeEvaluation("a", 0, 4),
        makeEvaluation("a", 0, 3),
        makeEvaluation("c", 2, 2),
        makeEvaluation("d", 3, 1),
      ]),
    ).toThrow("Duplicate evaluation for genome a.");
    expect(() =>
      reproduce([
        makeEvaluation("a", 0, 4),
        makeEvaluation("missing", 1, 3),
        makeEvaluation("c", 2, 2),
        makeEvaluation("d", 3, 1),
      ]),
    ).toThrow("Missing genome missing.");
    expect(() =>
      reproduce([
        makeEvaluation("a", 1, 4),
        makeEvaluation("b", 0, 3),
        makeEvaluation("c", 2, 2),
        makeEvaluation("d", 3, 1),
      ]),
    ).toThrow("Evaluation index does not match genome a.");
  });

  it("uses seeded tournament draws without ambient randomness", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("ambient randomness used");
    });
    const evaluations = [
      makeEvaluation("a", 0, 1),
      makeEvaluation("b", 1, 2),
      makeEvaluation("c", 2, 3),
    ];
    expect(() => tournamentSelect(evaluations, new SeededRandom(1), 5)).not.toThrow();
    expect(() =>
      mutateGenomeInPlace(
        makeGenome("m"),
        new SeededRandom(2),
        DEFAULT_EVOLUTION_CONFIG,
        6,
      ),
    ).not.toThrow();
  });
});
