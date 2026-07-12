import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoReplaySource, type ReplaySource } from "@/replay";
import type { TrainerWorkerState } from "@/workers/useTrainerWorker";

const { useTrainerWorkerMock } = vi.hoisted(() => ({
  useTrainerWorkerMock: vi.fn(),
}));

vi.mock("@/workers/useTrainerWorker", () => ({
  useTrainerWorker: useTrainerWorkerMock,
}));

vi.mock("@/components/ReplayTank/ReplayTank", () => ({
  ReplayTank: ({ source }: { source: ReplaySource }) => (
    <div
      data-entry-count={source.entries.length}
      data-level={source.level}
      data-source-id={source.sourceId}
      data-testid="replay-tank"
    />
  ),
}));

import { EvolutionLab } from "./EvolutionLab";

function workerState(
  overrides: Partial<TrainerWorkerState> = {},
): TrainerWorkerState {
  return {
    status: "ready",
    recovered: false,
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    setCurriculum: vi.fn(),
    requestCheckpoint: vi.fn(),
    ...overrides,
  };
}

describe("EvolutionLab", () => {
  beforeEach(() => {
    useTrainerWorkerMock.mockReset();
    useTrainerWorkerMock.mockReturnValue(workerState());
  });

  it("reports a ready training worker", () => {
    render(<EvolutionLab starterReplaySource={createDemoReplaySource(1)} />);

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "data-state",
      "ready",
    );
  });

  it("reports browsers without worker support", () => {
    useTrainerWorkerMock.mockReturnValue(workerState({ status: "unsupported" }));

    render(<EvolutionLab starterReplaySource={createDemoReplaySource(2)} />);

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("reports a worker construction error", () => {
    useTrainerWorkerMock.mockReturnValue(
      workerState({ status: "error", error: "Blocked by browser policy." }),
    );

    render(<EvolutionLab starterReplaySource={createDemoReplaySource(3)} />);

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "title",
      "Blocked by browser policy.",
    );
  });

  it("uses the bundled starter replay until local training has a roster", () => {
    const starter = { ...createDemoReplaySource(101), generation: 37 };
    useTrainerWorkerMock.mockReturnValue(workerState({ generation: 0 }));

    render(<EvolutionLab starterReplaySource={starter} />);

    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-source-id",
      starter.sourceId,
    );
    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-entry-count",
      "48",
    );
    expect(screen.getByText("37")).toBeInTheDocument();
  });

  it("gives a restored local replay roster precedence over the starter", () => {
    const starter = createDemoReplaySource(201);
    const local = createDemoReplaySource(202);
    useTrainerWorkerMock.mockReturnValue(
      workerState({ replaySource: local, generation: 4, level: 6 }),
    );

    render(<EvolutionLab starterReplaySource={starter} />);

    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-source-id",
      local.sourceId,
    );
  });
});
