import { afterEach, describe, expect, it, vi } from "vitest";

import { WORLD_CONFIG } from "@/simulation/config";

import { makeEvolutionConfig } from "./__tests__/fixtures";
import { evaluatePopulation } from "./evaluation";
import {
  completeEvaluatedGeneration,
  createEvolutionRun,
  evolveGeneration,
  setCurriculumLevel,
} from "./population";

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

function evaluateCurrentGeneration(runSeed = 41) {
  const state = createEvolutionRun({ runSeed, config: CONFIG });
  const evaluation = evaluatePopulation(state.population, {
    runSeed: state.runSeed,
    generation: state.generation,
    level: state.curriculum.level,
    episodesPerGenome: state.config.episodesPerGenome,
    world: SHORT_WORLD,
  });
  return { state, evaluation };
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

  it("completes a pre-evaluated generation identically to the wrapper", () => {
    const { state, evaluation } = evaluateCurrentGeneration(51);
    expect(completeEvaluatedGeneration(state, evaluation)).toEqual(
      evolveGeneration(state, { world: SHORT_WORLD }),
    );
  });

  it("rejects stale, incomplete, or mismatched population evaluations", () => {
    const { state, evaluation } = evaluateCurrentGeneration();

    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        generation: evaluation.generation + 1,
      }),
    ).toThrow("Evaluation generation does not match");
    expect(() =>
      completeEvaluatedGeneration(state, { ...evaluation, level: 1 }),
    ).toThrow("Evaluation level does not match");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        episodeSeeds: evaluation.episodeSeeds.map((seed, index) =>
          index === 0 ? seed + 1 : seed,
        ),
      }),
    ).toThrow("Evaluation seeds do not match");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        genomes: evaluation.genomes.slice(0, -1),
      }),
    ).toThrow("Evaluation count does not match");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        genomes: evaluation.genomes.map((genome, index) =>
          index === 0 ? { ...genome, genomeId: "stale-genome" } : genome,
        ),
      }),
    ).toThrow("Evaluation does not match population index 0");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        genomes: evaluation.genomes.map((genome, index) =>
          index === 0 ? { ...genome, populationIndex: 1 } : genome,
        ),
      }),
    ).toThrow("Evaluation does not match population index 0");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        genomes: evaluation.genomes.map((genome, index) =>
          index === 0
            ? { ...genome, episodes: genome.episodes.slice(0, -1) }
            : genome,
        ),
      }),
    ).toThrow("has the wrong episode count");
    expect(() =>
      completeEvaluatedGeneration(state, {
        ...evaluation,
        genomes: evaluation.genomes.map((genome, genomeIndex) =>
          genomeIndex === 0
            ? {
                ...genome,
                episodes: genome.episodes.map((episode, episodeIndex) =>
                  episodeIndex === 0
                    ? { ...episode, seed: episode.seed + 1 }
                    : episode,
                ),
              }
            : genome,
        ),
      }),
    ).toThrow("does not use the shared seeds");
  });

  it("sets higher curriculum levels in the same deterministic unlock order", () => {
    const state = createEvolutionRun({ runSeed: 61, config: CONFIG });
    const direct = setCurriculumLevel(state, 3);
    const stepped = setCurriculumLevel(
      setCurriculumLevel(setCurriculumLevel(state, 1), 2),
      3,
    );

    expect(direct).toEqual(stepped);
    expect(direct.randomState).not.toBe(state.randomState);
    expect(direct.curriculum.level).toBe(3);
    expect(direct.curriculum.stableGenerations).toBe(0);
    direct.population.forEach((genome, populationIndex) => {
      const source = state.population[populationIndex];
      const unlockedWeights: number[] = [];
      for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
        const offset = hidden * genome.inputCount;
        expect(genome.inputToHidden[offset]).toBe(
          source.inputToHidden[offset],
        );
        unlockedWeights.push(
          ...genome.inputToHidden.slice(offset + 1, offset + 5),
        );
        for (let input = 5; input < genome.inputCount; input += 1) {
          expect(Object.is(genome.inputToHidden[offset + input], 0)).toBe(true);
        }
      }
      expect(unlockedWeights.some((weight) => weight !== 0)).toBe(true);
      expect(genome.hiddenBias).toEqual(source.hiddenBias);
      expect(genome.hiddenToOutput).toEqual(source.hiddenToOutput);
      expect(genome.outputBias).toEqual(source.outputBias);
    });
    expect(state.curriculum.level).toBe(0);
  });

  it("zeros relocked columns without consuming RNG or deleting archives", () => {
    const evolved = evolveFive(73).state;
    const source = {
      ...evolved,
      curriculum: { ...evolved.curriculum, stableGenerations: 4 },
    };
    const lowered = setCurriculumLevel(source, 0);

    expect(lowered.randomState).toBe(source.randomState);
    expect(lowered.curriculum.level).toBe(0);
    expect(lowered.curriculum.stableGenerations).toBe(0);
    expect(lowered.curriculum.champions).toBe(source.curriculum.champions);
    lowered.population.forEach((genome, populationIndex) => {
      const original = source.population[populationIndex];
      for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
        const offset = hidden * genome.inputCount;
        expect(genome.inputToHidden[offset]).toBe(
          original.inputToHidden[offset],
        );
        for (let input = 1; input < genome.inputCount; input += 1) {
          expect(Object.is(genome.inputToHidden[offset + input], 0)).toBe(true);
        }
      }
    });
    expect(source.curriculum.level).toBe(1);
    expect(source.curriculum.stableGenerations).toBe(4);
    expect(
      source.population.some((genome) =>
        genome.inputToHidden.some(
          (weight, index) => index % genome.inputCount === 1 && weight !== 0,
        ),
      ),
    ).toBe(true);
  });

  it("rejects curriculum levels outside the supported range", () => {
    const state = createEvolutionRun({ runSeed: 8, config: CONFIG });
    expect(() => setCurriculumLevel(state, 7 as never)).toThrow(RangeError);
  });
});
