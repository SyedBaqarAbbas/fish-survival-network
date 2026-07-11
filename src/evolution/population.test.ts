import { afterEach, describe, expect, it, vi } from "vitest";

import { WORLD_CONFIG } from "@/simulation/config";

import { createEvolutionRun, evolveGeneration } from "./population";
import { makeEvolutionConfig } from "./__tests__/fixtures";

const SHORT_WORLD = Object.freeze({ ...WORLD_CONFIG, episodeSeconds: 0.25 });
const CONFIG = makeEvolutionConfig({
  populationSize: 6,
  eliteCount: 1,
  tournamentSize: 2,
  episodesPerGenome: 2,
});

function evolveFive(runSeed: number) {
  let state = createEvolutionRun({ runSeed, config: CONFIG });
  const results = [];
  for (let generation = 0; generation < 5; generation += 1) {
    const result = evolveGeneration(state, { world: SHORT_WORLD });
    results.push(result);
    state = result.state;
  }
  return { state, results };
}

describe("evolution runs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reproduces rankings, offspring, RNG state, level changes, and archives", () => {
    const first = evolveFive(1234);
    const second = evolveFive(1234);
    expect(second).toEqual(first);
    expect(first.state.generation).toBe(5);
    expect(first.state.curriculum.level).toBe(1);
    expect(first.state.curriculum.champions[0]).toBeDefined();
    expect(evolveFive(1235)).not.toEqual(first);
  });

  it("keeps future input columns at exact zero until their level", () => {
    const run = createEvolutionRun({ runSeed: 72, config: CONFIG });
    run.population.forEach((genome) => {
      for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
        const offset = hidden * genome.inputCount;
        for (let input = 1; input < genome.inputCount; input += 1) {
          expect(Object.is(genome.inputToHidden[offset + input], 0)).toBe(true);
        }
      }
    });

    const evolved = evolveFive(72).state;
    evolved.population.forEach((genome) => {
      for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
        const offset = hidden * genome.inputCount;
        for (let input = 2; input < genome.inputCount; input += 1) {
          expect(Object.is(genome.inputToHidden[offset + input], 0)).toBe(true);
        }
      }
    });
  });

  it("never uses Math.random during a complete generation", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("ambient randomness used");
    });
    const state = createEvolutionRun({ runSeed: 5, config: CONFIG });
    expect(() => evolveGeneration(state, { world: SHORT_WORLD })).not.toThrow();
  });

  it("does not mutate the checkpointable input state", () => {
    const state = createEvolutionRun({ runSeed: 19, config: CONFIG });
    const untouched = createEvolutionRun({ runSeed: 19, config: CONFIG });
    evolveGeneration(state, { world: SHORT_WORLD });
    expect(state).toEqual(untouched);
  });
});
