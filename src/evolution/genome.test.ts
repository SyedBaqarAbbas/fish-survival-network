import { describe, expect, it } from "vitest";

import { SeededRandom } from "@/simulation/random";

import {
  assertGenomeShape,
  cloneGenome,
  createRandomGenome,
  genomeParametersEqual,
  getGenomeParameterCount,
} from "./genome";
import { FISH_NETWORK_TOPOLOGY } from "./types";

describe("network genomes", () => {
  it("uses the fixed 114-parameter fish topology", () => {
    expect(getGenomeParameterCount(FISH_NETWORK_TOPOLOGY)).toBe(114);
  });

  it("initializes active weights with Xavier and locked columns as exact zero", () => {
    const genome = createRandomGenome("fish", new SeededRandom(7));
    const inputLimit = Math.sqrt(6 / (11 + 8));
    const outputLimit = Math.sqrt(6 / (8 + 2));

    for (let hidden = 0; hidden < genome.hiddenCount; hidden += 1) {
      const offset = hidden * genome.inputCount;
      expect(Math.abs(genome.inputToHidden[offset])).toBeLessThanOrEqual(inputLimit);
      for (let input = 1; input < genome.inputCount; input += 1) {
        expect(Object.is(genome.inputToHidden[offset + input], 0)).toBe(true);
      }
    }
    expect(Array.from(genome.hiddenBias)).toEqual(new Array(8).fill(0));
    expect(Array.from(genome.outputBias)).toEqual(new Array(2).fill(0));
    genome.hiddenToOutput.forEach((weight) => {
      expect(Math.abs(weight)).toBeLessThanOrEqual(outputLimit);
    });
  });

  it("is deterministic per seed and can initialize a later active level", () => {
    const first = createRandomGenome("a", new SeededRandom(11), undefined, 2);
    const second = createRandomGenome("b", new SeededRandom(11), undefined, 2);
    expect(genomeParametersEqual(first, second)).toBe(true);
    expect(
      genomeParametersEqual(first, createRandomGenome("c", new SeededRandom(12))),
    ).toBe(false);

    for (let hidden = 0; hidden < first.hiddenCount; hidden += 1) {
      const offset = hidden * first.inputCount;
      expect(Array.from(first.inputToHidden.slice(offset, offset + 4))).not.toEqual(
        [0, 0, 0, 0],
      );
      expect(Array.from(first.inputToHidden.slice(offset + 4, offset + 11))).toEqual(
        [0, 0, 0, 0, 0, 0, 0],
      );
    }
  });

  it("deep-clones every parameter byte", () => {
    const source = createRandomGenome("source", new SeededRandom(99));
    const clone = cloneGenome(source);
    expect(genomeParametersEqual(source, clone)).toBe(true);
    expect(clone.inputToHidden).not.toBe(source.inputToHidden);
    source.inputToHidden[0] += 1;
    expect(genomeParametersEqual(source, clone)).toBe(false);
  });

  it("rejects mismatched declared topology", () => {
    const genome = createRandomGenome("bad", new SeededRandom(1));
    genome.inputToHidden = new Float32Array(3);
    expect(() => assertGenomeShape(genome)).toThrow("inputToHidden");
  });
});
