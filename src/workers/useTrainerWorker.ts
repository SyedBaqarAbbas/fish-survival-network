"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_EVOLUTION_CONFIG,
  type EvolutionConfig,
} from "@/evolution";
import { createCheckpointRepository } from "@/persistence";
import type { CurriculumLevel } from "@/simulation";

import {
  TrainerClient,
  type TrainerClientState,
  type TrainerClientStatus,
} from "./trainerClient";

export type TrainerWorkerStatus = TrainerClientStatus | "unsupported";

export interface TrainerWorkerResetOptions {
  runSeed?: number;
  evolutionConfig?: Readonly<EvolutionConfig>;
  manualLevel?: CurriculumLevel;
}

export interface TrainerWorkerState extends Omit<TrainerClientState, "status"> {
  status: TrainerWorkerStatus;
  start: () => void;
  pause: () => void;
  reset: (options?: TrainerWorkerResetOptions) => void;
  setCurriculum: TrainerClient["setCurriculum"];
  requestCheckpoint: () => void;
}

const DEFAULT_RUN_ID = "local-active-run";
const DEFAULT_RUN_SEED = 42;

const INITIAL_STATE: TrainerClientState = {
  status: "starting",
  runId: DEFAULT_RUN_ID,
  runSeed: DEFAULT_RUN_SEED,
  evolutionConfig: Object.freeze({ ...DEFAULT_EVOLUTION_CONFIG }),
  metricHistory: Object.freeze([]),
  recovered: false,
  restoredFromCheckpoint: false,
};

export function useTrainerWorker(): TrainerWorkerState {
  const clientRef = useRef<TrainerClient>(null);
  const pendingManualLevelRef = useRef<CurriculumLevel | undefined>(undefined);
  const [state, setState] = useState<TrainerClientState>(INITIAL_STATE);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      let active = true;
      queueMicrotask(() => {
        if (active) setUnsupported(true);
      });
      return () => {
        active = false;
      };
    }

    const client = new TrainerClient({
      persistence: createCheckpointRepository(),
      runId: DEFAULT_RUN_ID,
      runSeed: DEFAULT_RUN_SEED,
    });
    clientRef.current = client;
    const unsubscribe = client.subscribe((nextState) => {
      setState({ ...nextState });
      const manualLevel = pendingManualLevelRef.current;
      if (nextState.status === "ready" && manualLevel !== undefined) {
        pendingManualLevelRef.current = undefined;
        client.setCurriculum(manualLevel);
      }
    });
    void client.initialize();

    return () => {
      clientRef.current = null;
      unsubscribe();
      client.dispose();
    };
  }, []);

  const start = useCallback(() => clientRef.current?.start(), []);
  const pause = useCallback(() => clientRef.current?.pause(), []);
  const reset = useCallback((options: TrainerWorkerResetOptions = {}) => {
    const client = clientRef.current;
    if (!client) return;
    pendingManualLevelRef.current = options.manualLevel;
    if (
      options.runSeed === undefined &&
      options.evolutionConfig === undefined &&
      options.manualLevel === undefined
    ) {
      client.reset();
      return;
    }
    const current = client.getState();
    client.reset({
      runId: current.runId ?? DEFAULT_RUN_ID,
      runSeed: options.runSeed ?? current.runSeed ?? DEFAULT_RUN_SEED,
      evolutionConfig: options.evolutionConfig ?? current.evolutionConfig,
    });
  }, []);
  const setCurriculum = useCallback(
    (level: Parameters<TrainerClient["setCurriculum"]>[0]) =>
      clientRef.current?.setCurriculum(level),
    [],
  );
  const requestCheckpoint = useCallback(
    () => clientRef.current?.requestCheckpoint(),
    [],
  );

  return {
    ...state,
    status: unsupported ? "unsupported" : state.status,
    start,
    pause,
    reset,
    setCurriculum,
    requestCheckpoint,
  };
}
