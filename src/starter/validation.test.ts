import { describe, expect, it } from "vitest";

import starterArtifact from "./artifacts/level-6-starter.v1.json";
import {
  STARTER_EXPECTED_CHAMPION_ID,
  STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS,
  STARTER_EXPECTED_HELD_OUT_SURVIVORS,
  STARTER_HELD_OUT_EPISODE_COUNT,
} from "./config";
import {
  StarterCheckpointValidationError,
  validateStarterCheckpoint,
} from "./validation";

function mutableArtifact() {
  return structuredClone(starterArtifact);
}

function expectStarterFailure(value: unknown) {
  expect(() => validateStarterCheckpoint(value)).toThrow(
    StarterCheckpointValidationError,
  );
}

describe("validateStarterCheckpoint", () => {
  it("returns an owned checkpoint, replay source, and deterministic report", () => {
    const first = validateStarterCheckpoint(starterArtifact);
    const second = validateStarterCheckpoint(starterArtifact);

    expect(first.report.championGenomeId).toBe(STARTER_EXPECTED_CHAMPION_ID);
    expect(first.report.heldOut).toMatchObject({
      survivors: STARTER_EXPECTED_HELD_OUT_SURVIVORS,
      episodeCount: STARTER_HELD_OUT_EPISODE_COUNT,
      survivalRate:
        STARTER_EXPECTED_HELD_OUT_SURVIVORS / STARTER_HELD_OUT_EPISODE_COUNT,
    });
    expect(first.report.heldOut.meanAliveSeconds).toBeCloseTo(
      STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS,
      10,
    );
    expect(new Set(first.report.heldOut.seeds)).toHaveProperty(
      "size",
      STARTER_HELD_OUT_EPISODE_COUNT,
    );

    first.replaySource.entries[0].genome.inputToHidden[0] += 1;
    expect(second.replaySource.entries[0].genome.inputToHidden[0]).not.toBe(
      first.replaySource.entries[0].genome.inputToHidden[0],
    );
  });

  it("rejects starter-specific config, history, and replay corruption", () => {
    const corrupted = mutableArtifact();
    corrupted.evolution.config.tournamentSize = 5;
    corrupted.metricHistory[0].durationMilliseconds = 1;
    (
      corrupted.replaySource!.entries[1] as { fitness: number | null }
    ).fitness = null;

    expect(() => validateStarterCheckpoint(corrupted)).toThrow(
      StarterCheckpointValidationError,
    );
    try {
      validateStarterCheckpoint(corrupted);
    } catch (error) {
      expect(error).toBeInstanceOf(StarterCheckpointValidationError);
      const codes = (error as StarterCheckpointValidationError).issues.map(
        (entry) => entry.code,
      );
      expect(codes).toEqual(
        expect.arrayContaining([
          "starter_evolution_config",
          "starter_history_duration",
          "starter_replay_metadata",
        ]),
      );
    }
  });

  it("wraps base checkpoint failures in the starter error type", () => {
    const corrupted = mutableArtifact();
    corrupted.schemaVersion = 99 as 1;

    expect(() => validateStarterCheckpoint(corrupted)).toThrow(
      StarterCheckpointValidationError,
    );
    try {
      validateStarterCheckpoint(corrupted);
    } catch (error) {
      expect((error as StarterCheckpointValidationError).issues[0]).toMatchObject({
        path: ["schemaVersion"],
        code: "checkpoint_unsupported_version",
      });
    }
  });

  it("rejects a truncated Float32 Base64 payload", () => {
    const corrupted = mutableArtifact();
    const vector = corrupted.replaySource!.entries[0].genome.inputToHidden;
    vector.data = vector.data.slice(0, -4);

    expectStarterFailure(corrupted);
  });

  it("rejects canonical Float32 NaN bytes", () => {
    const corrupted = mutableArtifact();
    const vector = corrupted.replaySource!.entries[0].genome.inputToHidden;
    const bytes = Buffer.from(vector.data, "base64");
    bytes.writeFloatLE(Number.NaN, 0);
    vector.data = bytes.toString("base64");

    expectStarterFailure(corrupted);
  });

  it("rejects a network topology mismatch", () => {
    const corrupted = mutableArtifact();
    (corrupted.replaySource!.entries[0].genome as { inputCount: number }).inputCount =
      12;

    expectStarterFailure(corrupted);
  });
});
