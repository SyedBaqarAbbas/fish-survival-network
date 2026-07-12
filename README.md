# Fish Survival Network

A local-first neuroevolution lab for training fish policies against a scripted predator, replaying deterministic generations with PixiJS, and inspecting live `11 -> 8 -> 2` neural activations.

The v1 application includes deterministic simulation and evolution, cooperative browser-worker training, a validated Level 6 starter replay, versioned IndexedDB checkpoints, responsive Replay and Train controls, generation metrics, and an accessible live neural graph.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- A WebGL-capable Chromium browser for the verified v1 experience

The checked-in [.nvmrc](.nvmrc) pins the release-validation runtime to Node.js 22.18.0. [package.json](package.json) pins npm 10.9.3 through its `packageManager` field.

## Setup

```bash
nvm use
npm ci
npm run dev
```

If `nvm` is not installed, select any Node.js version that satisfies `package.json` before running `npm ci`. Open [http://localhost:3000](http://localhost:3000). Development and production builds explicitly use Webpack because the worker entry points rely on its documented `new Worker(new URL(...))` integration.

Playwright also requires its Chromium binary before the first end-to-end run:

```bash
npm run test:e2e:install
```

Linux and CI environments that do not already have Chromium system dependencies can instead run:

```bash
npx playwright install --with-deps chromium
```

The checked-in visual baselines are currently certified on macOS. A Linux release job must add and review its platform-specific Playwright baselines before `npm run verify:release` is considered authoritative there; responsive Chromium behavior is tested, but Linux pixel output is not yet a v1 release claim.

## Commands

```bash
npm run dev               # Start the local Next.js server
npm run build             # Create the production build
npm start                 # Run a completed production build
npm run lint              # Run ESLint
npm run lint:fix          # Apply safe ESLint fixes
npm run typecheck         # Run TypeScript without emitting files
npm test                  # Run Vitest once
npm run test:coverage     # Run Vitest with text and HTML coverage
npm run test:watch        # Run Vitest in watch mode
npm run test:e2e          # Run Playwright against the local app
npm run test:e2e:install  # Install the verified Chromium test browser
npm run evolve:once       # Evaluate/reproduce one default 256 x 8 generation
npm run simulate          # Run a scripted episode (optional seed argument)
npm run train:starter     # Regenerate the pinned Level 6 starter artifact
npm run validate:starter  # Validate starter scores, structure, and checksums
npm run verify:release    # Run every release gate in sequence
```

See [Release Verification](docs/release-verification.md) for the clean-install sequence, expected gates, and performance evidence.

## Architecture

```text
src/app/          Next.js route and global styling
src/components/   React UI and client-only lab boundary
src/simulation/   Deterministic world contracts
src/evolution/    Genome and training contracts
src/replay/       Replay source, protocol, worker engine, and browser client
src/rendering/    Imperative PixiJS scene, interpolation, and interaction
src/persistence/  Versioned checkpoint codec and IndexedDB repository
src/starter/      Bundled checkpoint recipe, validation, and server loader
src/workers/      Typed protocol, cooperative engine, and recovery client
tests/e2e/        Browser-level verification
```

Simulation, evolution, and serialization modules remain independent from React, PixiJS, and browser globals so the same implementation can run in browser workers, Node scripts, and tests. The complete data flow and determinism contract are documented in [Architecture](docs/architecture.md).

## Simulation Defaults

The deterministic core uses a `1000 x 700` world and a `1/60` fixed timestep. Training and scripted evaluation use exactly 900 steps per 15-second episode; visible replay uses the same fixed-step world but continues until every fish is caught. Fish and predator spawning, scripted steering, wall impacts, catches, and sensor observations are reproducible from the episode seed. Run the same training scenario repeatedly with:

```bash
npm run simulate -- 42
```

## Evolution Defaults

Fish use a fixed `11 -> 8 -> 2` tanh network. Each default generation evaluates 256 genomes over the same eight deterministic episode seeds, preserves 13 elites, and creates offspring with seeded tournament selection, uniform crossover, and Gaussian mutation. The automatic curriculum unlocks sensor groups after five consecutive generations reach a median survival rate of at least `0.75`.

Run one complete default generation with:

```bash
npm run evolve:once -- 42
```

## Bundled Level 6 Starter

A clean first launch immediately replays the ranked 48-fish roster extracted from the checked-in Level 6 checkpoint. The server validates the complete artifact, then sends an owned clone of only its replay source and metric history to the client. Local training starts or resumes independently through IndexedDB and never mutates or resumes from the bundled source.

The artifact is generated with run seed `85622289`. The fixed recipe trains three generations at each level from 0 through 5, then twenty generations at Level 6. It always selects the champion from evaluated generation 37 and stores generation 38 as the resumable artifact state; held-out results never control the stopping point.

```bash
npm run validate:starter
```

The pinned validation result is 7 survivors across 8 held-out episodes with `13.447916666666666` mean alive seconds. The artifact SHA-256 is `f9d2c8e671da1bbd40ff2c5143366446083cfd30101e29d214c1d75fb53f0212`; the champion Float32 parameter SHA-256 is `9cc42380e7c336eba899458a4fcaf1fa97bdf415cc00adfd21464380f2a6cbb3`.

Regeneration takes roughly 35 seconds on the development machine. The command writes canonical formatted JSON and its checksum sidecar only after the complete checkpoint passes structural and held-out validation.

## Lab Interface

The app opens in Replay mode with the bundled Level 6 roster. Select a fish in the tank or fish menu to inspect its live neural activations and all 104 weighted edges. Replay controls provide pause, restart, and 0.5x/1x/2x speeds without routing simulation positions through React.

Train mode creates or restores the local IndexedDB run, reports generation progress, and promotes each completed top-48 roster into replay. Settings cover the run seed, population, episode count, mutation controls, automatic or fixed curriculum, and reduced visual effects. Applying replacement settings to an existing run requires confirmation; persistence failures leave training available in memory with a visible warning.

## Training And Checkpoints

Browser training evaluates four genomes per worker task and yields between chunks so pause, reset, curriculum, and checkpoint commands remain responsive. Progress is emitted after every chunk. Only the finalized post-reproduction state is resumable; partial evaluation arrays never enter a checkpoint.

Checkpoints use schema version 1 and include the complete population, seeded PRNG state, evolution and world configuration, curriculum archives, generation metric history, and an optional replay source. Float32 parameters use a canonical little-endian Base64 representation so JSON artifacts and IndexedDB records share the same strict Zod validation path.

The browser keeps one active run in IndexedDB. Invalid or unknown records are quarantined, write failures switch to an in-memory session store with a typed warning, and worker crashes recover from the last completed checkpoint in a paused state. See [Checkpoint Format](docs/checkpoint-format.md) for the complete storage and compatibility contract.

## Deterministic Replay

Each completed generation checkpoints its evaluated top 48 genomes in ranked order. The replay worker runs those policies against the nearest-target scripted predator on the same fixed-step simulation core. A visible replay has no 15-second cutoff: it starts the next deterministic episode only after every fish is caught. The Restart control starts a new episode immediately, and a newer trained roster waits for one of those two boundaries before replacing the active roster.

The worker emits one packed 832-byte snapshot at 15 Hz. PixiJS interpolates the latest two snapshots on `requestAnimationFrame`, keeping position updates outside React. Fish selection maps a stable canvas index back to its genome, while catch events drive pooled particles, trails, and the low-frequency alive counter.

## Browser Support

Chromium is the verified v1 browser target. Playwright covers desktop, tablet, and mobile-sized Chromium viewports, but those responsive checks do not claim compatibility with Safari, Firefox, or their mobile engines.

The application requires Web Workers, transferable `ArrayBuffer` values, IndexedDB, `structuredClone`, `ResizeObserver`, `requestAnimationFrame`, and WebGL. If IndexedDB is blocked or unavailable, the current run remains usable in memory for that browser session and the UI reports that it is not persisted. A browser without worker or WebGL support cannot run the full lab.

## V1 Scope

V1 evolves fish policies against one scripted predictive predator, trains locally in browser workers, retains one active local run, and replays ranked 48-fish generations. The bundled starter, live graph, metrics, responsive controls, reduced-effects mode, and checkpoint recovery are part of this release.

The following remain explicitly deferred and are not v1 capabilities:

- Predator evolution
- Alternating coevolution
- Hall-of-fame opponents
- Generation scrubbing
- Replay or video export
- TensorFlow.js
- NEAT
