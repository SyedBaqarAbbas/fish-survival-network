import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ReplayTank/ReplayTank", () => ({
  ReplayTank: () => <div data-testid="replay-tank" />,
}));

import { EvolutionLab } from "./EvolutionLab";

class ReadyWorkerMock {
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();

  addEventListener(type: string, listener: EventListener) {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
    }
  }

  removeEventListener(type: string, listener: EventListener) {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
    }
  }

  postMessage() {
    queueMicrotask(() => {
      const event = new MessageEvent("message", {
        data: {
          type: "READY",
          protocolVersion: 1,
          checkpointSchemaVersion: 1,
          runId: "test-run",
          generation: 0,
          level: 0,
          status: "paused",
          restored: false,
        },
      });
      this.messageListeners.forEach((listener) => listener(event));
    });
  }

  terminate() {}
}

describe("EvolutionLab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a ready training worker", async () => {
    vi.stubGlobal("Worker", ReadyWorkerMock);

    render(<EvolutionLab />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "data-state",
      "ready",
    );
  });

  it("reports browsers without worker support", async () => {
    vi.stubGlobal("Worker", undefined);

    render(<EvolutionLab />);

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  });

  it("reports a worker that is blocked during construction", async () => {
    class BlockedWorkerMock {
      constructor() {
        throw new Error("Blocked by browser policy.");
      }
    }
    vi.stubGlobal("Worker", BlockedWorkerMock);

    render(<EvolutionLab />);

    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "title",
      "Blocked by browser policy.",
    );
  });
});
