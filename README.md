# Fish Survival Network

A browser-first neuroevolution lab for training fish policies against a scripted predator and replaying deterministic generations with PixiJS.

The repository currently contains the Next.js application foundation, deterministic simulation core, genetic evolution engine, cooperative training worker, versioned local checkpoint persistence, and a live PixiJS replay of the top 48 evaluated fish. Full training and replay controls are added by subsequent project issues.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Development and production builds explicitly use Webpack because the worker entry point relies on its documented `new Worker(new URL(...))` integration.

## Commands

```bash
npm run dev          # Start the local Next.js server
npm run build        # Create the production build
npm start            # Run a completed production build
npm run lint         # Run ESLint
npm run lint:fix     # Apply safe ESLint fixes
npm run typecheck    # Run TypeScript without emitting files
npm test             # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
npm run test:e2e     # Run Playwright against the local app
npm run evolve:once  # Evaluate/reproduce one default 256 × 8 generation
npm run simulate     # Run a deterministic scripted episode (optional seed argument)
npm run train:starter # Regenerate the pinned Level 6 starter artifact
npm run validate:starter # Validate starter scores, structure, and checksums
```

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

Simulation, evolution, and serialization modules must remain independent from React, PixiJS, and browser globals so the same deterministic implementation can run in browser workers, Node scripts, and tests.

## Simulation Defaults

The deterministic core uses a `1000 × 700` world, a `1/60` fixed timestep, and exactly 900 steps per 15-second episode. Fish and predator spawning, scripted steering, wall impacts, catches, and sensor observations are reproducible from the episode seed. Run the same scenario repeatedly with:

```bash
npm run simulate -- 42
```

## Evolution Defaults

Fish use a fixed `11 → 8 → 2` tanh network. Each generation evaluates 256 genomes over the same eight deterministic episode seeds, preserves 13 elites, and creates offspring with seeded tournament selection, uniform crossover, and Gaussian mutation. The curriculum unlocks sensor groups after five consecutive generations reach a median survival rate of at least `0.75`.

Run one complete default generation with:

```bash
npm run evolve:once -- 42
```

## Bundled Level 6 Starter

A clean first launch replays the checked-in Level 6 checkpoint immediately. The server validates the complete artifact, then sends an owned clone of only its ranked 48-fish replay source to the client. Local training still starts or resumes independently through IndexedDB and never mutates the bundled source.

The artifact is generated with run seed `85622289`. The fixed recipe trains three generations at each level from 0 through 5, then twenty generations at Level 6. It always selects the champion from evaluated generation 37 and stores generation 38 as the resumable state; held-out results never control the stopping point.

```bash
npm run validate:starter
```

The pinned validation result is 7 survivors across 8 held-out episodes with `13.447916666666666` mean alive seconds. The artifact SHA-256 is `f9d2c8e671da1bbd40ff2c5143366446083cfd30101e29d214c1d75fb53f0212`; the champion Float32 parameter SHA-256 is `9cc42380e7c336eba899458a4fcaf1fa97bdf415cc00adfd21464380f2a6cbb3`.

Regeneration takes roughly 35 seconds on the development machine. The command writes canonical formatted JSON and its checksum sidecar only after the complete checkpoint passes structural and held-out validation.

## Lab Interface

The app opens in Replay mode with the bundled Level 6 roster. Select a fish in the tank or from the fish menu to inspect its live 11 → 8 → 2 activations and weighted edges. Replay controls provide pause, restart, and 0.5x/1x/2x speeds without routing simulation frames through React.

Train mode creates or restores the local IndexedDB run, reports generation progress, and promotes each completed top-48 roster into the replay. Settings cover the run seed, population, episode count, mutation controls, automatic or fixed curriculum, and reduced visual effects. Applying replacement settings to an existing run requires confirmation; persistence failures leave training available in memory with a visible warning.

## Training And Checkpoints

Browser training evaluates four genomes per worker task and yields between chunks so pause, reset, curriculum, and checkpoint commands remain responsive. Progress is emitted after every chunk. Only the finalized post-reproduction state is resumable; partial evaluation arrays never enter a checkpoint.

Checkpoints use schema version 1 and include the complete population, seeded PRNG state, evolution and world configuration, curriculum archives, and generation metric history. Float32 parameters use a canonical little-endian Base64 representation so JSON bundles and IndexedDB records share the same strict Zod validation path.

The browser keeps one active run in IndexedDB. Invalid or unknown records are quarantined, write failures switch to an in-memory session store with a typed warning, and worker crashes recover from the last completed checkpoint in a paused state.

## Deterministic Replay

Each completed generation checkpoints its evaluated top 48 genomes in ranked order. The replay worker runs those policies against the nearest-target scripted predator on the same fixed-step simulation core and queues a newer trained roster until the current episode ends.

The worker emits one packed 832-byte snapshot at 15 Hz. PixiJS interpolates the latest two snapshots on `requestAnimationFrame`, keeping position updates outside React. Fish selection maps a stable canvas index back to its genome, while catch events drive pooled particles, trails, and the low-frequency alive counter.
