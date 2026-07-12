import { describe, expect, it } from "vitest";

import { createSimulationState, createSpawnLayout } from "@/simulation";

import {
  getSnapshotTransferList,
  packSimulationSnapshot,
  REPLAY_SNAPSHOT_BYTE_LENGTH,
  REPLAY_SNAPSHOT_OFFSETS,
} from "./snapshot";

describe("packed replay snapshots", () => {
  it("packs the canonical 48-fish layout into one 832-byte buffer", () => {
    const state = createSimulationState(
      createSpawnLayout({ seed: 42, fishCount: 48 }),
    );
    const snapshot = packSimulationSnapshot(state, 3, 9);

    expect(snapshot.positions).toHaveLength(96);
    expect(snapshot.velocities).toHaveLength(96);
    expect(snapshot.alive).toHaveLength(48);
    expect(snapshot.predator).toHaveLength(4);
    expect(snapshot.positions.buffer.byteLength).toBe(REPLAY_SNAPSHOT_BYTE_LENGTH);
    expect(snapshot.positions.buffer).toBe(snapshot.velocities.buffer);
    expect(snapshot.positions.buffer).toBe(snapshot.alive.buffer);
    expect(snapshot.positions.buffer).toBe(snapshot.predator.buffer);
    expect(snapshot.positions.byteOffset).toBe(REPLAY_SNAPSHOT_OFFSETS.positions);
    expect(snapshot.velocities.byteOffset).toBe(REPLAY_SNAPSHOT_OFFSETS.velocities);
    expect(snapshot.alive.byteOffset).toBe(REPLAY_SNAPSHOT_OFFSETS.alive);
    expect(snapshot.predator.byteOffset).toBe(REPLAY_SNAPSHOT_OFFSETS.predator);
    expect(snapshot.positions[0]).toBeCloseTo(state.fish[0].x, 4);
    expect(snapshot.predator[0]).toBeCloseTo(state.predator.x, 4);
    expect([...snapshot.alive]).toEqual(Array.from({ length: 48 }, () => 1));
  });

  it("transfers one buffer without changing view layout or values", () => {
    const state = createSimulationState(
      createSpawnLayout({ seed: 7, fishCount: 48 }),
    );
    const snapshot = packSimulationSnapshot(state, 1, 1);
    const expectedFirstX = snapshot.positions[0];
    const transfer = getSnapshotTransferList(snapshot);

    expect(transfer).toHaveLength(1);
    const clone = structuredClone(snapshot, { transfer });
    expect(snapshot.positions.buffer.byteLength).toBe(0);
    expect(clone.positions.buffer.byteLength).toBe(REPLAY_SNAPSHOT_BYTE_LENGTH);
    expect(clone.positions.buffer).toBe(clone.velocities.buffer);
    expect(clone.positions[0]).toBe(expectedFirstX);
    expect(clone.predator.byteOffset).toBe(REPLAY_SNAPSHOT_OFFSETS.predator);
  });

  it("rejects simulations that do not contain exactly 48 fish", () => {
    const state = createSimulationState(
      createSpawnLayout({ seed: 42, fishCount: 1 }),
    );
    expect(() => packSimulationSnapshot(state, 1, 1)).toThrow(RangeError);
  });
});
