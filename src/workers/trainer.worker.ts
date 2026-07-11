import { CHECKPOINT_SCHEMA_VERSION } from "@/persistence/types";

import {
  isTrainerCommand,
  TRAINER_PROTOCOL_VERSION,
  type TrainerEvent,
} from "./protocol";

interface TrainerWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: TrainerEvent): void;
}

const workerScope = self as unknown as TrainerWorkerScope;

workerScope.addEventListener("message", (event) => {
  if (!isTrainerCommand(event.data)) {
    workerScope.postMessage({
      type: "ERROR",
      message: "Unsupported trainer protocol.",
    });
    return;
  }

  workerScope.postMessage({
    type: "READY",
    protocolVersion: TRAINER_PROTOCOL_VERSION,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
  });
});
