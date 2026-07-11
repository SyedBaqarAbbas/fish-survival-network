"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createCheckpointRepository } from "@/persistence";

import {
  TrainerClient,
  type TrainerClientState,
  type TrainerClientStatus,
} from "./trainerClient";

export type TrainerWorkerStatus = TrainerClientStatus | "unsupported";

export interface TrainerWorkerState extends Omit<TrainerClientState, "status"> {
  status: TrainerWorkerStatus;
  start: () => void;
  pause: () => void;
  reset: () => void;
  setCurriculum: TrainerClient["setCurriculum"];
  requestCheckpoint: () => void;
}

const DEFAULT_RUN_ID = "local-active-run";
const DEFAULT_RUN_SEED = 42;

const INITIAL_STATE: TrainerClientState = {
  status: "starting",
  recovered: false,
};

export function useTrainerWorker(): TrainerWorkerState {
  const clientRef = useRef<TrainerClient>(null);
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
  const reset = useCallback(() => clientRef.current?.reset(), []);
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
