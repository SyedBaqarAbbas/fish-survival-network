# Replay Subsystem

This folder owns the deterministic, off-main-thread replay of a ranked fish
roster. It validates and clones replay inputs, advances the shared simulation in
a Web Worker, and sends compact events to the UI. Rendering is a separate concern
owned by [`src/rendering`](../rendering/).

Replay is not training. Training evaluates one genome at a time; after a
generation completes, the trainer ranks its candidates and creates the exact
48-genome source consumed here. See the [trainer worker guide](../workers/README.md)
and [evolution guide](../evolution/README.md) for that path.

## Data Flow

```text
ReplayTank
    |
    | ReplayClient commands: LOAD, PLAY, PAUSE, RESTART, SPEED, SELECT
    v
replay.worker.ts -> ReplayEngine -> deterministic simulation
    |
    | MAPPING, SNAPSHOT, CATCH, ACTIVATION, EPISODE_END, ERROR
    v
ReplayClient -> PixiReplayRenderer and React callbacks
```

`ReplayClient` owns the browser worker boundary. It clones sources before
posting them, validates every event, rejects stale sequence or episode data,
and offers a separate high-frequency snapshot subscription so simulation frames
do not need to pass through React state.

## Replay Source Contract

Every `ReplaySource` must satisfy these rules before the engine accepts it:

- `entries` contains exactly `REPLAY_FISH_COUNT` (`48`) genomes.
- Genome IDs are unique, and `championGenomeId` names one of those entries.
- Each genome has the fixed `11 -> 8 -> 2` topology and finite Float32
  parameters.
- Entry order is meaningful. Source entry `i`, simulation fish `i`, mapping
  entry `i`, catch events, snapshots, and activation events all refer to the
  same fish slot.
- The source owns its world configuration, generation, curriculum level, run
  identity, and optional fitness and survival metadata.
- A load is deeply cloned. Callers cannot mutate an active replay through a
  source object they still hold.

The trainer constructs a source from the top 48 evaluated genomes in exact
fitness-ranked order. `createDemoReplaySource()` provides a deterministic
Level 6 source for tests and fallback use.

## Episode Lifecycle

`LOAD` prepares a complete simulation state before changing the active episode.
The new source is applied immediately only when there is no active replay or the
current replay is paused at step zero. Once an episode has advanced, the prepared
source becomes pending instead:

1. The visible roster keeps playing even after `world.episodeSeconds` while any
   fish remain alive. Replay uses the `all-fish-caught` end condition.
2. Additional loads replace the pending source, so only the newest roster waits.
3. When every fish is caught, the engine emits `EPISODE_END` and starts a new
   episode with the pending source. Without a pending source, it restarts the
   current source from the same seed.
4. An explicit `RESTART` applies the pending source immediately. The lab's
   **Replay now** action follows this path. Without a pending source, restart is
   a byte-identical reset of the active source and seed.

Restart preserves whether the engine was playing or paused. Episode IDs and
event sequence numbers remain monotonic across every boundary.

Selection is a fish-slot selection. The selected index remains stable through
snapshots and restarts, and activation events use the genome mapped to that slot.
When a newer roster takes over, the same selected index can name a different
genome; consumers must use the new `MAPPING` event rather than retain old genome
metadata.

## Worker Protocol

All commands are strict, Zod-validated protocol-v1 messages:

| Command | Effect |
| --- | --- |
| `LOAD` | Validate, clone, and prepare a source plus unsigned replay seed. |
| `PLAY` / `PAUSE` | Start or stop scheduled simulation pulses. |
| `RESTART` | Begin a fresh episode, applying a pending source when present. |
| `SPEED` | Select `0.5x`, `1x`, or `2x` fixed-step advancement. |
| `SELECT` | Select fish index `0..47`, or clear selection with `null`. |

The engine responds with:

| Event | Purpose |
| --- | --- |
| `MAPPING` | Defines source metadata and the ordered fish-index-to-genome map. |
| `SNAPSHOT` | Carries packed positions, velocities, alive flags, and predator state. |
| `CATCH` | Identifies the slot and genome caught on the current step. |
| `ACTIVATION` | Reports the selected fish's sensors, nodes, outputs, and edge weights. |
| `EPISODE_END` | Reports the final survivor/catch counts before the next mapping. |
| `ERROR` | Reports typed validation, state, load, worker, or simulation failures. |

Changing a command or event shape requires updating its TypeScript type, strict
Zod schema, worker handling, client handling, and protocol tests together. Bump
`REPLAY_PROTOCOL_VERSION` for an incompatible wire-format change.

## Snapshots

The engine schedules pulses at 15 Hz. Depending on replay speed, each pulse
advances 2, 4, or 8 fixed `1/60` simulation steps and emits one snapshot.

Each snapshot is one 832-byte `ArrayBuffer` shared by typed views:

| Offset | View | Contents |
| --- | --- | --- |
| `0` | `Float32Array(96)` | 48 `(x, y)` positions, 384 bytes |
| `384` | `Float32Array(96)` | 48 `(vx, vy)` velocities, 384 bytes |
| `768` | `Uint8Array(48)` | Alive flags, 48 bytes |
| `816` | `Float32Array(4)` | Predator position and velocity, 16 bytes |

`replay.worker.ts` transfers that buffer instead of copying it. The exact layout
is validated on both sides; changing offsets, lengths, or total size is a wire
format change and must be coordinated with the renderer and tests.

## File Map

| File | Responsibility |
| --- | --- |
| [`source.ts`](source.ts) | The exact-48 source schema, cloning, and demo source. |
| [`protocol.ts`](protocol.ts) | Versioned command/event types and strict validation. |
| [`snapshot.ts`](snapshot.ts) | The canonical 832-byte packed snapshot layout. |
| [`engine.ts`](engine.ts) | Episode state machine, neural steering, pacing, and events. |
| [`replay.worker.ts`](replay.worker.ts) | Worker message validation and transferable posting. |
| [`createReplayWorker.ts`](createReplayWorker.ts) | Webpack-compatible module-worker construction. |
| [`client.ts`](client.ts) | Main-thread commands, subscriptions, validation, and stale-event filtering. |
| [`index.ts`](index.ts) | Public exports under the `@/replay` alias. |
| `*.test.ts` | Source, protocol, snapshot, engine, worker, and client contracts. |

## Changing Replay Safely

- Preserve fish ordering. Never sort a source after indices have been assigned.
- Keep simulation logic in `src/simulation`; the replay engine should orchestrate
  observations, network outputs, and fixed steps rather than duplicate physics.
- Do not replace the active source mid-episode. The pending-source boundary keeps
  visible fish, neural metadata, and catch events coherent.
- Keep snapshot traffic out of React state and retain transferable buffer use.
- Validate data at both worker boundaries, and ignore events from stale episodes.
- Add a deterministic engine test for lifecycle or pacing changes and a protocol
  test for any message-shape change.

Run the focused replay suite with:

```bash
npm test -- src/replay
```

For UI-facing changes, also run the replay browser flow:

```bash
npm run test:e2e -- tests/e2e/replay.spec.ts
```
