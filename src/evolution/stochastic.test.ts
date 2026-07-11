import { describe, expect, it } from "vitest";

import { SeededRandom } from "@/simulation/random";

import { gaussianRandom } from "./stochastic";

describe("Gaussian randomness", () => {
  it("uses a stable uncached Box-Muller sequence and RNG state", () => {
    const random = new SeededRandom(123);
    expect([
      gaussianRandom(random),
      gaussianRandom(random),
      gaussianRandom(random),
    ]).toEqual([
      0.7636281182624862,
      0.13663860710415962,
      0.48553135791743923,
    ]);
    expect(random.getState()).toBe(2399460409);
  });
});
