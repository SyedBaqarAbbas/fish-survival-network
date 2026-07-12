import {
  REPLAY_PROTOCOL_VERSION,
  replayCommandSchema,
  type ReplayEvent,
  type ReplaySnapshotEvent,
} from "./protocol";
import { ReplayEngine } from "./engine";
import { getSnapshotTransferList } from "./snapshot";

interface ReplayWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: ReplayEvent, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as ReplayWorkerScope;
const engine = new ReplayEngine({
  emit: (event) => {
    if (event.type === "SNAPSHOT") {
      workerScope.postMessage(
        event,
        getSnapshotTransferList(event as ReplaySnapshotEvent),
      );
      return;
    }
    workerScope.postMessage(event);
  },
});

workerScope.addEventListener("message", (event) => {
  const command = replayCommandSchema.safeParse(event.data);
  if (!command.success) {
    engine.reportInvalidCommand(
      `Unsupported replay protocol v${REPLAY_PROTOCOL_VERSION} command.`,
    );
    return;
  }
  engine.handle(command.data);
});
