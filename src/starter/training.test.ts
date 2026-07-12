import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { genomeFloat32Bytes } from "@/persistence";

import starterArtifact from "./artifacts/level-6-starter.v1.json";
import {
  STARTER_ARTIFACT_FILENAME,
  STARTER_CHECKSUM_FILENAME,
  STARTER_COMPLETED_GENERATIONS,
  STARTER_EXPECTED_ARTIFACT_SHA256,
  STARTER_EXPECTED_CHAMPION_ID,
  STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256,
  STARTER_LEVEL_PLAN,
  starterChampionGeneration,
} from "./config";
import { validateStarterCheckpoint } from "./validation";

describe("committed starter training output", () => {
  it("captures the complete curriculum recipe without retraining", () => {
    const { restored } = validateStarterCheckpoint(starterArtifact);
    const historyCounts = STARTER_LEVEL_PLAN.map(({ level }) =>
      restored.metricHistory.filter((metric) => metric.level === level).length,
    );

    expect(restored.state.generation).toBe(STARTER_COMPLETED_GENERATIONS);
    expect(historyCounts).toEqual(STARTER_LEVEL_PLAN.map((stage) => stage.generations));
    expect(restored.metricHistory.every(
      (metric) => metric.durationMilliseconds === 0,
    )).toBe(true);
    expect(restored.metricHistory.filter(
      (metric) => metric.curriculumAdvanced,
    ).map((metric) => metric.generation)).toEqual([2, 5, 8, 11, 14, 17]);
  });

  it("archives each stage winner and the final pre-reproduction top 48", () => {
    const { restored, replaySource } = validateStarterCheckpoint(starterArtifact);
    const championGenerations = Array.from({ length: 7 }, (_, level) =>
      restored.state.curriculum.champions[
        level as 0 | 1 | 2 | 3 | 4 | 5 | 6
      ]?.generation,
    );

    expect(championGenerations).toEqual(
      Array.from({ length: 7 }, (_, level) =>
        starterChampionGeneration(level as 0 | 1 | 2 | 3 | 4 | 5 | 6),
      ),
    );
    expect(replaySource.entries).toHaveLength(48);
    expect(replaySource.championGenomeId).toBe(STARTER_EXPECTED_CHAMPION_ID);
    expect(replaySource.entries[0].genome.id).toBe(STARTER_EXPECTED_CHAMPION_ID);
    expect(replaySource.entries.every(
      (entry) => entry.fitness !== null && entry.survivalRate !== null,
    )).toBe(true);
    expect(replaySource.entries.every((entry, index, entries) =>
      index === 0 || (entries[index - 1].fitness ?? -Infinity) >= (entry.fitness ?? Infinity),
    )).toBe(true);
    expect(
      createHash("sha256")
        .update(genomeFloat32Bytes(replaySource.entries[0].genome))
        .digest("hex"),
    ).toBe(STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256);
  });

  it("matches the committed raw artifact and checksum sidecar", () => {
    const artifactPath = resolve(
      process.cwd(),
      "src",
      "starter",
      "artifacts",
      STARTER_ARTIFACT_FILENAME,
    );
    const checksumPath = resolve(
      process.cwd(),
      "src",
      "starter",
      "artifacts",
      STARTER_CHECKSUM_FILENAME,
    );
    const artifact = readFileSync(artifactPath, "utf8");
    const sha256 = createHash("sha256").update(artifact, "utf8").digest("hex");

    expect(artifact).toBe(`${JSON.stringify(starterArtifact, null, 2)}\n`);
    expect(sha256).toBe(STARTER_EXPECTED_ARTIFACT_SHA256);
    expect(readFileSync(checksumPath, "utf8")).toBe(
      `${sha256}  ${STARTER_ARTIFACT_FILENAME}\n`,
    );
  });
});
