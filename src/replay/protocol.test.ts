import { describe, expect, it } from "vitest";

import { createSimulationState, createSpawnLayout } from "@/simulation";

import {
  isReplayCommand,
  isReplayEvent,
  REPLAY_PROTOCOL_VERSION,
  type ReplayCommand,
} from "./protocol";
import { packSimulationSnapshot } from "./snapshot";
import { createDemoReplaySource } from "./source";

describe("replay protocol", () => {
  it("accepts all strict versioned commands", () => {
    const source = createDemoReplaySource();
    const commands: ReplayCommand[] = [
      {
        type: "LOAD",
        protocolVersion: REPLAY_PROTOCOL_VERSION,
        source,
        replaySeed: 7,
      },
      { type: "PLAY", protocolVersion: REPLAY_PROTOCOL_VERSION },
      { type: "PAUSE", protocolVersion: REPLAY_PROTOCOL_VERSION },
      { type: "RESTART", protocolVersion: REPLAY_PROTOCOL_VERSION },
      { type: "SPEED", protocolVersion: REPLAY_PROTOCOL_VERSION, speed: 0.5 },
      { type: "SPEED", protocolVersion: REPLAY_PROTOCOL_VERSION, speed: 1 },
      { type: "SPEED", protocolVersion: REPLAY_PROTOCOL_VERSION, speed: 2 },
      {
        type: "SELECT",
        protocolVersion: REPLAY_PROTOCOL_VERSION,
        fishIndex: 47,
      },
      {
        type: "SELECT",
        protocolVersion: REPLAY_PROTOCOL_VERSION,
        fishIndex: null,
      },
    ];
    commands.forEach((command) => expect(isReplayCommand(command)).toBe(true));
  });

  it("rejects unknown versions, speeds, fish indices, and extra keys", () => {
    expect(isReplayCommand({ type: "PLAY" })).toBe(false);
    expect(
      isReplayCommand({ type: "PLAY", protocolVersion: 2 }),
    ).toBe(false);
    expect(
      isReplayCommand({
        type: "SPEED",
        protocolVersion: 1,
        speed: 4,
      }),
    ).toBe(false);
    expect(
      isReplayCommand({
        type: "SELECT",
        protocolVersion: 1,
        fishIndex: 48,
      }),
    ).toBe(false);
    expect(
      isReplayCommand({ type: "PAUSE", protocolVersion: 1, extra: true }),
    ).toBe(false);
  });

  it("accepts canonical packed snapshots and rejects unpacked payloads", () => {
    const state = createSimulationState(
      createSpawnLayout({ seed: 4, fishCount: 48 }),
    );
    const snapshot = packSimulationSnapshot(state, 1, 1);
    expect(isReplayEvent(snapshot)).toBe(true);
    expect(
      isReplayEvent({
        ...snapshot,
        positions: new Float32Array(snapshot.positions),
      }),
    ).toBe(false);
    expect(isReplayEvent({ ...snapshot, extra: true })).toBe(false);
  });
});
