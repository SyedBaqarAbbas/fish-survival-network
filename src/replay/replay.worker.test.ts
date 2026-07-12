import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REPLAY_PROTOCOL_VERSION,
  type ReplayEvent,
  type ReplaySnapshotEvent,
} from "./protocol";
import { REPLAY_SNAPSHOT_BYTE_LENGTH } from "./snapshot";
import { createDemoReplaySource } from "./source";

function installWorkerScope() {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  const postMessage = vi.fn();
  const addEventListener = vi.fn(
    (
      type: "message",
      nextListener: (event: MessageEvent<unknown>) => void,
    ) => {
      if (type === "message") listener = nextListener;
    },
  );
  vi.stubGlobal("self", { addEventListener, postMessage });

  return {
    addEventListener,
    postMessage,
    dispatch(data: unknown) {
      if (!listener) throw new Error("Replay worker listener was not installed.");
      listener({ data } as MessageEvent<unknown>);
    },
  };
}

describe("replay worker adapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transfers the canonical shared snapshot buffer", async () => {
    const scope = installWorkerScope();
    await import("./replay.worker");

    scope.dispatch({
      type: "LOAD",
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      source: createDemoReplaySource(),
      replaySeed: 42,
    });

    const calls = scope.postMessage.mock.calls as unknown as Array<
      [event: ReplayEvent, transfer?: Transferable[]]
    >;
    const snapshotCall = calls.find(([event]) => event.type === "SNAPSHOT");
    const snapshot = snapshotCall?.[0];
    if (!snapshot || snapshot.type !== "SNAPSHOT") {
      throw new Error("Replay worker did not emit a snapshot.");
    }

    expect(scope.addEventListener).toHaveBeenCalledOnce();
    expect(snapshot.positions.buffer.byteLength).toBe(REPLAY_SNAPSHOT_BYTE_LENGTH);
    expect(snapshot.positions.buffer).toBe(snapshot.velocities.buffer);
    expect(snapshot.positions.buffer).toBe(snapshot.alive.buffer);
    expect(snapshot.positions.buffer).toBe(snapshot.predator.buffer);
    expect(snapshotCall?.[1]).toEqual([
      (snapshot as ReplaySnapshotEvent).positions.buffer,
    ]);
  });

  it("routes invalid commands to a typed recoverable error", async () => {
    const scope = installWorkerScope();
    await import("./replay.worker");

    scope.dispatch({ type: "PLAY", protocolVersion: 99 });

    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ERROR",
        code: "INVALID_COMMAND",
        recoverable: true,
      }),
    );
  });
});
