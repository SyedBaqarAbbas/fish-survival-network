"use client";

import {
  CircleCheck,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GenerationChart } from "@/components/GenerationChart/GenerationChart";
import {
  LabSettings,
  type LabSettingsValue,
} from "@/components/LabSettings/LabSettings";
import { NeuralGraph } from "@/components/NeuralGraph/NeuralGraph";
import {
  ReplayTank,
  type ReplayTankHandle,
} from "@/components/ReplayTank/ReplayTank";
import { DEFAULT_EVOLUTION_CONFIG, type EvolutionConfig } from "@/evolution";
import type { GenerationMetric } from "@/persistence";
import {
  REPLAY_FISH_COUNT,
  type ReplayActivationEvent,
  type ReplayMappingEvent,
  type ReplaySource,
  type ReplaySpeed,
} from "@/replay";
import { useTrainerWorker } from "@/workers/useTrainerWorker";

import styles from "./EvolutionLab.module.css";
import {
  estimateSimulationRemainingMilliseconds,
  formatSimulationEta,
} from "./simulationPreparation";

type LabMode = "replay" | "train";

interface SelectedFish {
  fishIndex: number;
  genomeId: string;
}

interface SimulationPreparationRequest {
  baselineSourceId?: string;
  generation: number;
  runId: string;
}

const ACTIVATION_INTERVAL_MILLISECONDS = 1_000 / 12;
const PREPARATION_NOTICE_DELAY_MILLISECONDS = 250;
const REPLAY_SPEEDS = [0.5, 1, 2] as const satisfies readonly ReplaySpeed[];

const levelLabels = [
  "bias only",
  "distance",
  "direction",
  "closing speed",
  "vertical walls",
  "full walls",
  "full sense",
] as const;

const statusLabels = {
  error: "Error",
  paused: "Paused",
  ready: "Ready",
  running: "Running",
  starting: "Starting",
  unsupported: "Unavailable",
} as const;

const DEFAULT_LAB_SETTINGS: LabSettingsValue = {
  runSeed: 42,
  populationSize: 256,
  episodesPerGenome: 8,
  mutationProbability: DEFAULT_EVOLUTION_CONFIG.mutationProbability,
  mutationStandardDeviation:
    DEFAULT_EVOLUTION_CONFIG.mutationStandardDeviation,
  automaticCurriculum: true,
  manualLevel: 0,
  reducedEffects: false,
};

function supportedPopulation(value: number): 64 | 128 | 256 {
  return value === 64 || value === 128 || value === 256 ? value : 256;
}

function supportedEpisodes(value: number): 4 | 8 {
  return value === 4 || value === 8 ? value : 8;
}

function formatMetric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined
    ? "-"
    : `${value.toFixed(1)}${suffix}`;
}

function useThrottledActivation() {
  const [activation, setActivation] =
    useState<ReplayActivationEvent | undefined>(undefined);
  const pendingRef = useRef<ReplayActivationEvent | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPublishedAtRef = useRef(0);

  const publish = useCallback((event: Readonly<ReplayActivationEvent>) => {
    pendingRef.current = event;
    if (timerRef.current !== undefined) return;

    const elapsed = performance.now() - lastPublishedAtRef.current;
    const delay = Math.max(0, ACTIVATION_INTERVAL_MILLISECONDS - elapsed);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      const pending = pendingRef.current;
      pendingRef.current = undefined;
      if (!pending) return;
      lastPublishedAtRef.current = performance.now();
      setActivation(pending);
    }, delay);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    pendingRef.current = undefined;
    lastPublishedAtRef.current = 0;
    setActivation(undefined);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    },
    [],
  );

  return { activation, clear, publish };
}

interface ReplaceRunDialogProps {
  generation: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function ReplaceRunDialog({
  generation,
  onCancel,
  onConfirm,
}: ReplaceRunDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not([disabled])",
      );
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [onCancel]);

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby="replace-run-detail"
        aria-labelledby="replace-run-title"
        aria-modal="true"
        className={styles.confirmDialog}
        ref={dialogRef}
        role="alertdialog"
      >
        <TriangleAlert aria-hidden="true" className={styles.dialogIcon} size={22} />
        <div>
          <h2 id="replace-run-title">Replace local run?</h2>
          <p id="replace-run-detail">
            Generation {generation} and its saved checkpoint will be cleared.
          </p>
        </div>
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Keep run
          </button>
          <button
            className={styles.dangerButton}
            onClick={onConfirm}
            type="button"
          >
            Replace run
          </button>
        </div>
      </div>
    </div>
  );
}

interface SimulationPreparationNoticeProps {
  completedEpisodes: number;
  completedGenomes: number;
  eta: string;
  generation: number;
  onDismiss: () => void;
  onReplay: () => void;
  paused: boolean;
  ready: boolean;
  totalEpisodes: number;
  totalGenomes: number;
}

function SimulationPreparationNotice({
  completedEpisodes,
  completedGenomes,
  eta,
  generation,
  onDismiss,
  onReplay,
  paused,
  ready,
  totalEpisodes,
  totalGenomes,
}: SimulationPreparationNoticeProps) {
  return (
    <aside
      aria-label="Simulation preparation"
      className={styles.preparationNotice}
      data-state={ready ? "ready" : paused ? "paused" : "preparing"}
    >
      <header className={styles.preparationHeader}>
        {ready ? (
          <CircleCheck aria-hidden="true" className={styles.preparationReadyIcon} size={20} />
        ) : (
          <LoaderCircle aria-hidden="true" className={styles.preparationSpinner} size={20} />
        )}
        <div>
          <small>{ready ? "Latest trained generation" : `Generation ${generation}`}</small>
          <strong aria-atomic="true" aria-live="polite" role="status">
            {ready ? "Simulation ready" : paused ? "Creation paused" : "Creating simulation"}
          </strong>
        </div>
        <button
          aria-label="Dismiss simulation status"
          className={styles.preparationDismiss}
          onClick={onDismiss}
          title="Dismiss simulation status"
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>

      {ready ? (
        <button className={styles.preparationReplay} onClick={onReplay} type="button">
          <Play aria-hidden="true" size={16} />
          Replay now
        </button>
      ) : (
        <div className={styles.preparationProgress}>
          <div>
            <span>{completedGenomes} / {totalGenomes} genomes</span>
            <span>
              {paused ? (
                "Resume to update ETA"
              ) : (
                <>ETA <strong>{eta === "Estimating" ? eta : `About ${eta}`}</strong></>
              )}
            </span>
          </div>
          <progress
            aria-label="Simulation creation progress"
            max={Math.max(1, totalGenomes)}
            value={completedGenomes}
          />
          <small>{completedEpisodes} / {totalEpisodes} episodes</small>
        </div>
      )}
    </aside>
  );
}

export interface EvolutionLabProps {
  starterMetricHistory: readonly Readonly<GenerationMetric>[];
  starterReplaySource: ReplaySource;
}

export function EvolutionLab({
  starterMetricHistory,
  starterReplaySource,
}: EvolutionLabProps) {
  const worker = useTrainerWorker();
  const tankRef = useRef<ReplayTankHandle>(null);
  const requestedReplaySource = worker.replaySource ?? starterReplaySource;
  const requestedReplaySourceRef = useRef(requestedReplaySource);
  const mappingRef = useRef<ReplayMappingEvent | undefined>(undefined);
  const selectionRef = useRef<SelectedFish | undefined>(undefined);
  const { activation, clear: clearActivation, publish: publishActivation } =
    useThrottledActivation();

  const [mode, setMode] = useState<LabMode>("replay");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [replayReady, setReplayReady] = useState(
    worker.status !== "starting",
  );
  if (!replayReady && worker.status !== "starting") setReplayReady(true);
  const [aliveCount, setAliveCount] = useState<number>(REPLAY_FISH_COUNT);
  const [activeReplaySource, setActiveReplaySource] =
    useState(starterReplaySource);
  const [mapping, setMapping] = useState<ReplayMappingEvent | undefined>();
  const [selection, setSelection] = useState<SelectedFish | undefined>();
  const [replayError, setReplayError] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reducedEffects, setReducedEffects] = useState(false);
  const [runSettingsOverride, setRunSettingsOverride] =
    useState<LabSettingsValue | undefined>();
  const [pendingReplacement, setPendingReplacement] =
    useState<LabSettingsValue | undefined>();
  const [simulationPreparation, setSimulationPreparation] =
    useState<SimulationPreparationRequest | undefined>();
  const [preparationNoticeVisible, setPreparationNoticeVisible] =
    useState(false);
  const cancelPendingReplacement = useCallback(
    () => setPendingReplacement(undefined),
    [],
  );

  useEffect(() => {
    requestedReplaySourceRef.current = requestedReplaySource;
  }, [requestedReplaySource]);

  useEffect(() => {
    if (!simulationPreparation) return;
    const timer = setTimeout(
      () => setPreparationNoticeVisible(true),
      PREPARATION_NOTICE_DELAY_MILLISECONDS,
    );
    return () => clearTimeout(timer);
  }, [simulationPreparation]);

  const handleMapping = useCallback(
    (event: Readonly<ReplayMappingEvent>) => {
      const ownedEvent: ReplayMappingEvent = {
        ...event,
        world: { ...event.world },
        entries: event.entries.map((entry) => ({ ...entry })),
      };
      const requested = requestedReplaySourceRef.current;
      if (requested.sourceId === event.sourceId) {
        setActiveReplaySource(requested);
        setSimulationPreparation((current) =>
          current &&
          event.runId === current.runId &&
          event.generation >= current.generation &&
          event.sourceId !== current.baselineSourceId
            ? undefined
            : current,
        );
      }

      const championIndex = event.entries.findIndex(
        (entry) => entry.genomeId === event.championGenomeId,
      );
      const previousMapping = mappingRef.current;
      const previousSelection = selectionRef.current;
      const preservedIndex = previousSelection
        && previousMapping?.sourceId === event.sourceId
        ? event.entries.findIndex(
            (entry) => entry.genomeId === previousSelection.genomeId,
          )
        : -1;
      const fishIndex =
        preservedIndex >= 0 ? preservedIndex : championIndex >= 0 ? championIndex : 0;
      const selected = {
        fishIndex,
        genomeId: event.entries[fishIndex].genomeId,
      };
      mappingRef.current = ownedEvent;
      selectionRef.current = selected;
      setMapping(ownedEvent);
      setSelection(selected);
      setAliveCount(REPLAY_FISH_COUNT);
      setReplayError(undefined);
      clearActivation();
      tankRef.current?.select(fishIndex);
    },
    [clearActivation],
  );

  const handleSelectionChange = useCallback(
    (fishIndex: number, genomeId: string) => {
      const currentMapping = mappingRef.current;
      if (currentMapping?.entries[fishIndex]?.genomeId !== genomeId) return;
      const selected = { fishIndex, genomeId };
      selectionRef.current = selected;
      setSelection(selected);
      clearActivation();
    },
    [clearActivation],
  );

  const handleActivation = useCallback(
    (event: Readonly<ReplayActivationEvent>) => {
      const currentMapping = mappingRef.current;
      const selected = selectionRef.current;
      if (
        !currentMapping ||
        !selected ||
        event.episodeId !== currentMapping.episodeId ||
        event.fishIndex !== selected.fishIndex ||
        event.genomeId !== selected.genomeId ||
        currentMapping.entries[event.fishIndex]?.genomeId !== event.genomeId
      ) {
        return;
      }
      publishActivation(event);
    },
    [publishActivation],
  );

  const selectFish = useCallback(
    (fishIndex: number) => {
      const currentMapping = mappingRef.current;
      const entry = currentMapping?.entries[fishIndex];
      if (!entry) return;
      const selected = { fishIndex, genomeId: entry.genomeId };
      selectionRef.current = selected;
      setSelection(selected);
      clearActivation();
      tankRef.current?.select(fishIndex);
    },
    [clearActivation],
  );

  const selectedGenome = useMemo(() => {
    const selectedId = selection?.genomeId;
    return (
      activeReplaySource.entries.find(
        (entry) => entry.genome.id === selectedId,
      )?.genome ?? activeReplaySource.entries[0].genome
    );
  }, [activeReplaySource, selection?.genomeId]);

  const activeGeneration = mapping?.generation ?? activeReplaySource.generation;
  const activeLevel = mapping?.level ?? activeReplaySource.level;
  const bundledSource =
    activeReplaySource.sourceId === starterReplaySource.sourceId;
  const activeHistory = bundledSource
    ? starterMetricHistory
    : worker.metricHistory;
  const activeMetric = activeHistory.find(
    (metric) => metric.generation === activeGeneration,
  );
  const mappedEntries = mapping?.entries;
  const bestFitness =
    activeMetric?.bestFitness ??
    mappedEntries?.reduce<number | undefined>(
      (best, entry) =>
        entry.fitness === null
          ? best
          : best === undefined
            ? entry.fitness
            : Math.max(best, entry.fitness),
      undefined,
    );
  const championEntry = mappedEntries?.find(
    (entry) => entry.genomeId === mapping?.championGenomeId,
  );
  const survivalRate =
    activeMetric?.championSurvivalRate ?? championEntry?.survivalRate;
  const chartMetrics =
    mode === "train"
      ? worker.metricHistory
      : activeHistory.filter((metric) => metric.generation <= activeGeneration);
  const sourceLabel = bundledSource ? "Bundled" : "Local";
  const hasExistingLocalRun =
    Boolean(worker.replaySource) ||
    worker.restoredFromCheckpoint ||
    (worker.generation ?? 0) > 0 ||
    worker.status === "running" ||
    (worker.progress?.completedGenomes ?? 0) > 0;
  const trainerDisabled =
    worker.status === "starting" ||
    worker.status === "unsupported" ||
    worker.status === "error";
  const trainerRunning = worker.status === "running";
  const progressMaximum =
    worker.progress?.totalGenomes ?? worker.evolutionConfig?.populationSize ?? 1;
  const progressValue = worker.progress?.completedGenomes ?? 0;
  const workerConfig: Readonly<EvolutionConfig> =
    worker.evolutionConfig ?? DEFAULT_EVOLUTION_CONFIG;
  const preparationProgress =
    simulationPreparation &&
    worker.progress?.generation === simulationPreparation.generation
      ? worker.progress
      : undefined;
  const preparedReplaySource =
    simulationPreparation &&
    worker.replaySource &&
    worker.replaySource.runId === simulationPreparation.runId &&
    worker.replaySource.generation >= simulationPreparation.generation &&
    worker.replaySource.sourceId !== simulationPreparation.baselineSourceId
      ? worker.replaySource
      : undefined;
  const preparationTotalGenomes =
    preparationProgress?.totalGenomes ?? workerConfig.populationSize;
  const preparationCompletedGenomes =
    preparationProgress?.completedGenomes ?? 0;
  const preparationTotalEpisodes =
    preparationProgress?.totalEpisodes ??
    preparationTotalGenomes * workerConfig.episodesPerGenome;
  const preparationCompletedEpisodes =
    preparationProgress?.completedEpisodes ?? 0;
  const previousGenerationDuration = simulationPreparation
    ? worker.metricHistory.find(
        (metric) => metric.generation === simulationPreparation.generation - 1,
      )?.durationMilliseconds
    : undefined;
  const preparationEta = formatSimulationEta(
    estimateSimulationRemainingMilliseconds({
      completedGenomes: preparationCompletedGenomes,
      elapsedMilliseconds: preparationProgress?.elapsedMilliseconds ?? 0,
      previousDurationMilliseconds: previousGenerationDuration,
      totalGenomes: preparationTotalGenomes,
    }),
  );
  const settings = {
    ...(runSettingsOverride ?? {
      ...DEFAULT_LAB_SETTINGS,
      runSeed: worker.runSeed ?? DEFAULT_LAB_SETTINGS.runSeed,
      populationSize: supportedPopulation(workerConfig.populationSize),
      episodesPerGenome: supportedEpisodes(workerConfig.episodesPerGenome),
      mutationProbability: workerConfig.mutationProbability,
      mutationStandardDeviation: workerConfig.mutationStandardDeviation,
      automaticCurriculum: workerConfig.automaticCurriculum ?? true,
      manualLevel: worker.level ?? DEFAULT_LAB_SETTINGS.manualLevel,
    }),
    reducedEffects,
  } satisfies LabSettingsValue;

  function settingsConfig(value: Readonly<LabSettingsValue>): EvolutionConfig {
    return {
      ...(worker.evolutionConfig ?? DEFAULT_EVOLUTION_CONFIG),
      populationSize: value.populationSize,
      episodesPerGenome: value.episodesPerGenome,
      mutationProbability: value.mutationProbability,
      mutationStandardDeviation: value.mutationStandardDeviation,
      automaticCurriculum: value.automaticCurriculum,
    };
  }

  function runSettingsChanged(value: Readonly<LabSettingsValue>) {
    const config: Readonly<EvolutionConfig> =
      worker.evolutionConfig ?? DEFAULT_EVOLUTION_CONFIG;
    return (
      value.runSeed !== (worker.runSeed ?? DEFAULT_LAB_SETTINGS.runSeed) ||
      value.populationSize !== config.populationSize ||
      value.episodesPerGenome !== config.episodesPerGenome ||
      value.mutationProbability !== config.mutationProbability ||
      value.mutationStandardDeviation !== config.mutationStandardDeviation ||
      value.automaticCurriculum !== (config.automaticCurriculum ?? true) ||
      (!value.automaticCurriculum && value.manualLevel !== (worker.level ?? 0))
    );
  }

  function dismissSimulationPreparation() {
    setSimulationPreparation(undefined);
    setPreparationNoticeVisible(false);
  }

  function handleTrainingCommand() {
    if (trainerRunning) {
      worker.pause();
      return;
    }
    if (simulationPreparation && worker.status === "ready") return;
    if (worker.runId) {
      setPreparationNoticeVisible(false);
      setSimulationPreparation({
        baselineSourceId: worker.replaySource?.sourceId,
        generation: worker.progress?.generation ?? worker.generation ?? 0,
        runId: worker.runId,
      });
    }
    worker.start();
  }

  function replayPreparedSimulation() {
    if (!preparedReplaySource) return;
    dismissSimulationPreparation();
    setMode("replay");
    setPlaying(true);
    tankRef.current?.restart();
  }

  function replaceLocalRun(value: LabSettingsValue) {
    dismissSimulationPreparation();
    setReducedEffects(value.reducedEffects);
    setRunSettingsOverride(value);
    setSettingsOpen(false);
    setPendingReplacement(undefined);
    worker.pause();
    worker.reset({
      runSeed: value.runSeed,
      evolutionConfig: settingsConfig(value),
      manualLevel: value.automaticCurriculum ? undefined : value.manualLevel,
    });
    setMode("train");
  }

  function applySettings(value: LabSettingsValue) {
    setSettingsOpen(false);
    if (!runSettingsChanged(value)) {
      setReducedEffects(value.reducedEffects);
      return;
    }
    if (hasExistingLocalRun) {
      setReducedEffects(value.reducedEffects);
      setPendingReplacement(value);
      return;
    }
    replaceLocalRun(value);
  }

  function requestReset() {
    if (hasExistingLocalRun) {
      setPendingReplacement(settings);
    } else {
      replaceLocalRun(settings);
    }
  }

  function switchModeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode: LabMode = mode === "replay" ? "train" : "replay";
    setMode(nextMode);
    document.getElementById(`${nextMode}-tab`)?.focus();
  }

  return (
    <main
      className={styles.page}
      data-reduced-effects={String(settings.reducedEffects)}
      data-testid="evolution-lab"
    >
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.eyebrow}>reelgorithm / neuroevolution lab</p>
          <h1>Fish Survival Network</h1>
        </div>
        <div className={styles.headerTools}>
          <div
            aria-live="polite"
            className={styles.workerStatus}
            data-state={worker.status}
            data-testid="worker-status"
          >
            <span aria-hidden="true" className={styles.statusDot} />
            <span>
              <small>Trainer</small>
              <strong>{statusLabels[worker.status]}</strong>
            </span>
          </div>
          <button
            aria-label="Open settings"
            className={styles.iconButton}
            disabled={worker.status === "starting"}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            type="button"
          >
            <Settings2 aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {worker.warning ? (
        <div className={styles.warning} role="alert">
          <TriangleAlert aria-hidden="true" size={17} />
          <span>
            <strong>Persistence warning</strong>
            {worker.warning.message}
            {worker.persistenceBackend === "memory"
              ? " Training remains available for this session."
              : ""}
          </span>
        </div>
      ) : null}
      {worker.error && worker.status === "error" ? (
        <div className={styles.warning} role="alert">
          <TriangleAlert aria-hidden="true" size={17} />
          <span><strong>Training unavailable</strong>{worker.error}</span>
        </div>
      ) : null}
      {replayError ? (
        <div className={styles.warning} role="alert">
          <TriangleAlert aria-hidden="true" size={17} />
          <span><strong>Replay warning</strong>{replayError}</span>
        </div>
      ) : null}

      <div
        aria-label="Lab mode"
        className={styles.tabs}
        onKeyDown={switchModeFromKeyboard}
        role="tablist"
      >
        {(["replay", "train"] as const).map((tab) => (
          <button
            aria-controls="lab-panel"
            aria-selected={mode === tab}
            className={styles.tab}
            id={`${tab}-tab`}
            key={tab}
            onClick={() => setMode(tab)}
            role="tab"
            tabIndex={mode === tab ? 0 : -1}
            type="button"
          >
            {tab === "replay" ? "Replay" : "Train"}
          </button>
        ))}
      </div>

      <div aria-labelledby={`${mode}-tab`} id="lab-panel" role="tabpanel">
        <section aria-labelledby="network-heading" className={styles.networkPanel}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Selected policy</p>
              <h2 id="network-heading">Neural graph</h2>
            </div>
            <label className={styles.fishPicker}>
              <span>Inspect fish</span>
              <select
                disabled={!mapping}
                onChange={(event) => selectFish(Number(event.currentTarget.value))}
                title={selection?.genomeId}
                value={selection?.fishIndex ?? 0}
              >
                {(mapping?.entries ?? []).map((entry) => (
                  <option key={entry.genomeId} value={entry.fishIndex}>
                    Fish {String(entry.fishIndex + 1).padStart(2, "0")}
                    {entry.genomeId === mapping?.championGenomeId ? " / champion" : ""}
                  </option>
                ))}
              </select>
            </label>
          </header>
          <div className={styles.selectionStatus} aria-live="polite">
            <span title={selection?.genomeId}>{selection?.genomeId ?? "Mapping fish"}</span>
            <span>{activation ? (activation.alive ? "alive" : "caught") : "tracking"}</span>
            <span>fitness {formatMetric(activation?.fitness)}</span>
            <span>
              survival {formatMetric(
                activation?.survivalRate === null || activation?.survivalRate === undefined
                  ? undefined
                  : activation.survivalRate * 100,
                "%",
              )}
            </span>
          </div>
          <NeuralGraph
            activation={activation}
            genome={selectedGenome}
            level={activeLevel}
            reducedEffects={settings.reducedEffects}
          />
        </section>

        <div className={styles.levelBand}>
          <span>Level</span>
          <strong>{activeLevel} / 6</strong>
          <span>{levelLabels[activeLevel]}</span>
        </div>

        <section aria-labelledby="tank-heading" className={styles.tank}>
          <header className={styles.tankHeader}>
            <div>
              <h2 id="tank-heading">{sourceLabel} replay</h2>
              <span title={activeReplaySource.sourceId}>generation {activeGeneration}</span>
            </div>
            <span><strong>{aliveCount}</strong> / {REPLAY_FISH_COUNT} fish left</span>
          </header>
          <ReplayTank
            enabled={replayReady}
            effectsEnabled={!settings.reducedEffects}
            onActivation={handleActivation}
            onAliveCountChange={setAliveCount}
            onError={(error) => setReplayError(error.message)}
            onMapping={handleMapping}
            onSelectionChange={handleSelectionChange}
            playing={playing}
            ref={tankRef}
            source={requestedReplaySource}
            speed={speed}
          />
        </section>

        <section aria-label="Replay metrics" className={styles.metrics}>
          <div className={styles.sourceMetric}>
            <span>Source</span>
            <strong title={activeReplaySource.sourceId}>{sourceLabel}</strong>
          </div>
          <div><span>Generation</span><strong>{activeGeneration}</strong></div>
          <div><span>Alive</span><strong>{aliveCount} / {REPLAY_FISH_COUNT}</strong></div>
          <div><span>Best</span><strong>{formatMetric(bestFitness)}</strong></div>
          <div><span>Mean</span><strong>{formatMetric(activeMetric?.meanFitness)}</strong></div>
          <div>
            <span>Survival</span>
            <strong>{formatMetric(
              survivalRate === null || survivalRate === undefined
                ? undefined
                : survivalRate * 100,
              "%",
            )}</strong>
          </div>
          <div><span>Level</span><strong>{activeLevel} / 6</strong></div>
        </section>

        {mode === "replay" ? (
          <section aria-label="Replay controls" className={styles.controlBar}>
            <div className={styles.controlGroup}>
              <button
                aria-label={playing ? "Pause replay" : "Play replay"}
                className={styles.iconButton}
                onClick={() => setPlaying((current) => !current)}
                title={playing ? "Pause replay" : "Play replay"}
                type="button"
              >
                {playing ? (
                  <Pause aria-hidden="true" size={19} />
                ) : (
                  <Play aria-hidden="true" size={19} />
                )}
              </button>
              <button
                aria-label="Restart replay"
                className={styles.iconButton}
                onClick={() => tankRef.current?.restart()}
                title="Restart replay"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={18} />
              </button>
            </div>
            <div aria-label="Replay speed" className={styles.speedControl} role="group">
              {REPLAY_SPEEDS.map((value) => (
                <button
                  aria-pressed={speed === value}
                  key={value}
                  onClick={() => setSpeed(value)}
                  type="button"
                >
                  {value}x
                </button>
              ))}
            </div>
            <span className={styles.controlStatus}>{playing ? "Playing" : "Paused"}</span>
          </section>
        ) : (
          <section aria-label="Training controls" className={styles.trainingBar}>
            <div className={styles.trainingCommands}>
              <button
                className={styles.primaryCommand}
                disabled={
                  trainerDisabled ||
                  Boolean(simulationPreparation && worker.status === "ready")
                }
                onClick={handleTrainingCommand}
                type="button"
              >
                {trainerRunning ? (
                  <Pause aria-hidden="true" size={18} />
                ) : (
                  <Play aria-hidden="true" size={18} />
                )}
                {trainerRunning
                  ? "Pause training"
                  : worker.restoredFromCheckpoint
                    ? "Resume training"
                    : "Start training"}
              </button>
              <button
                aria-label="Reset training run"
                className={styles.iconButton}
                disabled={trainerDisabled}
                onClick={requestReset}
                title="Reset training run"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={18} />
              </button>
            </div>
            <div className={styles.trainingProgress}>
              <div>
                <span>Generation {worker.generation ?? 0}</span>
                <span>
                  {progressValue} / {progressMaximum} genomes
                </span>
              </div>
              <progress
                aria-label="Training generation progress"
                max={Math.max(1, progressMaximum)}
                value={progressValue}
              />
              <small>
                {worker.progress
                  ? `${worker.progress.completedEpisodes} / ${worker.progress.totalEpisodes} episodes`
                  : `${statusLabels[worker.status]} / level ${worker.level ?? 0}`}
              </small>
            </div>
          </section>
        )}

        <section aria-labelledby="history-heading" className={styles.historyPanel}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>{mode === "train" ? "Local run" : sourceLabel}</p>
              <h2 id="history-heading">Generation history</h2>
            </div>
            <span className={styles.historyCount}>{chartMetrics.length} generations</span>
          </header>
          <GenerationChart metrics={chartMetrics} />
        </section>
      </div>

      {simulationPreparation &&
      (preparationNoticeVisible || preparedReplaySource) &&
      !settingsOpen &&
      !pendingReplacement &&
      worker.status !== "error" &&
      worker.status !== "unsupported" ? (
        <SimulationPreparationNotice
          completedEpisodes={preparationCompletedEpisodes}
          completedGenomes={preparationCompletedGenomes}
          eta={preparationEta}
          generation={
            preparedReplaySource?.generation ?? simulationPreparation.generation
          }
          onDismiss={dismissSimulationPreparation}
          onReplay={replayPreparedSimulation}
          paused={worker.status === "paused"}
          ready={Boolean(preparedReplaySource)}
          totalEpisodes={preparationTotalEpisodes}
          totalGenomes={preparationTotalGenomes}
        />
      ) : null}

      <LabSettings
        onApply={applySettings}
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        value={settings}
      />
      {pendingReplacement ? (
        <ReplaceRunDialog
          generation={worker.generation ?? 0}
          onCancel={cancelPendingReplacement}
          onConfirm={() => replaceLocalRun(pendingReplacement)}
        />
      ) : null}
    </main>
  );
}
