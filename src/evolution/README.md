# Evolution

`src/evolution` owns the deterministic neuroevolution algorithm: genomes,
network inference, evaluation, fitness, ranking, reproduction, and curriculum
progression. It operates on simulation state and plain typed data. Browser
worker scheduling, persistence, and replay belong to other directories.

## Training Is Not The 48-Fish Replay

This distinction is essential when reading the code or interpreting the UI:

- **Training evaluates one genome as one fish.** Each candidate runs alone
  against the scripted predator across the same seeded episode set used for
  every other candidate in that generation.
- **Replay displays the ranked top 48 together.** After a generation finishes,
  the trainer packages those policies as a replay source. The replay engine
  spawns all 48 in one tank for inspection.

The fish shown together were not trained as a school, and their shared replay
is not used to calculate training fitness. Training episodes use the configured
duration; visible replay continues until all 48 fish are caught.

## Generation Data Flow

```text
run seed + generation
  -> shared deterministic episode seeds
  -> evaluate every genome independently
       observation -> 11 x 8 x 2 tanh network -> steering -> simulation
  -> average each genome's episode fitness
  -> rank best to worst
  -> preserve elites and create mutated/crossed-over offspring
  -> update the sensor curriculum
  -> return the next generation and the completed generation's results
```

[`createEvolutionRun`](./population.ts) creates generation zero, its seeded
population, and a level-zero curriculum. [`evolveGeneration`](./population.ts)
is the synchronous top-level operation. The browser trainer performs the same
evaluation incrementally in cooperative chunks, then calls
`completeEvaluatedGeneration` to preserve the same generation boundary.

Every genome in one generation receives the same derived episode seeds. A
training episode contains one fish and one scripted predictive predator. Its
fitness combines:

- Alive time.
- A bonus for surviving the complete episode.
- Mean distance from the predator.
- A penalty for wall impacts.
- A small penalty for steering effort.

See [`config.ts`](./config.ts) for the exact weights and algorithm defaults.
Episode fitness is averaged across the genome's episodes, and survival rate is
the fraction of those episodes it survived.

## Policy And Curriculum

The fixed fish policy is an `11 -> 8 -> 2` fully connected tanh network:

- 11 curriculum-controlled sensor inputs.
- 8 hidden units.
- 2 steering outputs (`x` and `y`).

Genomes store all weights and biases as `Float32Array` values. Inputs that have
not yet been unlocked keep zero input-to-hidden weights and are skipped by
mutation. When a level unlocks new inputs, their weights are initialized with a
small seeded Gaussian value.

| Level | Newly unlocked inputs |
| ---: | --- |
| 0 | Bias |
| 1 | Predator distance |
| 2 | Predator direction `x` and `y` |
| 3 | Closing speed |
| 4 | Top and bottom wall distance |
| 5 | Left and right wall distance |
| 6 | Fish velocity `x` and `y` |

Automatic curriculum progression is enabled unless the config explicitly sets
`automaticCurriculum` to `false`. A level qualifies after the median population
survival rate reaches at least `0.75` for five consecutive generations. The
level champion is archived, the next inputs are unlocked, and the stability
counter resets. Level 6 archives its champion but does not advance further.

## Default Algorithm

The defaults in [`config.ts`](./config.ts) are:

| Setting | Value |
| --- | ---: |
| Population | 256 |
| Episodes per genome | 8 |
| Elites preserved | 13 |
| Tournament size | 5 |
| Crossover probability | `0.65` |
| Per-parameter mutation probability | `0.12` |
| Mutation standard deviation | `0.18` |
| Parameter bounds | `-5` to `5` |

Ranking is descending by finite fitness with original population index as the
stable tie-breaker. Elites are cloned unchanged. Each remaining child is chosen
with seeded tournament selection, optionally uses uniform per-parameter
crossover, and is then mutated with seeded Gaussian noise within the configured
bounds.

## File Map

| File | Responsibility |
| --- | --- |
| [`config.ts`](./config.ts) | Genetic algorithm defaults, fitness weights, and curriculum thresholds. |
| [`types.ts`](./types.ts) | Genome, evaluation, curriculum, run-state, and generation-result contracts. |
| [`genome.ts`](./genome.ts) | Genome creation, topology validation, byte-preserving cloning, and equality. |
| [`forward.ts`](./forward.ts) | Buffered tanh inference for one policy. |
| [`inputs.ts`](./inputs.ts) | The sensor inputs unlocked at each curriculum level. |
| [`evaluation.ts`](./evaluation.ts) | Shared episode seeds and single-genome/population evaluation. |
| [`fitness.ts`](./fitness.ts) | Episode scoring, aggregation, and median survival rate. |
| [`genetics.ts`](./genetics.ts) | Stable ranking, elitism, tournament selection, crossover, and mutation. |
| [`stochastic.ts`](./stochastic.ts) | Seeded Gaussian samples used by mutation and input initialization. |
| [`curriculum.ts`](./curriculum.ts) | Level qualification, champion archives, and newly unlocked weights. |
| [`population.ts`](./population.ts) | Run creation, generation completion, reproduction, and curriculum orchestration. |
| [`index.ts`](./index.ts) | Public exports for consumers outside this directory. |

Tests live beside the implementation. Reusable fixtures are in
[`__tests__/fixtures.ts`](./__tests__/fixtures.ts).

## Invariants

- All candidates in a generation use the same episode seeds in the same order.
- Population position, `populationIndex`, and genome ID must agree throughout
  evaluation; genome IDs are unique.
- Ranking is stable for equal or nonfinite fitness, so iteration order remains
  deterministic.
- Reproduction returns exactly the configured population size and gives new
  children generation/index-based IDs.
- Genome arrays have the declared topology and are cloned at ownership
  boundaries. Mutating a returned child must not mutate its parent.
- Locked sensor weights remain zero until their curriculum level is reached.
- The evolution core does not measure wall-clock duration or schedule work.
  Those concerns belong to the trainer worker.
- Reproducibility assumes the same configuration, command sequence, and
  JavaScript `Math.tanh` behavior; it is not a cross-engine byte-identity claim.

## Changing Evolution Code Safely

- A topology or parameter-layout change affects checkpoint encoding, starter
  validation, replay activations, and the neural graph. Treat it as a versioned
  cross-system change.
- Fitness, selection, mutation, seed, or curriculum changes alter deterministic
  outcomes and can invalidate the bundled starter's held-out expectations.
- Changes to default population, episode, or mutation settings must also be
  reflected in the browser settings and trainer tests.
- Keep worker scheduling out of this directory. The synchronous generation
  result is the contract that cooperative training must match.
- Do not regenerate the starter artifact merely to make validation pass. Its
  recipe and checksum changes require intentional review.

Start with the focused suite:

```bash
npm test -- src/evolution
npm run typecheck
```

Use `npm run evolve:once -- 42` as a deterministic one-generation smoke test.
For topology, evaluation, curriculum, or serialization-impacting changes, also
run:

```bash
npm test -- src/simulation src/persistence src/replay src/starter src/workers
npm run validate:starter
```

Run `npm run verify:release` before merging a cross-boundary algorithm change.
