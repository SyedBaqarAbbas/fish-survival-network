"use client";

import { useEffect, useState } from "react";

import { createTrainerWorker } from "./createTrainerWorker";
import {
  isTrainerEvent,
  TRAINER_PROTOCOL_VERSION,
  type TrainerCommand,
} from "./protocol";

export type TrainerWorkerStatus =
  | "starting"
  | "ready"
  | "error"
  | "unsupported";

export interface TrainerWorkerState {
  status: TrainerWorkerStatus;
  error?: string;
}

export function useTrainerWorker(): TrainerWorkerState {
  const [state, setState] = useState<TrainerWorkerState>({
    status: "starting",
  });

  useEffect(() => {
    if (typeof Worker === "undefined") {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setState({
            status: "unsupported",
            error: "Web Workers are unavailable in this browser.",
          });
        }
      });
      return () => {
        active = false;
      };
    }

    let worker: Worker;
    try {
      worker = createTrainerWorker();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The training worker failed to start.";
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setState({ status: "error", error: message });
        }
      });
      return () => {
        active = false;
      };
    }

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isTrainerEvent(event.data)) {
        setState({ status: "error", error: "Invalid trainer response." });
        return;
      }

      if (event.data.type === "ERROR") {
        setState({ status: "error", error: event.data.message });
        return;
      }

      if (event.data.protocolVersion !== TRAINER_PROTOCOL_VERSION) {
        setState({ status: "error", error: "Trainer protocol mismatch." });
        return;
      }

      setState({ status: "ready" });
    };

    const handleError = (event: ErrorEvent) => {
      setState({
        status: "error",
        error: event.message || "The training worker failed to start.",
      });
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    const command: TrainerCommand = {
      type: "INITIALIZE",
      protocolVersion: TRAINER_PROTOCOL_VERSION,
    };
    worker.postMessage(command);

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
    };
  }, []);

  return state;
}
