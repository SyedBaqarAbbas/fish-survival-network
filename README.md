# Fish Survival Network

A browser-first neuroevolution lab for training fish policies against a scripted predator and replaying deterministic generations with PixiJS.

The repository currently contains the Next.js application foundation, deterministic simulation core, genetic evolution engine, cooperative training worker, and versioned local checkpoint persistence. Visual replay and the full training controls are added by subsequent project issues.

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
npm run train:starter # Check the starter-training command scaffold
```

The starter command is intentionally non-mutating until the trained checkpoint is generated under `FIS-11`; it reports the checkpoint schema reserved by the foundation.

## Architecture

```text
src/app/          Next.js route and global styling
src/components/   React UI and client-only lab boundary
src/simulation/   Deterministic world contracts
src/evolution/    Genome and training contracts
src/rendering/    Packed replay snapshot contracts
src/persistence/  Versioned checkpoint codec and IndexedDB repository
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

## Training And Checkpoints

Browser training evaluates four genomes per worker task and yields between chunks so pause, reset, curriculum, and checkpoint commands remain responsive. Progress is emitted after every chunk. Only the finalized post-reproduction state is resumable; partial evaluation arrays never enter a checkpoint.

Checkpoints use schema version 1 and include the complete population, seeded PRNG state, evolution and world configuration, curriculum archives, and generation metric history. Float32 parameters use a canonical little-endian Base64 representation so JSON bundles and IndexedDB records share the same strict Zod validation path.

The browser keeps one active run in IndexedDB. Invalid or unknown records are quarantined, write failures switch to an in-memory session store with a typed warning, and worker crashes recover from the last completed checkpoint in a paused state.
