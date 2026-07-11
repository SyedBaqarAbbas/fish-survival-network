import { describe, expect, it } from "vitest";

import {
  aggregateEpisodeEvaluations,
  calculateFishFitness,
  medianSurvivalRate,
} from "./fitness";
import { makeEvaluation } from "./__tests__/fixtures";

describe("fish fitness", () => {
  it("applies the specified survival fitness coefficients", () => {
    const fitness = calculateFishFitness({
      aliveSeconds: 10,
      survived: true,
      meanPredatorDistance: 0.5,
      wallCollisions: 2,
      meanAccelerationSquared: 0.25,
    });
    expect(fitness).toBeCloseTo(10 + 5 + 0.075 - 0.8 - 0.0025);
    expect(
      calculateFishFitness({
        aliveSeconds: 11,
        survived: false,
        meanPredatorDistance: 0,
        wallCollisions: 0,
        meanAccelerationSquared: 0,
      }),
    ).toBeGreaterThan(
      calculateFishFitness({
        aliveSeconds: 10,
        survived: false,
        meanPredatorDistance: 1,
        wallCollisions: 0,
        meanAccelerationSquared: 0,
      }),
    );
  });

  it("aggregates episode fitness, survival rate, and alive time", () => {
    const episodes = [
      makeEvaluation("a", 0, 4, 1).episodes[0],
      makeEvaluation("a", 0, 2, 0).episodes[0],
    ];
    const result = aggregateEpisodeEvaluations("a", 0, episodes);
    expect(result.fitness).toBe(3);
    expect(result.survivalRate).toBe(0.5);
    expect(result.meanAliveSeconds).toBe(7.5);
  });

  it("uses the arithmetic median and maps invalid rates to zero", () => {
    expect(
      medianSurvivalRate([
        makeEvaluation("a", 0, 0, 0.25),
        makeEvaluation("b", 1, 0, 1),
        makeEvaluation("c", 2, 0, 0.5),
        makeEvaluation("d", 3, 0, 0.75),
      ]),
    ).toBe(0.625);
    const invalid = makeEvaluation("invalid", 0, 0, 0);
    invalid.survivalRate = Number.NaN;
    expect(medianSurvivalRate([invalid, makeEvaluation("valid", 1, 0, 1)])).toBe(
      0.5,
    );
  });
});
