import type { SimulationState } from "@/simulation";

import type { ReplaySnapshotEvent } from "./protocol";
import { REPLAY_FISH_COUNT } from "./source";

export const REPLAY_SNAPSHOT_BYTE_LENGTH = 832 as const;
export const REPLAY_SNAPSHOT_OFFSETS = Object.freeze({
  positions: 0,
  velocities: 384,
  alive: 768,
  predator: 816,
});

export function packSimulationSnapshot(
  state: Readonly<SimulationState>,
  episodeId: number,
  sequence: number,
): ReplaySnapshotEvent {
  if (state.fish.length !== REPLAY_FISH_COUNT) {
    throw new RangeError(`Replay snapshots require exactly ${REPLAY_FISH_COUNT} fish.`);
  }

  const buffer = new ArrayBuffer(REPLAY_SNAPSHOT_BYTE_LENGTH);
  const positions = new Float32Array(
    buffer,
    REPLAY_SNAPSHOT_OFFSETS.positions,
    REPLAY_FISH_COUNT * 2,
  );
  const velocities = new Float32Array(
    buffer,
    REPLAY_SNAPSHOT_OFFSETS.velocities,
    REPLAY_FISH_COUNT * 2,
  );
  const alive = new Uint8Array(
    buffer,
    REPLAY_SNAPSHOT_OFFSETS.alive,
    REPLAY_FISH_COUNT,
  );
  const predator = new Float32Array(
    buffer,
    REPLAY_SNAPSHOT_OFFSETS.predator,
    4,
  );

  state.fish.forEach((fish, fishIndex) => {
    const offset = fishIndex * 2;
    positions[offset] = fish.x;
    positions[offset + 1] = fish.y;
    velocities[offset] = fish.vx;
    velocities[offset + 1] = fish.vy;
    alive[fishIndex] = fish.alive ? 1 : 0;
  });
  predator[0] = state.predator.x;
  predator[1] = state.predator.y;
  predator[2] = state.predator.vx;
  predator[3] = state.predator.vy;

  return {
    type: "SNAPSHOT",
    episodeId,
    sequence,
    simulationTime: state.elapsedSeconds,
    positions,
    velocities,
    alive,
    predator,
  };
}

export function getSnapshotTransferList(snapshot: ReplaySnapshotEvent) {
  return [snapshot.positions.buffer] as Transferable[];
}
