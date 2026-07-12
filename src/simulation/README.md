# Simulation

`src/simulation` is the deterministic world core. It owns spawning, sensors,
movement, wall collisions, catches, and episode termination. It accepts steering
commands, but it does not know whether those commands came from a scripted
controller, a neural network, a browser worker, or a test.

Keeping that boundary narrow lets the same simulation run in Node scripts,
training workers, replay workers, and unit tests without React, PixiJS,
IndexedDB, or other browser APIs.

## Mental Model

```text
seed
  -> deterministic spawn layout
  -> mutable simulation state
  -> observe state and choose one steering vector per fish
  -> integrate agents and resolve walls
  -> record predator catches
  -> advance fixed-step time and evaluate the end condition
```

The default world in [`config.ts`](./config.ts) is `1000 x 700`, advances by
`1/60` second per step, and has a 15-second duration for training and scripted
evaluation. `getEpisodeStepCount` requires the duration to contain a whole
number of fixed steps, so the default duration is exactly 900 steps.

[`createSimulationState`](./episode.ts) owns clones of the supplied spawn
layout and world. [`stepSimulation`](./episode.ts) then mutates that owned state
in place. A step performs these operations in order:

1. Integrate each living fish and resolve its wall contacts.
2. Integrate the predator and resolve its wall contacts.
3. Check every living fish for overlap with the predator in fish-index order.
4. Record catches against the new step number.
5. Update `step`, `elapsedSeconds`, and `finished`.

The episode has two explicit termination modes:

| End condition | Used for | Completion rule |
| --- | --- | --- |
| `duration` | Training and scripted evaluation | The configured fixed-step duration has elapsed. This is the default. |
| `all-fish-caught` | Visible replay | Every fish has been caught, regardless of elapsed time. |

Replay selects the second mode explicitly. Do not infer replay termination from
`world.episodeSeconds`; that field still travels with the shared world config.

## File Map

| File | Responsibility |
| --- | --- |
| [`config.ts`](./config.ts) | World, agent, spawn, sensor, and fixed-step constants plus episode-length validation. |
| [`types.ts`](./types.ts) | Shared world, agent, steering, spawn, and curriculum-level types. |
| [`random.ts`](./random.ts) | Serializable seeded PRNG and stable episode-seed derivation. |
| [`spawning.ts`](./spawning.ts) | Deterministic predator/fish placement with distance and wall-margin checks. |
| [`sensors.ts`](./sensors.ts) | Curriculum-aware 11-value fish observations and closing-speed calculation. |
| [`steering.ts`](./steering.ts) | Scripted fish behavior, predictive predator steering, and nearest-live-fish targeting. |
| [`physics.ts`](./physics.ts) | Acceleration/speed integration, wall response, contact accounting, and overlap tests. |
| [`episode.ts`](./episode.ts) | State ownership, the fixed-step lifecycle, controllers, statistics, and termination. |
| [`index.ts`](./index.ts) | Public exports for consumers outside this directory. |

Tests live beside the implementation. Reusable deterministic fixtures are in
[`__tests__/fixtures.ts`](./__tests__/fixtures.ts).

## Invariants

- A uint32 seed and the same configuration produce the same spawn layout and
  episode-seed sequence.
- Simulation time is derived from `step * fixedDt`; wall-clock time never drives
  domain state.
- Callers must provide exactly one steering vector per fish. Steering applied
  to a living agent or the predator must be finite, and its magnitude is capped
  before acceleration is applied.
- Dead fish are not integrated again, and their wall contact masks are cleared.
- Wall impact counts represent new contacts, not every step spent touching a
  wall.
- Fish catches are checked only after both fish and predator movement, and
  simultaneous catches are recorded in stable fish-index order.
- A finished state cannot advance again. `stepSimulation` returns `false`
  without changing it.
- This directory must remain free of React, rendering, persistence, and worker
  lifecycle concerns.

## Changing Simulation Code Safely

Changes here have a wider effect than the directory size suggests:

- Changing step order, random draws, seed derivation, collision rules, or sensor
  normalization changes deterministic evaluation results.
- Changing an input's meaning affects every stored genome even when its shape
  remains `11 -> 8 -> 2`.
- Changing `WorldConfig` fields affects the checkpoint contract. Review
  [`docs/checkpoint-format.md`](../../docs/checkpoint-format.md) before doing so.
- Changing defaults or behavior can invalidate the bundled starter's held-out
  expectations. Validate the existing artifact; do not regenerate it as an
  incidental fix.
- New end conditions must be exercised through both training and replay callers,
  not only through `episode.ts` tests.

Start with the focused suite:

```bash
npm test -- src/simulation
npm run typecheck
```

For changes to physics, sensors, spawning, random numbers, or termination, also
run the affected consumers and starter validation:

```bash
npm test -- src/evolution src/replay src/starter
npm run validate:starter
```

Use `npm run simulate -- 42` for a quick scripted-episode smoke test. Run
`npm run verify:release` before merging a cross-boundary deterministic change.
