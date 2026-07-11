import { describe, expect, it } from "vitest";

import { createEvolutionRun } from "@/evolution/population";
import type { NetworkGenome } from "@/evolution/types";

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
