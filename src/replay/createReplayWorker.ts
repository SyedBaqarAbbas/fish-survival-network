export function createReplayWorker(): Worker {
  return new Worker(new URL("./replay.worker.ts", import.meta.url), {
    name: "fish-survival-replay",
    type: "module",
  });
}
