export function createTrainerWorker(): Worker {
  return new Worker(new URL("./trainer.worker.ts", import.meta.url), {
    name: "fish-survival-trainer",
    type: "module",
  });
}
