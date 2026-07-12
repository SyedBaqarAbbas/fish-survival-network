# Architecture

Fish Survival Network separates deterministic domain logic from browser orchestration and rendering. Simulation and evolution code can run in Node, tests, or Web Workers without importing React, PixiJS, IndexedDB, or other browser APIs.

## Runtime Data Flow

```text
checked-in starter checkpoint
        |
        v
Next.js server validation -- replay roster + metric history --> React lab
                                                              /       \
                                                             v         v
                                                    replay worker   trainer worker
                                                          |              |
                                                packed snapshots   completed checkpoint
                                                          |              |
                                                          v              v
                                                 PixiJS renderer      IndexedDB
```

The server imports and validates the complete starter artifact. The browser receives owned clones of only its 48-fish replay source and generation history; it does not receive the starter population or use the starter as local training state.

On the client, `EvolutionLab` owns semantic UI state and coordinates two independent systems:

- `ReplayClient` owns the replay worker protocol. It validates worker events and exposes snapshots on a dedicated subscription path.
- `TrainerClient` owns the trainer worker lifecycle, persistence, recovery, and completed-generation replay sources.
- `ReplayTank` dynamically loads `PixiReplayRenderer`, keeping browser-only rendering outside server evaluation.
- The live neural graph receives selected-fish activation updates capped at 12 Hz. Simulation positions never flow through React state.

## Simulation And Evolution

`src/simulation` owns the fixed-step world, sensors, spawning, scripted predator, steering, collisions, and episode lifecycle. Training and scripted evaluation run in a `1000 x 700` world for 900 fixed `1/60` steps. Visible replay uses the same core without the training duration boundary and completes only when every fish is caught.

`src/evolution` owns the `11 -> 8 -> 2` tanh policy, fitness evaluation, seeded selection, crossover, mutation, curriculum, and population reproduction. Evaluation order does not influence results: every genome uses episode seeds derived from the run seed, generation, and episode index.

The default run evaluates 256 genomes over eight episodes. Browser settings can select the supported smaller population and episode presets without changing the domain boundary.

## Worker Boundaries

Replay and training use separate versioned message protocols. Every command is validated before execution, and every event is validated by the corresponding client.

The trainer evaluates four genomes per task and yields to the worker event loop between tasks. Pause, reset, curriculum, and checkpoint commands therefore operate at coherent chunk boundaries. The worker only emits resumable checkpoints after a complete generation has been evaluated and reproduced.

The replay worker advances the same fixed-step simulation core and publishes snapshots at 15 Hz. It begins a new episode only after all fish are caught or a restart command is received; a pending roster is applied at that boundary. Each snapshot is one 832-byte backing buffer containing fish positions, velocities, alive flags, and predator state. The buffer is transferred, not cloned. Mapping, catch, activation, and episode-end events remain separate semantic messages.

## Rendering Boundary

PixiJS owns the WebGL canvas and renders on `requestAnimationFrame`. It interpolates the latest two worker snapshots and maintains sprites, transforms, selection, trails, particles, and catches imperatively. React owns controls, labels, metrics, warnings, and the SVG neural graph; it does not own per-frame canvas geometry.

The renderer contains the `1000 x 700` world inside its responsive host without changing simulation coordinates. Reduced-effects mode disables nonessential glow, trail, and motion treatments while preserving state and controls.

## Persistence Boundary

The trainer client persists only completed checkpoints through `IndexedDbCheckpointRepository`. One active local run is supported. Repository operations are serialized so an older asynchronous write cannot replace a newer generation from the same run.

Invalid records are moved to a bounded quarantine. If IndexedDB cannot open, write, or clear, the repository switches to a sticky in-memory backend for the current session and reports a typed warning. A worker failure creates a replacement worker from the last completed checkpoint and leaves it paused for an explicit user resume.

The full wire and storage contract is documented in [Checkpoint Format](checkpoint-format.md).

## Determinism Contract

For the same run seed, world configuration, evolution configuration, curriculum commands, and JavaScript engine, simulation and evolution state is reproducible. The implementation relies on:

- A seeded uint32 PRNG and explicit seed derivation
- A fixed timestep and fixed training episode length
- Stable population and episode iteration order
- Float32 genome and activation buffers
- Canonical little-endian checkpoint encoding

Determinism does not mean that every emitted value is byte-identical. Checkpoint `savedAt` timestamps and measured generation `durationMilliseconds` depend on wall-clock execution. Run identifiers may also differ between newly created sessions.

The policy forward pass uses JavaScript `Math.tanh`. The project does not claim bit-identical evolution across unverified JavaScript engines or hardware. Release checks use the pinned Node/npm toolchain and Chromium target described in [Release Verification](release-verification.md).
