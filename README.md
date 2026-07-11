# Fish Survival Network

A browser-first neuroevolution lab for training fish policies against a scripted predator and replaying deterministic generations with PixiJS.

The repository currently contains the application foundation tracked by Linear issue `FIS-5`: a Next.js App Router shell, strict TypeScript boundaries, test tooling, and a real Web Worker readiness handshake. Simulation and evolution behavior are added by the subsequent project issues.

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
npm run train:starter # Check the starter-training command scaffold
```

The starter command is intentionally non-mutating until the evolution engine is implemented under `FIS-11`; it reports the checkpoint schema reserved by the foundation.

## Architecture

```text
src/app/          Next.js route and global styling
src/components/   React UI and client-only lab boundary
src/simulation/   Deterministic world contracts
src/evolution/    Genome and training contracts
src/rendering/    Packed replay snapshot contracts
src/persistence/  Versioned checkpoint contracts
src/workers/      Typed worker protocol and entry points
tests/e2e/        Browser-level verification
```

Simulation, evolution, and serialization modules must remain independent from React, PixiJS, and browser globals so the same deterministic implementation can run in browser workers, Node scripts, and tests.
