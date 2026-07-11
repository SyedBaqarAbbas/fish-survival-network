import { describe, expect, it } from "vitest";

import { FISH_INPUT_COUNT, FISH_INPUT_INDEX } from "./config";
import { calculateClosingSpeed, observeFish } from "./sensors";
import { makeFish, makePredator } from "./__tests__/fixtures";
import type { CurriculumLevel } from "./types";

describe("fish observations", () => {
  it("unlocks sensors by curriculum level and keeps future inputs at zero", () => {
    const fish = makeFish({ x: 100, y: 140, vx: 57.5, vy: -57.5 });
    const predator = makePredator({ x: 450, y: 140, vx: -100 });
    const highestUnlockedIndex = [0, 1, 3, 4, 6, 8, 10];

    for (let level = 0; level <= 6; level += 1) {
      const observation = observeFish(fish, predator, level as CurriculumLevel);
      expect(observation).toHaveLength(FISH_INPUT_COUNT);
      expect(observation[FISH_INPUT_INDEX.bias]).toBe(1);
      for (
        let index = highestUnlockedIndex[level] + 1;
        index < observation.length;
        index += 1
      ) {
        expect(Object.is(observation[index], 0)).toBe(true);
      }
    }
  });

  it("calculates normalized direction, closing speed, walls, and velocity", () => {
    const fish = makeFish({ x: 100, y: 140, vx: 57.5, vy: -57.5 });
    const predator = makePredator({ x: 450, y: 140, vx: -100 });
    const observation = observeFish(fish, predator, 6);

    expect(observation[FISH_INPUT_INDEX.distance]).toBeCloseTo(0.5);
    expect(observation[FISH_INPUT_INDEX.directionX]).toBeCloseTo(1);
    expect(observation[FISH_INPUT_INDEX.directionY]).toBeCloseTo(0);
    expect(observation[FISH_INPUT_INDEX.closingSpeed]).toBeCloseTo(157.5 / 260);
    expect(observation[FISH_INPUT_INDEX.wallTop]).toBeCloseTo(0.2);
    expect(observation[FISH_INPUT_INDEX.wallBottom]).toBeCloseTo(0.8);
    expect(observation[FISH_INPUT_INDEX.wallLeft]).toBeCloseTo(0.1);
    expect(observation[FISH_INPUT_INDEX.wallRight]).toBeCloseTo(0.9);
    expect(observation[FISH_INPUT_INDEX.velocityX]).toBeCloseTo(0.5);
    expect(observation[FISH_INPUT_INDEX.velocityY]).toBeCloseTo(-0.5);
  });

  it("returns finite zero direction and closing speed at zero distance", () => {
    const fish = makeFish({ x: 200, y: 200, vx: 10, vy: 5 });
    const predator = makePredator({ x: 200, y: 200, vx: -10, vy: -5 });
    const observation = observeFish(fish, predator, 6);

    expect(calculateClosingSpeed(fish, predator)).toBe(0);
    expect(observation[FISH_INPUT_INDEX.directionX]).toBe(0);
    expect(observation[FISH_INPUT_INDEX.directionY]).toBe(0);
    expect(observation[FISH_INPUT_INDEX.closingSpeed]).toBe(0);
    expect(Array.from(observation).every(Number.isFinite)).toBe(true);
  });

  it("clamps every normalized sensor to its documented range", () => {
    const fish = makeFish({ x: -500, y: 1_500, vx: 10_000, vy: -10_000 });
    const predator = makePredator({ x: 5_000, y: -2_000, vx: -10_000, vy: 10_000 });
    const observation = observeFish(fish, predator, 6);
    const unitInputs = [
      FISH_INPUT_INDEX.distance,
      FISH_INPUT_INDEX.wallTop,
      FISH_INPUT_INDEX.wallBottom,
      FISH_INPUT_INDEX.wallLeft,
      FISH_INPUT_INDEX.wallRight,
    ];
    const signedInputs = [
      FISH_INPUT_INDEX.directionX,
      FISH_INPUT_INDEX.directionY,
      FISH_INPUT_INDEX.closingSpeed,
      FISH_INPUT_INDEX.velocityX,
      FISH_INPUT_INDEX.velocityY,
    ];

    unitInputs.forEach((index) => {
      expect(observation[index]).toBeGreaterThanOrEqual(0);
      expect(observation[index]).toBeLessThanOrEqual(1);
    });
    signedInputs.forEach((index) => {
      expect(observation[index]).toBeGreaterThanOrEqual(-1);
      expect(observation[index]).toBeLessThanOrEqual(1);
    });
  });

  it("reuses and clears a caller-provided observation buffer", () => {
    const target = new Float32Array(FISH_INPUT_COUNT).fill(1);
    const result = observeFish(makeFish(), makePredator(), 0, undefined, target);
    expect(result).toBe(target);
    expect(Array.from(result)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
