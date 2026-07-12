import { describe, expect, it } from "vitest";

import { createEvolutionRun } from "@/evolution";
import { createRunCheckpoint } from "@/persistence";
import { WORLD_CONFIG } from "@/simulation/config";

import {
  isTrainerCommand,
  isTrainerEvent,
  TRAINER_PROTOCOL_VERSION,
} from "./protocol";

const freshInitialize = {
  type: "INITIALIZE",
  protocolVersion: TRAINER_PROTOCOL_VERSION,
  runId: "run-1",
  runSeed: 42,
} as const;

function makeCheckpoint() {
  return createRunCheckpoint({
    runId: "run-1",
    savedAt: "2026-07-12T00:00:00.000Z",
    world: WORLD_CONFIG,
    state: createEvolutionRun({ runSeed: 42 }),
    metricHistory: [],
  });
}

describe("trainer protocol", () => {
  it("accepts all strict, versioned commands", () => {
    const commands = [
      freshInitialize,
      {
        type: "INITIALIZE",
        protocolVersion: TRAINER_PROTOCOL_VERSION,
        checkpoint: makeCheckpoint(),
      },
      { type: "START", protocolVersion: TRAINER_PROTOCOL_VERSION },
      { type: "PAUSE", protocolVersion: TRAINER_PROTOCOL_VERSION },
      {
        type: "RESET",
        protocolVersion: TRAINER_PROTOCOL_VERSION,
        runId: "run-2",
        runSeed: 7,
        evolutionConfig: {
          ...makeCheckpoint().evolution.config,
          automaticCurriculum: false,
        },
      },
      {
        type: "CURRICULUM",
        protocolVersion: TRAINER_PROTOCOL_VERSION,
        level: 4,
      },
      { type: "CHECKPOINT", protocolVersion: TRAINER_PROTOCOL_VERSION },
    ];

    commands.forEach((command) => expect(isTrainerCommand(command)).toBe(true));
  });

  it("rejects malformed, mixed-source, unversioned, and extended commands", () => {
    expect(isTrainerCommand({ type: "START" })).toBe(false);
    expect(
      isTrainerCommand({ ...freshInitialize, protocolVersion: 2 }),
    ).toBe(false);
    expect(
      isTrainerCommand({ ...freshInitialize, checkpoint: makeCheckpoint() }),
    ).toBe(false);
    expect(
      isTrainerCommand({ ...freshInitialize, unexpected: true }),
    ).toBe(false);
    expect(
      isTrainerCommand({
        ...freshInitialize,
        evolutionConfig: {
          ...makeCheckpoint().evolution.config,
          automaticCurriculum: "false",
        },
      }),
    ).toBe(false);
    expect(
      isTrainerCommand({
        type: "CURRICULUM",
        protocolVersion: TRAINER_PROTOCOL_VERSION,
        level: 7,
      }),
    ).toBe(false);
  });

  it("accepts every strict worker event", () => {
    const checkpoint = makeCheckpoint();
    const events = [
      {
        type: "READY",
        protocolVersion: TRAINER_PROTOCOL_VERSION,
        checkpointSchemaVersion: 1,
        runId: "run-1",
        generation: 0,
        level: 0,
        status: "paused",
        restored: false,
      },
      {
        type: "PROGRESS",
        runId: "run-1",
        generation: 0,
        level: 0,
        status: "running",
        completedGenomes: 4,
        totalGenomes: 8,
        completedEpisodes: 8,
        totalEpisodes: 16,
        elapsedMilliseconds: 12,
      },
      {
        type: "GENERATION",
        runId: "run-1",
        metric: {
          generation: 0,
          level: 0,
          bestFitness: 2,
          meanFitness: 1,
          championSurvivalRate: 0.5,
          medianSurvivalRate: 0.25,
          durationMilliseconds: 15,
          curriculumAdvanced: false,
        },
      },
      {
        type: "LEVEL",
        runId: "run-1",
        generation: 5,
        previousLevel: 0,
        level: 1,
      },
      { type: "CHECKPOINT", runId: "run-1", checkpoint },
      {
        type: "ERROR",
        code: "INVALID_STATE",
        message: "Not initialized.",
        recoverable: true,
      },
    ];

    events.forEach((event) => expect(isTrainerEvent(event)).toBe(true));
  });

  it("rejects unknown, malformed, and extended events", () => {
    expect(isTrainerEvent(null)).toBe(false);
    expect(isTrainerEvent({ type: "SNAPSHOT" })).toBe(false);
    expect(
      isTrainerEvent({
        type: "ERROR",
        code: "OTHER",
        message: "failed",
        recoverable: false,
      }),
    ).toBe(false);
    expect(
      isTrainerEvent({
        type: "ERROR",
        code: "INVALID_STATE",
        message: "failed",
        recoverable: true,
        extra: true,
      }),
    ).toBe(false);
    expect(
      isTrainerEvent({
        type: "CHECKPOINT",
        runId: "different-run",
        checkpoint: makeCheckpoint(),
      }),
    ).toBe(false);
  });

  it("rejects progress counts that cannot describe completed genomes", () => {
    const progress = {
      type: "PROGRESS",
      runId: "run-1",
      generation: 0,
      level: 0,
      status: "running",
      completedGenomes: 4,
      totalGenomes: 8,
      completedEpisodes: 8,
      totalEpisodes: 16,
      elapsedMilliseconds: 12,
    } as const;

    expect(
      isTrainerEvent({ ...progress, completedGenomes: 9, completedEpisodes: 18 }),
    ).toBe(false);
    expect(isTrainerEvent({ ...progress, totalEpisodes: 17 })).toBe(false);
    expect(isTrainerEvent({ ...progress, completedEpisodes: 7 })).toBe(false);
  });
});
