import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EVOLUTION_CONFIG } from "@/evolution";
import type { GenerationMetric } from "@/persistence";
import {
  createDemoReplaySource,
  type ReplayActivationEvent,
  type ReplayMappingEvent,
  type ReplaySource,
} from "@/replay";
import type { ReplayTankProps } from "@/components/ReplayTank/ReplayTank";
import type { TrainerWorkerState } from "@/workers/useTrainerWorker";

const { replayHarness, useTrainerWorkerMock } = vi.hoisted(() => ({
  replayHarness: {
    pause: vi.fn(),
    play: vi.fn(),
    props: undefined as unknown,
    restart: vi.fn(),
    select: vi.fn(),
    setEffectsEnabled: vi.fn(),
    setSpeed: vi.fn(),
  },
  useTrainerWorkerMock: vi.fn(),
}));

vi.mock("@/workers/useTrainerWorker", () => ({
  useTrainerWorker: useTrainerWorkerMock,
}));

vi.mock("@/components/ReplayTank/ReplayTank", async () => {
  const React = await import("react");
  return {
    ReplayTank: React.forwardRef(function ReplayTankMock(
      props: ReplayTankProps,
      ref: React.ForwardedRef<unknown>,
    ) {
      replayHarness.props = props;
      React.useImperativeHandle(ref, () => ({
        pause: replayHarness.pause,
        play: replayHarness.play,
        restart: replayHarness.restart,
        select: replayHarness.select,
        setEffectsEnabled: replayHarness.setEffectsEnabled,
        setSpeed: replayHarness.setSpeed,
      }));
      return (
        <div
          data-entry-count={props.source.entries.length}
          data-level={props.source.level}
          data-source-id={props.source.sourceId}
          data-testid="replay-tank"
        />
      );
    }),
  };
});

import { EvolutionLab } from "./EvolutionLab";

function generationMetric(
  generation = 37,
  overrides: Partial<GenerationMetric> = {},
): GenerationMetric {
  return {
    generation,
    level: 6,
    bestFitness: 20,
    meanFitness: 13.1,
    championSurvivalRate: 1,
    medianSurvivalRate: 0.875,
    durationMilliseconds: 10,
    curriculumAdvanced: false,
    ...overrides,
  };
}

function replaySource(seed: number, generation = 37) {
  const source = createDemoReplaySource(seed);
  source.generation = generation;
  source.entries.forEach((entry, index) => {
    entry.fitness = 20 - index / 10;
    entry.survivalRate = index === 0 ? 1 : 0.875;
  });
  return source;
}

function mappingFor(
  source: Readonly<ReplaySource>,
  episodeId = 1,
): ReplayMappingEvent {
  return {
    type: "MAPPING",
    protocolVersion: 1,
    episodeId,
    sequence: 1,
    sourceId: source.sourceId,
    runId: source.runId,
    generation: source.generation,
    level: source.level,
    replaySeed: 42,
    world: { ...source.world },
    championGenomeId: source.championGenomeId,
    entries: source.entries.map((entry, fishIndex) => ({
      fishIndex,
      genomeId: entry.genome.id,
      fitness: entry.fitness,
      survivalRate: entry.survivalRate,
    })),
    selectedFishIndex: null,
    status: "playing",
  };
}

function activationFor(
  source: Readonly<ReplaySource>,
  fishIndex: number,
  overrides: Partial<ReplayActivationEvent> = {},
): ReplayActivationEvent {
  const entry = source.entries[fishIndex];
  return {
    type: "ACTIVATION",
    episodeId: 1,
    sequence: 2,
    simulationTime: 0.5,
    fishIndex,
    genomeId: entry.genome.id,
    alive: true,
    fitness: entry.fitness,
    survivalRate: entry.survivalRate,
    inputs: new Float32Array(11).fill(0.5),
    hidden: new Float32Array(8).fill(0.4),
    outputs: new Float32Array(2).fill(0.3),
    inputToHidden: new Float32Array(entry.genome.inputToHidden),
    hiddenToOutput: new Float32Array(entry.genome.hiddenToOutput),
    ...overrides,
  };
}

function replayProps() {
  return replayHarness.props as ReplayTankProps;
}

function workerState(
  overrides: Partial<TrainerWorkerState> = {},
): TrainerWorkerState {
  return {
    status: "ready",
    runId: "local-active-run",
    runSeed: 42,
    evolutionConfig: DEFAULT_EVOLUTION_CONFIG,
    generation: 0,
    level: 0,
    recovered: false,
    restoredFromCheckpoint: false,
    metricHistory: [],
    persistenceBackend: "indexeddb",
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    setCurriculum: vi.fn(),
    requestCheckpoint: vi.fn(),
    ...overrides,
  };
}

function renderLab(
  starter = replaySource(1),
  history: readonly GenerationMetric[] = [generationMetric(starter.generation)],
) {
  return render(
    <EvolutionLab
      starterMetricHistory={history}
      starterReplaySource={starter}
    />,
  );
}

describe("EvolutionLab", () => {
  beforeEach(() => {
    replayHarness.props = undefined;
    replayHarness.pause.mockReset();
    replayHarness.play.mockReset();
    replayHarness.restart.mockReset();
    replayHarness.select.mockReset();
    replayHarness.setEffectsEnabled.mockReset();
    replayHarness.setSpeed.mockReset();
    useTrainerWorkerMock.mockReset();
    useTrainerWorkerMock.mockReturnValue(workerState());
  });

  it("opens the bundled replay with ready worker and populated metrics", () => {
    const starter = replaySource(101);
    renderLab(starter);

    expect(screen.getByRole("tab", { name: "Replay" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "data-state",
      "ready",
    );
    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-source-id",
      starter.sourceId,
    );
    const metrics = screen.getByLabelText("Replay metrics");
    expect(within(metrics).getByText("Bundled")).toBeInTheDocument();
    expect(within(metrics).getByText("37")).toBeInTheDocument();
    expect(within(metrics).getByText("13.1")).toBeInTheDocument();
  });

  it("shows unsupported and visible worker error states", () => {
    useTrainerWorkerMock.mockReturnValue(workerState({ status: "unsupported" }));
    const first = renderLab(replaySource(2));
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    first.unmount();

    useTrainerWorkerMock.mockReturnValue(
      workerState({ status: "error", error: "Blocked by browser policy." }),
    );
    renderLab(replaySource(3));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Blocked by browser policy.",
    );
  });

  it("gives a restored local replay and history precedence over the starter", () => {
    const local = replaySource(202, 4);
    useTrainerWorkerMock.mockReturnValue(
      workerState({
        replaySource: local,
        generation: 5,
        level: 6,
        restoredFromCheckpoint: true,
        metricHistory: [generationMetric(4)],
      }),
    );

    renderLab(replaySource(201));

    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-source-id",
      local.sourceId,
    );
  });

  it("defers the first replay until checkpoint restoration resolves", () => {
    const starter = replaySource(221);
    const local = replaySource(222, 4);
    useTrainerWorkerMock.mockReturnValue(workerState({ status: "starting" }));
    const view = renderLab(starter);

    expect(replayProps().enabled).toBe(false);
    useTrainerWorkerMock.mockReturnValue(
      workerState({
        status: "ready",
        replaySource: local,
        restoredFromCheckpoint: true,
      }),
    );
    view.rerender(
      <EvolutionLab
        starterMetricHistory={[generationMetric(starter.generation)]}
        starterReplaySource={starter}
      />,
    );

    expect(replayProps().enabled).toBe(true);
    expect(replayProps().source.sourceId).toBe(local.sourceId);
    expect(replayHarness.restart).not.toHaveBeenCalled();

    useTrainerWorkerMock.mockReturnValue(workerState({ status: "starting" }));
    view.rerender(
      <EvolutionLab
        starterMetricHistory={[generationMetric(starter.generation)]}
        starterReplaySource={starter}
      />,
    );
    expect(replayProps().enabled).toBe(true);
  });

  it("queues a newly trained replay without restarting the current episode", () => {
    const starter = replaySource(251);
    const local = replaySource(252, 4);
    const view = renderLab(starter);

    useTrainerWorkerMock.mockReturnValue(
      workerState({
        replaySource: local,
        generation: 5,
        level: 6,
      }),
    );
    view.rerender(
      <EvolutionLab
        starterMetricHistory={[generationMetric(starter.generation)]}
        starterReplaySource={starter}
      />,
    );

    expect(screen.getByTestId("replay-tank")).toHaveAttribute(
      "data-source-id",
      local.sourceId,
    );
    expect(replayHarness.restart).not.toHaveBeenCalled();
  });

  it("keeps mapping, selected genome, and activation identity aligned", async () => {
    const starter = replaySource(301);
    renderLab(starter);
    const mapping = mappingFor(starter);

    act(() => replayProps().onMapping?.(mapping));
    expect(replayHarness.select).toHaveBeenCalledWith(0);
    expect(screen.getByTestId("neural-graph")).toHaveAttribute(
      "data-genome-id",
      starter.entries[0].genome.id,
    );

    const fishIndex = 3;
    act(() =>
      replayProps().onSelectionChange?.(
        fishIndex,
        starter.entries[fishIndex].genome.id,
      ),
    );
    act(() => replayProps().onActivation?.(activationFor(starter, fishIndex)));
    await waitFor(() =>
      expect(screen.getByTestId("neural-graph")).toHaveAttribute(
        "data-has-activation",
        "true",
      ),
    );
    expect(screen.getByTestId("neural-graph")).toHaveAttribute(
      "data-genome-id",
      starter.entries[fishIndex].genome.id,
    );
    expect(screen.getByText("alive", { selector: "span" })).toBeInTheDocument();

    act(() =>
      replayProps().onActivation?.(
        activationFor(starter, fishIndex, {
          episodeId: 99,
          alive: false,
          sequence: 99,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("caught", { selector: "span" })).not.toBeInTheDocument();

    act(() => replayProps().onMapping?.(mappingFor(starter, 2)));
    expect(replayHarness.select).toHaveBeenLastCalledWith(fishIndex);
    expect(screen.getByTestId("neural-graph")).toHaveAttribute(
      "data-genome-id",
      starter.entries[fishIndex].genome.id,
    );

    act(() =>
      replayProps().onMapping?.({
        ...mappingFor(starter, 3),
        sourceId: "unrelated-source-with-colliding-ids",
      }),
    );
    expect(replayHarness.select).toHaveBeenLastCalledWith(0);
  });

  it("wires play, pause, restart, and replay speed controls", async () => {
    const user = userEvent.setup();
    const starter = replaySource(401);
    renderLab(starter);
    act(() => replayProps().onMapping?.(mappingFor(starter)));

    await user.click(screen.getByRole("button", { name: "Pause replay" }));
    expect(replayProps().playing).toBe(false);
    await user.click(screen.getByRole("button", { name: "2x" }));
    expect(replayProps().speed).toBe(2);
    await user.click(screen.getByRole("button", { name: "Restart replay" }));
    expect(replayHarness.restart).toHaveBeenCalledOnce();
  });

  it("caps graph updates at 12 Hz and publishes the latest activation", () => {
    vi.useFakeTimers();
    try {
      const starter = replaySource(451);
      renderLab(starter);
      act(() => replayProps().onMapping?.(mappingFor(starter)));

      act(() => replayProps().onActivation?.(activationFor(starter, 0)));
      act(() => vi.advanceTimersByTime(84));
      expect(screen.getByTestId("neural-graph")).toHaveAttribute(
        "data-activation-sequence",
        "2",
      );

      act(() =>
        replayProps().onActivation?.(
          activationFor(starter, 0, { sequence: 3 }),
        ),
      );
      act(() =>
        replayProps().onActivation?.(
          activationFor(starter, 0, { sequence: 4 }),
        ),
      );
      act(() => vi.advanceTimersByTime(70));
      expect(screen.getByTestId("neural-graph")).toHaveAttribute(
        "data-activation-sequence",
        "2",
      );
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByTestId("neural-graph")).toHaveAttribute(
        "data-activation-sequence",
        "4",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies reduced effects without replacing the local run", async () => {
    const user = userEvent.setup();
    const state = workerState();
    useTrainerWorkerMock.mockReturnValue(state);
    renderLab(replaySource(501));

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(screen.getByRole("switch", { name: "Reduced effects" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByTestId("evolution-lab")).toHaveAttribute(
      "data-reduced-effects",
      "true",
    );
    expect(replayProps().effectsEnabled).toBe(false);
    expect(state.reset).not.toHaveBeenCalled();
  });

  it("keeps reduced effects editable after a configured reset", async () => {
    const user = userEvent.setup();
    const firstState = workerState();
    useTrainerWorkerMock.mockReturnValue(firstState);
    const starter = replaySource(551);
    const view = renderLab(starter);

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    const seed = screen.getByRole("spinbutton", { name: "Run seed" });
    await user.clear(seed);
    await user.type(seed, "99");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(firstState.reset).toHaveBeenCalledWith(
      expect.objectContaining({ runSeed: 99 }),
    );

    useTrainerWorkerMock.mockReturnValue(workerState({ runSeed: 99 }));
    view.rerender(
      <EvolutionLab
        starterMetricHistory={[generationMetric(starter.generation)]}
        starterReplaySource={starter}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.click(screen.getByRole("switch", { name: "Reduced effects" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByTestId("evolution-lab")).toHaveAttribute(
      "data-reduced-effects",
      "true",
    );
    expect(replayProps().effectsEnabled).toBe(false);
  });

  it("resumes a restored run and confirms destructive reset", async () => {
    const user = userEvent.setup();
    const local = replaySource(601, 4);
    const state = workerState({
      replaySource: local,
      generation: 5,
      level: 2,
      restoredFromCheckpoint: true,
      metricHistory: [generationMetric(4, { level: 2 })],
    });
    useTrainerWorkerMock.mockReturnValue(state);
    renderLab(replaySource(602));

    await user.click(screen.getByRole("tab", { name: "Train" }));
    await user.click(screen.getByRole("button", { name: "Resume training" }));
    expect(state.start).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Reset training run" }));
    const dialog = screen.getByRole("alertdialog", { name: "Replace local run?" });
    expect(dialog).toHaveTextContent("Generation 5");
    const keepRun = within(dialog).getByRole("button", { name: "Keep run" });
    const replaceRun = within(dialog).getByRole("button", { name: "Replace run" });
    expect(keepRun).toHaveFocus();
    await user.tab();
    expect(replaceRun).toHaveFocus();
    await user.tab();
    expect(keepRun).toHaveFocus();
    await user.click(keepRun);
    expect(state.reset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reset training run" }));
    await user.click(screen.getByRole("button", { name: "Replace run" }));
    expect(state.pause).toHaveBeenCalled();
    expect(state.reset).toHaveBeenCalledWith(
      expect.objectContaining({ runSeed: 42 }),
    );
  });

  it("confirms reset when generation zero has partial work", async () => {
    const user = userEvent.setup();
    const state = workerState({
      status: "paused",
      progress: {
        generation: 0,
        level: 0,
        completedGenomes: 32,
        totalGenomes: 256,
        completedEpisodes: 256,
        totalEpisodes: 2048,
        elapsedMilliseconds: 200,
      },
    });
    useTrainerWorkerMock.mockReturnValue(state);
    renderLab(replaySource(651));

    await user.click(screen.getByRole("tab", { name: "Train" }));
    await user.click(screen.getByRole("button", { name: "Reset training run" }));

    expect(
      screen.getByRole("alertdialog", { name: "Replace local run?" }),
    ).toBeVisible();
    expect(state.reset).not.toHaveBeenCalled();
  });

  it("renders persistence fallback without disabling training", async () => {
    const user = userEvent.setup();
    const state = workerState({
      persistenceBackend: "memory",
      warning: {
        code: "INDEXED_DB_UNAVAILABLE",
        message: "IndexedDB is blocked.",
      },
    });
    useTrainerWorkerMock.mockReturnValue(state);
    renderLab(replaySource(701));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Training remains available for this session.",
    );
    await user.click(screen.getByRole("tab", { name: "Train" }));
    await user.click(screen.getByRole("button", { name: "Start training" }));
    expect(state.start).toHaveBeenCalledOnce();
  });

  it("switches tabs with arrow keys", async () => {
    const user = userEvent.setup();
    renderLab(replaySource(801));
    const replayTab = screen.getByRole("tab", { name: "Replay" });
    replayTab.focus();

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Train" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Train" })).toHaveFocus();
  });
});
