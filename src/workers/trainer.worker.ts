import {
  TRAINER_PROTOCOL_VERSION,
  trainerCommandSchema,
  type TrainerEvent,
} from "./protocol";
import { TrainerEngine } from "./trainerEngine";

interface TrainerWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: TrainerEvent): void;
}

const workerScope = self as unknown as TrainerWorkerScope;
const emit = (event: TrainerEvent) => workerScope.postMessage(event);
const engine = new TrainerEngine({ emit });

workerScope.addEventListener("message", (event) => {
  const command = trainerCommandSchema.safeParse(event.data);
  if (!command.success) {
    emit({
      type: "ERROR",
      code: "INVALID_COMMAND",
      message: `Unsupported trainer protocol v${TRAINER_PROTOCOL_VERSION} command.`,
      recoverable: true,
    });
    return;
  }

  engine.handle(command.data);
});
