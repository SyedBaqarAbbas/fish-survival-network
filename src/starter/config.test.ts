import { describe, expect, it } from "vitest";

import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution/config";

import {
  STARTER_COMPLETED_GENERATIONS,
  STARTER_EVOLUTION_CONFIG,
  STARTER_FINAL_EVALUATED_GENERATION,
  STARTER_LEVEL_PLAN,
  starterChampionGeneration,
  starterLevelForGeneration,
} from "./config";

describe("starter training configuration", () => {
  it("changes only the robust evolution parameters", () => {
    expect(STARTER_EVOLUTION_CONFIG).toEqual({
      ...DEFAULT_EVOLUTION_CONFIG,
      eliteCount: 16,
      tournamentSize: 7,
      mutationProbability: 0.18,
      mutationStandardDeviation: 0.25,
    });
    expect(Object.isFrozen(STARTER_EVOLUTION_CONFIG)).toBe(true);
  });

  it("maps the complete 38-generation level recipe", () => {
    expect(STARTER_LEVEL_PLAN.map(({ level, generations }) => [
      level,
      generations,
    ])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 20],
    ]);
    expect(STARTER_COMPLETED_GENERATIONS).toBe(38);
    expect(STARTER_FINAL_EVALUATED_GENERATION).toBe(37);
    expect(starterLevelForGeneration(0)).toBe(0);
    expect(starterLevelForGeneration(17)).toBe(5);
    expect(starterLevelForGeneration(18)).toBe(6);
    expect(starterLevelForGeneration(37)).toBe(6);
    expect(Array.from({ length: 7 }, (_, level) =>
      starterChampionGeneration(level as 0 | 1 | 2 | 3 | 4 | 5 | 6),
    )).toEqual([2, 5, 8, 11, 14, 17, 37]);
  });

  it("rejects generations outside the recipe", () => {
    expect(() => starterLevelForGeneration(-1)).toThrow(RangeError);
    expect(() => starterLevelForGeneration(38)).toThrow(RangeError);
  });
});
