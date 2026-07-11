import { describe, expect, it } from "vitest";

import { deriveEpisodeSeed, SeededRandom } from "./random";

describe("SeededRandom", () => {
  it("matches its stable uint32 golden sequence", () => {
    const random = new SeededRandom(123);
    expect([
      random.nextUint32(),
      random.nextUint32(),
      random.nextUint32(),
      random.nextUint32(),
    ]).toEqual([3381219976, 766838775, 2127363934, 993692063]);
  });

  it("can resume from its serialized state", () => {
    const first = new SeededRandom(81);
    first.nextUint32();
    const resumed = new SeededRandom(first.getState());
    expect(resumed.nextUint32()).toBe(first.nextUint32());
  });

  it("derives independent stable generation and episode seeds", () => {
    expect([
      deriveEpisodeSeed(42, 0, 0),
      deriveEpisodeSeed(42, 0, 1),
      deriveEpisodeSeed(42, 1, 0),
    ]).toEqual([1158429784, 1732316037, 3342508776]);
  });

  it("rejects invalid ranges and seeds", () => {
    expect(() => new SeededRandom(-1)).toThrow(RangeError);
    expect(() => new SeededRandom(1.5)).toThrow(RangeError);
    expect(() => new SeededRandom(0x1_0000_0000)).toThrow(RangeError);
    expect(() => deriveEpisodeSeed(0x1_0000_0000, 0, 0)).toThrow(RangeError);
    expect(() => new SeededRandom(1).nextBetween(2, 2)).toThrow(RangeError);
    expect(() => new SeededRandom(1).nextInt(4, 3)).toThrow(RangeError);
  });
});
