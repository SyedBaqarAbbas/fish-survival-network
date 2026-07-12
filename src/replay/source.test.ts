import { describe, expect, it } from "vitest";

import { genomeParametersEqual } from "@/evolution";

import {
  assertReplaySource,
  cloneReplaySource,
  createDemoReplaySource,
  REPLAY_FISH_COUNT,
  replaySourceSchema,
} from "./source";

describe("replay sources", () => {
  it("creates an exact, deterministic level-six demo roster", () => {
    const first = createDemoReplaySource(42);
    const second = createDemoReplaySource(42);

    expect(first.entries).toHaveLength(REPLAY_FISH_COUNT);
    expect(first.level).toBe(6);
    expect(new Set(first.entries.map((entry) => entry.genome.id))).toHaveLength(
      REPLAY_FISH_COUNT,
    );
    expect(first.entries.every((entry) => entry.fitness === null)).toBe(true);
    expect(first.entries.every((entry) => entry.survivalRate === null)).toBe(true);
    expect(
      first.entries.every((entry, index) =>
        genomeParametersEqual(entry.genome, second.entries[index].genome),
      ),
    ).toBe(true);
    expect(
      first.entries[0].genome.inputToHidden.some((weight) => weight !== 0),
    ).toBe(true);
    expect(() => assertReplaySource(first)).not.toThrow();
  });

  it("deeply clones genomes and world configuration", () => {
    const source = createDemoReplaySource();
    const clone = cloneReplaySource(source);

    clone.world.width = 500;
    clone.entries[0].genome.inputToHidden[0] += 1;
    clone.entries[0].fitness = 4;

    expect(source.world.width).toBe(1000);
    expect(source.entries[0].fitness).toBeNull();
    expect(clone.entries[0].genome.inputToHidden.buffer).not.toBe(
      source.entries[0].genome.inputToHidden.buffer,
    );
    expect(
      genomeParametersEqual(clone.entries[0].genome, source.entries[0].genome),
    ).toBe(false);
  });

  it("rejects wrong-sized, duplicate, missing-champion, and extended sources", () => {
    const source = createDemoReplaySource();
    expect(
      replaySourceSchema.safeParse({ ...source, entries: source.entries.slice(1) })
        .success,
    ).toBe(false);
    expect(
      replaySourceSchema.safeParse({
        ...source,
        entries: [source.entries[0], source.entries[0], ...source.entries.slice(2)],
      }).success,
    ).toBe(false);
    expect(
      replaySourceSchema.safeParse({ ...source, championGenomeId: "missing" })
        .success,
    ).toBe(false);
    expect(replaySourceSchema.safeParse({ ...source, extra: true }).success).toBe(
      false,
    );
  });
});
