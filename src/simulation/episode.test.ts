import { describe, expect, it } from "vitest";

import { EPISODE_STEP_COUNT, WORLD_CONFIG } from "./config";
import {
  createSimulationState,
  runEpisode,
  runScriptedEpisode,
  stepSimulation,
} from "./episode";
import { findNearestLivingFish, scriptedPredatorSteering } from "./steering";
import { makeFish, makePredator } from "./__tests__/fixtures";

const ZERO = Object.freeze({ x: 0, y: 0 });

describe("simulation episodes", () => {
  it("requires at least one fish", () => {
    expect(() =>
      createSimulationState({ fish: [], predator: makePredator() }),
    ).toThrow(RangeError);
  });

  it("executes exactly 900 fixed steps and no 901st step", () => {
    const state = createSimulationState({
      fish: [makeFish({ x: 100, y: 100 })],
      predator: makePredator({ x: 900, y: 600 }),
    });
    let fishCalls = 0;
    let predatorCalls = 0;

    runEpisode(state, {
      fish: () => {
        fishCalls += 1;
        return ZERO;
      },
      predator: () => {
        predatorCalls += 1;
        return ZERO;
      },
    });

    expect(EPISODE_STEP_COUNT).toBe(900);
    expect(state.step).toBe(900);
    expect(state.elapsedSeconds).toBe(15);
    expect(fishCalls).toBe(900);
    expect(predatorCalls).toBe(900);
    expect(stepSimulation(state, [ZERO], ZERO)).toBe(false);
    expect(state.step).toBe(900);
  });

  it("can ignore the duration boundary and finish only after every fish is caught", () => {
    const oneStepWorld = {
      ...WORLD_CONFIG,
      episodeSeconds: WORLD_CONFIG.fixedDt,
    };
    const state = createSimulationState(
      {
        fish: [makeFish({ x: 100, y: 100 })],
        predator: makePredator({ x: 900, y: 600 }),
      },
      oneStepWorld,
      { endCondition: "all-fish-caught" },
    );

    stepSimulation(state, [ZERO], ZERO);
    expect(state.step).toBe(state.episodeStepCount);
    expect(state.finished).toBe(false);

    state.predator.x = state.fish[0].x;
    state.predator.y = state.fish[0].y;
    stepSimulation(state, [ZERO], ZERO);

    expect(state.step).toBeGreaterThan(state.episodeStepCount);
    expect(state.stats.catchCount).toBe(1);
    expect(state.finished).toBe(true);
    expect(stepSimulation(state, [ZERO], ZERO)).toBe(false);
  });

  it("rejects unknown simulation end conditions", () => {
    expect(() =>
      createSimulationState(
        {
          fish: [makeFish()],
          predator: makePredator(),
        },
        WORLD_CONFIG,
        { endCondition: "never" } as never,
      ),
    ).toThrow(RangeError);
  });

  it("records an inclusive radius catch once and freezes the dead fish", () => {
    const state = createSimulationState({
      fish: [makeFish({ x: 100, y: 100 })],
      predator: makePredator({ x: 129, y: 100 }),
    });

    stepSimulation(state, [ZERO], ZERO);
    const caughtPosition = { x: state.fish[0].x, y: state.fish[0].y };
    expect(state.stats.catchCount).toBe(1);
    expect(state.stats.catchSteps[0]).toBe(1);
    expect(state.fish[0].alive).toBe(false);

    for (let step = 1; step < 20; step += 1) {
      stepSimulation(state, [{ x: 1, y: 1 }], ZERO);
    }
    expect(state.stats.catchCount).toBe(1);
    expect({ x: state.fish[0].x, y: state.fish[0].y }).toEqual(caughtPosition);
  });

  it("lets the scripted predator catch a stationary target", () => {
    const state = createSimulationState({
      fish: [makeFish({ x: 600, y: 350 })],
      predator: makePredator({ x: 100, y: 350 }),
    });

    runEpisode(state, {
      fish: () => ZERO,
      predator: (predator, currentState) => {
        const target = findNearestLivingFish(predator, currentState.fish);
        return target ? scriptedPredatorSteering(predator, target) : ZERO;
      },
    });

    expect(state.stats.catchCount).toBe(1);
    expect(state.stats.catchSteps[0]).toBeGreaterThan(0);
    expect(state.stats.catchSteps[0]).toBeLessThan(EPISODE_STEP_COUNT);
  });

  it("records simultaneous catches in stable fish-index order", () => {
    const state = createSimulationState({
      fish: [
        makeFish({ id: 9, x: 100, y: 100 }),
        makeFish({ id: 2, x: 100, y: 100 }),
      ],
      predator: makePredator({ x: 100, y: 100 }),
    });
    stepSimulation(state, [ZERO, ZERO], ZERO);
    expect(state.stats.catchCount).toBe(2);
    expect(Array.from(state.stats.catchSteps)).toEqual([1, 1]);
    expect(state.fish.map((fish) => fish.alive)).toEqual([false, false]);
  });

  it("allows a catch on the final fixed step", () => {
    const state = createSimulationState({
      fish: [makeFish({ x: 100, y: 100 })],
      predator: makePredator({ x: 900, y: 600 }),
    });

    for (let step = 0; step < EPISODE_STEP_COUNT - 1; step += 1) {
      stepSimulation(state, [ZERO], ZERO);
    }
    state.predator.x = state.fish[0].x;
    state.predator.y = state.fish[0].y;
    stepSimulation(state, [ZERO], ZERO);

    expect(state.finished).toBe(true);
    expect(state.stats.catchSteps[0]).toBe(EPISODE_STEP_COUNT);
  });

  it("produces identical complete scripted states for the same seed", () => {
    const first = runScriptedEpisode({ seed: 735, fishCount: 4 });
    const second = runScriptedEpisode({ seed: 735, fishCount: 4 });
    expect(second).toEqual(first);
    expect(runScriptedEpisode({ seed: 736, fishCount: 4 })).not.toEqual(first);
  });

  it("counts sustained wall pressure once through the world state", () => {
    const state = createSimulationState({
      fish: [makeFish({ x: 7.01, y: 350, vx: -1 })],
      predator: makePredator({ x: 800, y: 350 }),
    });

    for (let step = 0; step < 60; step += 1) {
      stepSimulation(state, [{ x: -1, y: 0 }], ZERO);
    }
    expect(state.stats.fishWallCollisions[0]).toBe(1);
  });

  it("uses the configured fixed timestep", () => {
    const state = createSimulationState({
      fish: [makeFish()],
      predator: makePredator(),
    });
    stepSimulation(state, [ZERO], ZERO);
    expect(state.elapsedSeconds).toBe(WORLD_CONFIG.fixedDt);
  });
});
