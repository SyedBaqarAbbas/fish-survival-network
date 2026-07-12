import { describe, expect, it } from "vitest";

import { TrailBuffer } from "./trailBuffer";

describe("TrailBuffer", () => {
  it("retains points in insertion order up to its capacity", () => {
    const trail = new TrailBuffer(3);
    trail.push(1, 2);
    trail.push(3, 4);
    trail.push(5, 6);
    expect(trail.toArray()).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it("evicts the oldest point without growing", () => {
    const trail = new TrailBuffer(2);
    trail.push(1, 2);
    trail.push(3, 4);
    trail.push(5, 6);
    expect(trail.length).toBe(2);
    expect(trail.toArray()).toEqual([
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it("clears and validates input", () => {
    const trail = new TrailBuffer();
    trail.push(1, 2);
    trail.clear();
    expect(trail.length).toBe(0);
    expect(trail.at(0)).toBeUndefined();
    expect(() => trail.push(Number.NaN, 1)).toThrow(RangeError);
    expect(() => new TrailBuffer(0)).toThrow(RangeError);
  });
});
