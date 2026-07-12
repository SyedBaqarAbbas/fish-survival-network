import { describe, expect, it } from "vitest";

import {
  containWorld,
  findFishAtPoint,
  interpolateValues,
  interpolationAlpha,
  screenToWorld,
} from "./math";

describe("rendering math", () => {
  it("contains a 10:7 world and centers letterboxing", () => {
    expect(containWorld(1_200, 700, 1_000, 700)).toEqual({
      offsetX: 100,
      offsetY: 0,
      scale: 1,
      viewHeight: 700,
      viewWidth: 1_200,
      worldHeight: 700,
      worldWidth: 1_000,
    });
    expect(screenToWorld(600, 350, containWorld(1_200, 700, 1_000, 700))).toEqual({
      x: 500,
      y: 350,
    });
  });

  it("rejects invalid dimensions", () => {
    expect(() => containWorld(0, 700, 1_000, 700)).toThrow(RangeError);
    expect(() => containWorld(1_000, 700, Number.NaN, 700)).toThrow(RangeError);
  });

  it("clamps interpolation to the current snapshot interval", () => {
    expect(interpolationAlpha(1, 1.1, 1_000, 1_025, 1)).toBeCloseTo(0.25);
    expect(interpolationAlpha(1, 1.1, 1_000, 1_025, 2)).toBeCloseTo(0.5);
    expect(interpolationAlpha(1, 1.1, 1_000, 900, 1)).toBe(0);
    expect(interpolationAlpha(1, 1.1, 1_000, 2_000, 1)).toBe(1);
    expect(interpolationAlpha(1, 1, 1_000, 1_010, 1)).toBe(1);
  });

  it("interpolates packed values without extrapolating", () => {
    const target = new Float32Array(2);
    expect(
      Array.from(
        interpolateValues(
          new Float32Array([0, 10]),
          new Float32Array([10, 30]),
          0.25,
          target,
        ),
      ),
    ).toEqual([2.5, 15]);
    expect(
      Array.from(
        interpolateValues(
          new Float32Array([0, 10]),
          new Float32Array([10, 30]),
          2,
          target,
        ),
      ),
    ).toEqual([10, 30]);
  });

  it("selects the nearest living fish and resolves ties by index", () => {
    const positions = new Float32Array([10, 10, 14, 10, 10, 10]);
    const alive = new Uint8Array([1, 1, 0]);
    expect(findFishAtPoint(positions, alive, 12, 10, 3)).toBe(0);
    expect(findFishAtPoint(positions, alive, 14, 10, 1)).toBe(1);
    expect(findFishAtPoint(positions, alive, 100, 100, 5)).toBeNull();
  });
});
