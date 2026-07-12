import { createReplayWorker } from "./createReplayWorker";
import {
  isReplayEvent,
  REPLAY_PROTOCOL_VERSION,
  type ReplayCommand,
  type ReplayErrorEvent,
  type ReplayEvent,
  type ReplaySnapshotEvent,
  type ReplaySpeed,
} from "./protocol";
import { cloneReplaySource, type ReplaySource } from "./source";

export interface ReplayClientOptions {
  workerFactory?: () => Worker;
}

export type ReplayEventListener = (event: Readonly<ReplayEvent>) => void;
export type ReplaySnapshotListener = (
  snapshot: Readonly<ReplaySnapshotEvent>,
) => void;

export class ReplayClient {
  private readonly worker: Worker;
  private readonly eventListeners = new Set<ReplayEventListener>();
  private readonly snapshotListeners = new Set<ReplaySnapshotListener>();
  private disposed = false;
  private lastSequence = 0;
  private latestEpisodeId = 0;

  constructor({ workerFactory = createReplayWorker }: ReplayClientOptions = {}) {
    this.worker = workerFactory();
    this.worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      this.emitClientError(
        "WORKER_FAILED",
        event.message || "The replay worker failed.",
        false,
      );
    });
    this.worker.addEventListener("messageerror", () => {
      this.emitClientError(
        "INVALID_EVENT",
        "The replay worker sent an unreadable response.",
        false,
      );
    });
  }

  subscribe(listener: ReplayEventListener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeSnapshots(listener: ReplaySnapshotListener) {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  load(source: ReplaySource, replaySeed: number) {
    this.post({
      type: "LOAD",
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      source: cloneReplaySource(source),
      replaySeed,
    });
  }

  play() {
    this.post({ type: "PLAY", protocolVersion: REPLAY_PROTOCOL_VERSION });
  }

  pause() {
    this.post({ type: "PAUSE", protocolVersion: REPLAY_PROTOCOL_VERSION });
  }

  restart() {
    this.post({ type: "RESTART", protocolVersion: REPLAY_PROTOCOL_VERSION });
  }

  setSpeed(speed: ReplaySpeed) {
    this.post({ type: "SPEED", protocolVersion: REPLAY_PROTOCOL_VERSION, speed });
  }

  select(fishIndex: number | null) {
    this.post({
      type: "SELECT",
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      fishIndex,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.eventListeners.clear();
    this.snapshotListeners.clear();
  }

  private post(command: ReplayCommand) {
    if (!this.disposed) this.worker.postMessage(command);
  }

  private handleMessage(value: unknown) {
    if (this.disposed) return;
    if (!isReplayEvent(value)) {
      this.emitClientError(
        "INVALID_EVENT",
        "The replay worker sent an invalid response.",
        false,
      );
      return;
    }
    if (value.sequence <= this.lastSequence) return;

    if (value.episodeId !== null) {
      if (value.type === "MAPPING") {
        if (value.episodeId < this.latestEpisodeId) return;
        this.latestEpisodeId = value.episodeId;
      } else if (value.episodeId !== this.latestEpisodeId) {
        return;
      }
    }

    this.lastSequence = value.sequence;
    for (const listener of this.eventListeners) listener(value);
    if (value.type === "SNAPSHOT") {
      for (const listener of this.snapshotListeners) listener(value);
    }
  }

  private emitClientError(
    code: ReplayErrorEvent["code"],
    message: string,
    recoverable: boolean,
  ) {
    if (this.disposed) return;
    this.lastSequence += 1;
    const event: ReplayErrorEvent = {
      type: "ERROR",
      episodeId: this.latestEpisodeId || null,
      sequence: this.lastSequence,
      code,
      message,
      recoverable,
    };
    for (const listener of this.eventListeners) listener(event);
  }
}
