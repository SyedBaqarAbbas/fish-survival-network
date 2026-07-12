import { describe, expect, it } from "vitest";

import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution/config";
import { createEvolutionRun } from "@/evolution/population";
import type { NetworkGenome } from "@/evolution/types";
import type { ReplaySource } from "@/replay";

import {
  CheckpointValidationError,
  createRunCheckpoint,
  isRunCheckpoint,
  parseRunCheckpoint,
  restoreRunCheckpoint,
} from "./checkpoint";
import { makeCheckpoint, SHORT_TEST_WORLD, TEST_EVOLUTION_CONFIG } from "./__tests__/fixtures";
import type { RunCheckpoint } from "./types";

function parameterBytes(genome: Readonly<NetworkGenome>) {
  return [
    genome.inputToHidden,
    genome.hiddenBias,
    genome.hiddenToOutput,
    genome.outputBias,
  ].map(
    (vector) =>
      new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
  );
}

function cloneCheckpoint(checkpoint: RunCheckpoint) {
  return structuredClone(checkpoint);
}

function makeReplayCheckpoint() {
  const state = createEvolutionRun({
    runSeed: 91,
    config: {
      ...DEFAULT_EVOLUTION_CONFIG,
      populationSize: 48,
      episodesPerGenome: 1,
    },
  });
  const replaySource: ReplaySource = {
    sourceId: "test-run:generation:0",
    runId: "test-run",
    generation: 0,
    level: 0,
    world: { ...SHORT_TEST_WORLD },
    championGenomeId: state.population[0].id,
    entries: state.population.map((genome, index) => ({
      genome,
      fitness: index % 2 === 0 ? 100 - index : null,
      survivalRate: index % 3 === 0 ? index / 48 : null,
    })),
  };
  const checkpoint = createRunCheckpoint({
    runId: "test-run",
    savedAt: "2026-07-12T00:00:00.000Z",
    world: SHORT_TEST_WORLD,
    state,
    metricHistory: [],
    replaySource,
  });
  return { checkpoint, replaySource };
}

describe("run checkpoint codec", () => {
  it("round-trips canonical JSON with exact Float32 bytes", () => {
    const state = createEvolutionRun({
      runSeed: 99,
      config: TEST_EVOLUTION_CONFIG,
    });
    state.population[0].inputToHidden.set([
      -0,
      Number.MIN_VALUE,
      -5,
      5,
      1 / 3,
    ]);
    const checkpoint = createRunCheckpoint({
      runId: "byte-round-trip",
      savedAt: "2026-07-12T01:02:03.000Z",
      world: SHORT_TEST_WORLD,
      state,
      metricHistory: [],
    });

    expect(checkpoint.evolution.population[0].inputToHidden).toMatchObject({
      encoding: "f32-le-base64",
      length: 88,
    });
    const restored = restoreRunCheckpoint(
      JSON.parse(JSON.stringify(checkpoint)) as unknown,
    );
    state.population.forEach((source, genomeIndex) => {
      parameterBytes(source).forEach((bytes, vectorIndex) => {
        expect(
          parameterBytes(restored.state.population[genomeIndex])[vectorIndex],
        ).toEqual(bytes);
      });
    });
    expect(Object.is(restored.state.population[0].inputToHidden[0], -0)).toBe(
      true,
    );
  });

  it("owns restored arrays, config, world, and metrics", () => {
    const checkpoint = makeCheckpoint(1);
    const restored = restoreRunCheckpoint(checkpoint);
    restored.state.population[0].inputToHidden[0] = 4;
    restored.world.width = 20;
    restored.metricHistory[0].bestFitness = -100;

    const again = restoreRunCheckpoint(checkpoint);
    expect(again.state.population[0].inputToHidden[0]).not.toBe(4);
    expect(again.world.width).toBe(SHORT_TEST_WORLD.width);
    expect(again.metricHistory[0].bestFitness).not.toBe(-100);
    expect(Object.isFrozen(again.state.config)).toBe(true);
  });

  it("round-trips an explicit manual curriculum mode without changing legacy config", () => {
    const state = createEvolutionRun({
      runSeed: 100,
      config: { ...TEST_EVOLUTION_CONFIG, automaticCurriculum: false },
    });
    const checkpoint = createRunCheckpoint({
      runId: "manual-curriculum",
      savedAt: "2026-07-12T01:02:03.000Z",
      world: SHORT_TEST_WORLD,
      state,
      metricHistory: [],
    });

    expect(checkpoint.evolution.config.automaticCurriculum).toBe(false);
    expect(
      restoreRunCheckpoint(checkpoint).state.config.automaticCurriculum,
    ).toBe(false);
    expect(makeCheckpoint().evolution.config).not.toHaveProperty(
      "automaticCurriculum",
    );
  });

  it("round-trips an ordered replay roster with byte-exact owned genomes", () => {
    const { checkpoint, replaySource } = makeReplayCheckpoint();
    expect(checkpoint.replaySource?.entries).toHaveLength(48);
    expect(checkpoint.replaySource).not.toHaveProperty("world");

    const restored = restoreRunCheckpoint(
      JSON.parse(JSON.stringify(checkpoint)) as unknown,
    );
    expect(restored.replaySource).toMatchObject({
      sourceId: replaySource.sourceId,
      runId: replaySource.runId,
      generation: replaySource.generation,
      level: replaySource.level,
      world: SHORT_TEST_WORLD,
      championGenomeId: replaySource.championGenomeId,
    });
    expect(
      restored.replaySource?.entries.map((entry) => entry.genome.id),
    ).toEqual(replaySource.entries.map((entry) => entry.genome.id));
    replaySource.entries.forEach((entry, entryIndex) => {
      parameterBytes(entry.genome).forEach((bytes, vectorIndex) => {
        expect(
          parameterBytes(
            restored.replaySource?.entries[entryIndex].genome as NetworkGenome,
          )[vectorIndex],
        ).toEqual(bytes);
      });
    });

    const firstWeight = replaySource.entries[0].genome.inputToHidden[0];
    if (!restored.replaySource) throw new Error("Missing restored replay source.");
    restored.replaySource.entries[0].genome.inputToHidden[0] = 4;
    expect(
      restoreRunCheckpoint(checkpoint).replaySource?.entries[0].genome
        .inputToHidden[0],
    ).toBe(firstWeight);
  });

  it("validates replay roster size, identity, metadata, and checkpoint affinity", () => {
    const rosterSize = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    rosterSize.replaySource?.entries.pop();
    expect(isRunCheckpoint(rosterSize)).toBe(false);

    const duplicate = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    if (!duplicate.replaySource) throw new Error("Missing replay source.");
    duplicate.replaySource.entries[1].genome.id =
      duplicate.replaySource.entries[0].genome.id;
    expect(isRunCheckpoint(duplicate)).toBe(false);

    const champion = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    if (!champion.replaySource) throw new Error("Missing replay source.");
    champion.replaySource.championGenomeId = "not-in-the-roster";
    expect(isRunCheckpoint(champion)).toBe(false);

    const metadata = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    if (!metadata.replaySource) throw new Error("Missing replay source.");
    metadata.replaySource.entries[0].fitness = Number.POSITIVE_INFINITY;
    metadata.replaySource.entries[1].survivalRate = Number.NaN;
    expect(isRunCheckpoint(metadata)).toBe(false);

    const wrongRun = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    if (!wrongRun.replaySource) throw new Error("Missing replay source.");
    wrongRun.replaySource.runId = "other-run";
    expect(isRunCheckpoint(wrongRun)).toBe(false);

    const future = cloneCheckpoint(makeReplayCheckpoint().checkpoint);
    if (!future.replaySource) throw new Error("Missing replay source.");
    future.replaySource.generation = 1;
    expect(isRunCheckpoint(future)).toBe(false);
  });

  it("rejects a replay roster from a different world", () => {
    const { replaySource } = makeReplayCheckpoint();
    const state = createEvolutionRun({
      runSeed: 91,
      config: {
        ...DEFAULT_EVOLUTION_CONFIG,
        populationSize: 48,
        episodesPerGenome: 1,
      },
    });
    expect(() =>
      createRunCheckpoint({
        runId: "test-run",
        world: SHORT_TEST_WORLD,
        state,
        metricHistory: [],
        replaySource: {
          ...replaySource,
          world: { ...replaySource.world, width: replaySource.world.width + 1 },
        },
      }),
    ).toThrow("Replay source world must match");
  });

  it("accepts a manually selected curriculum level at generation zero", () => {
    const state = createEvolutionRun({
      runSeed: 99,
      config: TEST_EVOLUTION_CONFIG,
    });
    state.curriculum.level = 4;
    const checkpoint = createRunCheckpoint({
      runId: "manual-level",
      world: SHORT_TEST_WORLD,
      state,
      metricHistory: [],
    });
    expect(restoreRunCheckpoint(checkpoint).state.curriculum.level).toBe(4);
  });

  it("rejects unknown versions before attempting the version schema", () => {
    const checkpoint = { ...makeCheckpoint(), schemaVersion: 2 };
    const result = parseRunCheckpoint(checkpoint);
    expect(result).toMatchObject({
      success: false,
      reason: "UNSUPPORTED_VERSION",
    });
    expect(() => restoreRunCheckpoint(checkpoint)).toThrow(
      CheckpointValidationError,
    );
  });

  it("rejects strict-object, topology, population, and history violations", () => {
    const extra = { ...makeCheckpoint(), unexpected: true };
    expect(isRunCheckpoint(extra)).toBe(false);

    const topology = cloneCheckpoint(makeCheckpoint());
    (topology.evolution.population[0] as { inputCount: number }).inputCount = 10;
    expect(isRunCheckpoint(topology)).toBe(false);

    const population = cloneCheckpoint(makeCheckpoint());
    population.evolution.population.pop();
    expect(isRunCheckpoint(population)).toBe(false);

    const history = cloneCheckpoint(makeCheckpoint(1));
    history.metricHistory = [];
    expect(isRunCheckpoint(history)).toBe(false);
  });

  it("rejects truncated and non-finite Float32 payloads", () => {
    const truncated = cloneCheckpoint(makeCheckpoint());
    truncated.evolution.population[0].inputToHidden.data =
      truncated.evolution.population[0].inputToHidden.data.slice(0, -4);
    expect(isRunCheckpoint(truncated)).toBe(false);

    const nonFinite = cloneCheckpoint(makeCheckpoint());
    const payload = nonFinite.evolution.population[0].inputToHidden;
    const binary = atob(payload.data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    new DataView(bytes.buffer).setUint32(0, 0x7fc00000, true);
    payload.data = btoa(String.fromCharCode(...bytes));
    const result = parseRunCheckpoint(nonFinite);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.message.includes("finite"))).toBe(
        true,
      );
    }
  });

  it("rejects non-canonical Base64 with trailing decoded bytes", () => {
    const checkpoint = cloneCheckpoint(makeCheckpoint());
    const payload = checkpoint.evolution.population[0].inputToHidden;
    expect(payload.data.endsWith("==")).toBe(true);
    payload.data = `${payload.data.slice(0, -2)}AA`;

    expect(parseRunCheckpoint(checkpoint)).toMatchObject({
      success: false,
      reason: "INVALID_CHECKPOINT",
    });
  });

  it("returns validation issues for an invalid same-length Base64 payload", () => {
    const checkpoint = cloneCheckpoint(makeCheckpoint());
    const payload = checkpoint.evolution.population[0].inputToHidden;
    payload.data = "!".repeat(payload.data.length);

    expect(() => parseRunCheckpoint(checkpoint)).not.toThrow();
    expect(parseRunCheckpoint(checkpoint)).toMatchObject({
      success: false,
      reason: "INVALID_CHECKPOINT",
    });
  });

  it("rejects duplicate genome identifiers", () => {
    const checkpoint = cloneCheckpoint(makeCheckpoint());
    checkpoint.evolution.population[1].id =
      checkpoint.evolution.population[0].id;
    expect(isRunCheckpoint(checkpoint)).toBe(false);
  });
});
