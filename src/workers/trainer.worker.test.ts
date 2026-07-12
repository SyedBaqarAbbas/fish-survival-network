import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRAINER_PROTOCOL_VERSION, type TrainerEvent } from "./protocol";

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
      if (!listener) throw new Error("Trainer worker listener was not installed.");
      listener({ data } as MessageEvent<unknown>);
    },
  };
}

describe("trainer worker adapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes valid initialization and invalid commands through typed events", async () => {
    const scope = installWorkerScope();
    await import("./trainer.worker");

    scope.dispatch({
      type: "INITIALIZE",
      protocolVersion: TRAINER_PROTOCOL_VERSION,
      runId: "adapter-run",
      runSeed: 42,
    });
    scope.dispatch({ type: "START", protocolVersion: 99 });

    const events = scope.postMessage.mock.calls.map(
      ([event]) => event as TrainerEvent,
    );
    expect(scope.addEventListener).toHaveBeenCalledOnce();
    expect(events[0]).toMatchObject({
      type: "READY",
      runId: "adapter-run",
      restored: false,
    });
    expect(events[1]).toMatchObject({
      type: "ERROR",
      code: "INVALID_COMMAND",
      recoverable: true,
    });
  });
});
