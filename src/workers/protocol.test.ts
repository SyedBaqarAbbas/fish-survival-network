import { describe, expect, it } from "vitest";

import { isTrainerCommand, isTrainerEvent } from "./protocol";

describe("trainer protocol", () => {
  it("accepts only the supported initialization command", () => {
    expect(
      isTrainerCommand({ type: "INITIALIZE", protocolVersion: 1 }),
    ).toBe(true);
    expect(
      isTrainerCommand({ type: "INITIALIZE", protocolVersion: 2 }),
    ).toBe(false);
    expect(isTrainerCommand(null)).toBe(false);
  });

  it("accepts known worker events", () => {
    expect(
      isTrainerEvent({
        type: "READY",
        protocolVersion: 1,
        checkpointSchemaVersion: 1,
      }),
    ).toBe(true);
    expect(isTrainerEvent({ type: "ERROR", message: "failed" })).toBe(true);
  });

  it("rejects unknown messages", () => {
    expect(isTrainerEvent(null)).toBe(false);
    expect(isTrainerEvent({ type: "SNAPSHOT" })).toBe(false);
    expect(isTrainerEvent({ type: "ERROR" })).toBe(false);
    expect(isTrainerEvent({ type: "READY", protocolVersion: 2 })).toBe(false);
  });
});
