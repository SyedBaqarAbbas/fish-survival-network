import { describe, expect, it } from "vitest";

import { getStarterReplaySource } from "./server";

describe("starter replay server boundary", () => {
  it("returns a valid owned clone without exposing the canonical source", () => {
    const source = getStarterReplaySource();
    const expected = {
      firstFitness: source.entries[0].fitness,
      firstGenomeId: source.entries[0].genome.id,
      firstWeights: new Uint8Array(
        source.entries[0].genome.inputToHidden.buffer.slice(0),
      ),
      sourceId: source.sourceId,
      width: source.world.width,
    };

    expect(source).toMatchObject({
      championGenomeId: "g37-i60",
      generation: 37,
      level: 6,
    });
    expect(source.entries).toHaveLength(48);

    source.sourceId = "mutated";
    source.world.width = 1;
    source.entries[0].fitness = -1;
    source.entries[0].genome.inputToHidden[0] = 123;
    source.entries.reverse();

    const nextSource = getStarterReplaySource();
    expect(nextSource.sourceId).toBe(expected.sourceId);
    expect(nextSource.world.width).toBe(expected.width);
    expect(nextSource.entries[0].fitness).toBe(expected.firstFitness);
    expect(nextSource.entries[0].genome.id).toBe(expected.firstGenomeId);
    expect(
      new Uint8Array(nextSource.entries[0].genome.inputToHidden.buffer),
    ).toEqual(expected.firstWeights);
    expect(nextSource).not.toBe(source);
    expect(nextSource.world).not.toBe(source.world);
    expect(nextSource.entries).not.toBe(source.entries);
    expect(nextSource.entries[0].genome.inputToHidden).not.toBe(
      source.entries.at(-1)?.genome.inputToHidden,
    );
  });
});
