import { describe, expect, it } from "vitest";

import { SeededRandom } from "@/simulation/random";

import { createCurriculumState, updateCurriculum } from "./curriculum";
import { genomeParametersEqual } from "./genome";
import { getInputsUnlockedAtLevel, getUnlockedInputIndices } from "./inputs";
import type { CurriculumState, NetworkGenome } from "./types";
import { makeEvaluation, makeEvolutionConfig, makeGenome } from "./__tests__/fixtures";

function transitionFixture(seed = 50) {
  const config = makeEvolutionConfig();
  const population = Array.from({ length: config.populationSize }, (_, index) => {
    const genome = makeGenome(`g-${index}`);
    for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
      genome.inputToHidden[hidden * genome.inputCount] = index + 1;
    }
    genome.hiddenBias.fill(index + 2);
    genome.hiddenToOutput.fill(index + 3);
    genome.outputBias.fill(index + 4);
    return genome;
  });
  const champion = population[0];
  const championEvaluation = makeEvaluation(champion.id, 0, 20, 1);
  let state: CurriculumState = createCurriculumState();
  let currentPopulation: readonly Readonly<NetworkGenome>[] = population;
  const random = new SeededRandom(seed);
  let result: ReturnType<typeof updateCurriculum> | undefined;

  for (let generation = 0; generation < 5; generation += 1) {
    result = updateCurriculum({
      state,
      medianSurvivalRate: 0.75,
      generation,
      champion,
      championEvaluation,
      population: currentPopulation,
      random,
      config,
    });
    state = result.state;
    currentPopulation = result.population;
  }
  return { config, population, champion, championEvaluation, result: result! };
}

describe("sensor curriculum", () => {
  it("defines the exact sensor groups unlocked at each level", () => {
    expect(getInputsUnlockedAtLevel(0)).toEqual([0]);
    expect(getInputsUnlockedAtLevel(1)).toEqual([1]);
    expect(getInputsUnlockedAtLevel(2)).toEqual([2, 3]);
    expect(getInputsUnlockedAtLevel(3)).toEqual([4]);
    expect(getInputsUnlockedAtLevel(4)).toEqual([5, 6]);
    expect(getInputsUnlockedAtLevel(5)).toEqual([7, 8]);
    expect(getInputsUnlockedAtLevel(6)).toEqual([9, 10]);
    expect(getUnlockedInputIndices(6)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("requires five consecutive generations and resets on a miss", () => {
    const config = makeEvolutionConfig();
    const population = Array.from({ length: 4 }, (_, index) =>
      makeGenome(`g-${index}`),
    );
    const champion = population[0];
    const evaluation = makeEvaluation(champion.id, 0, 1, 1);
    const random = new SeededRandom(4);
    let state: CurriculumState = createCurriculumState();

    for (let generation = 0; generation < 4; generation += 1) {
      const result = updateCurriculum({
        state,
        medianSurvivalRate: 0.75,
        generation,
        champion,
        championEvaluation: evaluation,
        population,
        random,
        config,
      });
      state = result.state;
      expect(result.advanced).toBe(false);
    }
    expect(state.stableGenerations).toBe(4);
    state = updateCurriculum({
      state,
      medianSurvivalRate: 0.749,
      generation: 4,
      champion,
      championEvaluation: evaluation,
      population,
      random,
      config,
    }).state;
    expect(state).toEqual({ level: 0, stableGenerations: 0, champions: {} });
  });

  it("archives before transition and changes only the newly unlocked column", () => {
    const { population, champion, result } = transitionFixture();
    expect(result.advanced).toBe(true);
    expect(result.archived).toBe(true);
    expect(result.state.level).toBe(1);
    expect(result.state.stableGenerations).toBe(0);
    expect(result.state.champions[0]?.generation).toBe(4);
    expect(
      genomeParametersEqual(result.state.champions[0]!.genome, champion),
    ).toBe(true);

    result.population.forEach((genome, populationIndex) => {
      const source = population[populationIndex];
      const newWeights: number[] = [];
      for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
        const offset = hidden * genome.inputCount;
        expect(genome.inputToHidden[offset]).toBe(source.inputToHidden[offset]);
        newWeights.push(genome.inputToHidden[offset + 1]);
        expect(
          Array.from(genome.inputToHidden.slice(offset + 2, offset + 11)),
        ).toEqual(Array.from(source.inputToHidden.slice(offset + 2, offset + 11)));
      }
      expect(newWeights.some((weight) => weight !== 0)).toBe(true);
      expect(genome.hiddenBias).toEqual(source.hiddenBias);
      expect(genome.hiddenToOutput).toEqual(source.hiddenToOutput);
      expect(genome.outputBias).toEqual(source.outputBias);
    });
  });

  it("is deterministic and archives level 6 without advancing to 7", () => {
    expect(transitionFixture(88).result).toEqual(transitionFixture(88).result);

    const config = makeEvolutionConfig();
    const population = Array.from({ length: 4 }, (_, index) =>
      makeGenome(`g-${index}`),
    );
    const champion = population[0];
    const evaluation = makeEvaluation(champion.id, 0, 1, 1);
    const random = new SeededRandom(8);
    let state: CurriculumState = createCurriculumState(6);
    let last: ReturnType<typeof updateCurriculum> | undefined;
    for (let generation = 0; generation < 5; generation += 1) {
      last = updateCurriculum({
        state,
        medianSurvivalRate: 1,
        generation,
        champion,
        championEvaluation: evaluation,
        population,
        random,
        config,
      });
      state = last.state;
    }
    expect(last?.advanced).toBe(false);
    expect(last?.archived).toBe(true);
    expect(state.level).toBe(6);
    expect(state.champions[6]?.generation).toBe(4);

    const repeat = updateCurriculum({
      state,
      medianSurvivalRate: 1,
      generation: 5,
      champion: makeGenome("replacement", 5),
      championEvaluation: makeEvaluation("replacement", 0, 50, 1),
      population,
      random,
      config,
    });
    expect(repeat.archived).toBe(false);
    expect(repeat.state.champions[6]?.genome.id).toBe(champion.id);
  });
});
