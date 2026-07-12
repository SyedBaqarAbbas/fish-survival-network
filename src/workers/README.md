# Trainer Worker Subsystem

This folder owns browser training only. It keeps generation evaluation off the
main thread, exposes training state to React, persists coherent checkpoints, and
recovers from worker failures. Replay has its own client, protocol, engine, and
worker under the [replay subsystem](../replay/README.md).

The evolutionary and simulation algorithms remain framework-free in
[`src/evolution`](../evolution/) and [`src/simulation`](../simulation/). This
folder orchestrates those algorithms; it does not define fitness, genetics,
physics, or rendering.

## Data Flow

```text
EvolutionLab
    |
    v
useTrainerWorker -> TrainerClient <-> checkpoint repository
                         |
                         | versioned commands and events
                         v
                  trainer.worker.ts
                         |
                         v
                    TrainerEngine
                         |
                         +-> evaluate genomes in cooperative chunks
                         +-> finalize generation and ranked replay source
                         +-> emit metrics and completed checkpoints
```

`useTrainerWorker()` is the UI-facing boundary. It creates the local active run,
subscribes to `TrainerClient`, and returns state plus `start`, `pause`, `reset`,
`setCurriculum`, and `requestCheckpoint` actions. If Web Workers are unavailable,
the hook reports `unsupported` instead of trying to train on the main thread.

## Training Lifecycle

1. `TrainerClient.initialize()` loads the active checkpoint from persistence
   before it creates the worker.
2. `INITIALIZE` sends either that complete checkpoint or a fresh run ID, unsigned
   run seed, evolution configuration, and optional world configuration.
3. `TrainerEngine` initializes paused and emits `READY`. Restored runs never
   resume automatically.
4. `START` derives the generation's shared episode seeds and schedules work.
5. The default engine evaluates four genomes synchronously, emits `PROGRESS`,
   then yields with `setTimeout(..., 0)` before scheduling the next chunk.
6. `PAUSE` invalidates scheduled work at a chunk boundary but retains the partial
   generation in that live worker. A later `START` resumes it.
7. Once every genome is evaluated, the engine ranks the results, reproduces the
   next population, creates the top-48 replay source when possible, emits
   `GENERATION` and any `LEVEL` change, then emits `CHECKPOINT`.
8. If training remains running, the next scheduled chunk starts the next
   generation.

Chunk size is an injectable engine dependency for tests, but production uses the
default of four. Keep chunks bounded: yielding between them is what lets pause
commands and the rest of the lab stay responsive.

## Progress And ETA

Every `PROGRESS` event reports completed and total genomes, completed and total
episodes, generation, level, worker status, and `elapsedMilliseconds`.
Episode progress is derived from completed genomes, so a partially evaluated
genome is never reported as partial episode progress.

Elapsed time counts active generation work only. Paused time is excluded and
the finalized value becomes the generation metric's `durationMilliseconds`.
The trainer protocol does not calculate or transmit an ETA. The lab estimates
remaining time from active elapsed time and completed genomes; before the first
chunk it can fall back to the previous generation duration. With neither sample,
the UI displays `Estimating`, and while paused it asks the user to resume before
updating the estimate. That presentation logic lives in
[`simulationPreparation.ts`](../components/EvolutionLab/simulationPreparation.ts).

## Checkpoints And Recovery

Partial generation evaluations never enter a checkpoint. The engine retains
`lastCheckpoint`, which is always the latest coherent boundary:

- the initial fresh or restored generation state;
- a finalized, reproduced generation; or
- a manual curriculum change made while paused with no partial generation.

A `CHECKPOINT` request during evaluation returns that last coherent checkpoint,
not the in-progress genomes. Completed generations emit checkpoints
automatically. The client caches each received checkpoint before saving it
asynchronously, updates the decoded replay source and metric history, and writes
the active record through the persistence repository.

On startup, the client restores IndexedDB before initializing the worker. If
IndexedDB is unavailable, training continues with the repository's in-memory
fallback and exposes a warning. On a worker error, unreadable message, invalid
event, or non-recoverable trainer error, the client terminates that worker and
recreates one from its cached or repository last-known-good checkpoint. Recovery
returns paused. A second failure during recovery ends in `error` rather than
looping indefinitely.

See the [checkpoint format](../../docs/checkpoint-format.md) for serialized data,
schema compatibility, and quarantine behavior.

## Reset And Run Replacement

An engine-level `RESET` invalidates queued chunks, discards partial evaluation,
history, metrics, and the replay source, then creates a fresh paused run from the
new ID and seed.

The browser hook uses a stronger replacement boundary. Each reset:

- advances `local-active-run:revision:N` so stale and replacement runs have
  distinct identities;
- clears the active persisted checkpoint;
- terminates the current worker and ignores events carrying its old worker token;
- clears generation progress, metric history, and replay source; and
- initializes a new worker, applying a requested manual curriculum only after
  its `READY` event.

The lab asks for confirmation before invoking this path when a local run already
has progress. Do not reuse the prior run ID or allow old asynchronous events to
patch replacement state.

## Worker Protocol

All messages are strict, Zod-validated protocol-v1 values.

| Command | Effect |
| --- | --- |
| `INITIALIZE` | Restore one checkpoint or create one fresh run, never both. |
| `START` / `PAUSE` | Resume or stop cooperative generation work. |
| `RESET` | Replace engine state with a new run ID and seed. |
| `CURRICULUM` | Change level only while paused with no partial generation. |
| `CHECKPOINT` | Return the last coherent checkpoint. |

| Event | Purpose |
| --- | --- |
| `READY` | Reports protocol/schema versions and restored paused state. |
| `PROGRESS` | Reports chunk-boundary genome, episode, and active-time progress. |
| `GENERATION` | Carries one completed generation metric. |
| `LEVEL` | Reports manual or automatic curriculum changes. |
| `CHECKPOINT` | Carries the resumable completed boundary for persistence. |
| `ERROR` | Carries a typed error and whether client recovery is required. |

Changing a command or event requires coordinated TypeScript types, strict Zod
schemas, engine and client handling, worker tests, and a protocol-version review.

## File Map

| File | Responsibility |
| --- | --- |
| [`useTrainerWorker.ts`](useTrainerWorker.ts) | React lifecycle, unsupported state, and revisioned run replacement. |
| [`trainerClient.ts`](trainerClient.ts) | Worker ownership, observable state, persistence, and crash recovery. |
| [`protocol.ts`](protocol.ts) | Versioned trainer commands, events, and strict validation. |
| [`trainerEngine.ts`](trainerEngine.ts) | Cooperative evaluation, progress, generation finalization, and checkpoints. |
| [`trainer.worker.ts`](trainer.worker.ts) | Worker-scope validation and engine event forwarding. |
| [`createTrainerWorker.ts`](createTrainerWorker.ts) | Webpack-compatible module-worker construction. |
| `*.test.ts` / `*.test.tsx` | Hook, client, protocol, worker, and engine contracts. |

## Changing Training Safely

- Keep evaluation deterministic: one generation uses shared derived episode
  seeds and stable population order.
- Preserve the chunk boundary. Long unbroken loops make pause and UI feedback
  ineffective.
- Never serialize partial evaluations. Resume after a crash from the last
  completed generation, even if that repeats some work.
- Treat `runId` and worker tokens as stale-event barriers during replacement.
- Keep protocol parsing at the worker and client boundaries; do not trust raw
  `postMessage` payloads.
- Update persistence and replay-source tests when checkpoint contents change.
- Change curriculum only at a coherent paused boundary.

Run the focused trainer suite with:

```bash
npm test -- src/workers
```

For checkpoint-boundary changes, also run:

```bash
npm test -- src/persistence
```
