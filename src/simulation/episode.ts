import { EPISODE_STEP_COUNT, getEpisodeStepCount, WORLD_CONFIG } from "./config";
import { agentsOverlap, integrateAgent, resolveWallCollisions } from "./physics";
import { createSpawnLayout } from "./spawning";
import {
  findNearestLivingFish,
  scriptedFishSteering,
  scriptedPredatorSteering,
} from "./steering";
import type { AgentState, SpawnLayout, Steering, WorldConfig } from "./types";

const ZERO_STEERING: Readonly<Steering> = Object.freeze({ x: 0, y: 0 });

export interface EpisodeStats {
  catchCount: number;
  catchSteps: Int32Array;
  fishWallCollisions: Uint16Array;
  predatorWallCollisions: number;
}

export interface SimulationState {
  step: number;
  elapsedSeconds: number;
  finished: boolean;
  fish: AgentState[];
  predator: AgentState;
  fishWallContactMasks: Uint8Array;
  predatorWallContactMask: number;
  stats: EpisodeStats;
  world: Readonly<WorldConfig>;
  episodeStepCount: number;
}

export interface EpisodeControllerContext {
  readonly step: number;
  readonly elapsedSeconds: number;
  readonly finished: boolean;
  readonly fish: readonly Readonly<AgentState>[];
  readonly predator: Readonly<AgentState>;
  readonly world: Readonly<WorldConfig>;
  readonly episodeStepCount: number;
}

export interface EpisodeControllers {
  fish: (
    fish: Readonly<AgentState>,
    fishIndex: number,
    state: EpisodeControllerContext,
  ) => Steering;
  predator: (
    predator: Readonly<AgentState>,
    state: EpisodeControllerContext,
  ) => Steering;
}

export interface ScriptedEpisodeOptions {
  seed: number;
  fishCount?: number;
  world?: Readonly<WorldConfig>;
}

function cloneAgent(agent: Readonly<AgentState>): AgentState {
  return { ...agent };
}

export function createSimulationState(
  layout: Readonly<SpawnLayout>,
  world: Readonly<WorldConfig> = WORLD_CONFIG,
): SimulationState {
  if (layout.fish.length === 0) {
    throw new RangeError("A simulation requires at least one fish.");
  }

  const ownedWorld = Object.freeze({ ...world });
  const catchSteps = new Int32Array(layout.fish.length);
  catchSteps.fill(-1);

  const episodeStepCount = getEpisodeStepCount(ownedWorld);

  return {
    step: 0,
    elapsedSeconds: 0,
    finished: false,
    fish: layout.fish.map(cloneAgent),
    predator: cloneAgent(layout.predator),
    fishWallContactMasks: new Uint8Array(layout.fish.length),
    predatorWallContactMask: 0,
    stats: {
      catchCount: 0,
      catchSteps,
      fishWallCollisions: new Uint16Array(layout.fish.length),
      predatorWallCollisions: 0,
    },
    world: ownedWorld,
    episodeStepCount,
  };
}

export function stepSimulation(
  state: SimulationState,
  fishSteering: readonly Readonly<Steering>[],
  predatorSteering: Readonly<Steering>,
) {
  if (state.finished) return false;
  if (fishSteering.length !== state.fish.length) {
    throw new RangeError("One steering value is required for every fish.");
  }

  for (let fishIndex = 0; fishIndex < state.fish.length; fishIndex += 1) {
    const fish = state.fish[fishIndex];
    if (!fish.alive) {
      state.fishWallContactMasks[fishIndex] = 0;
      continue;
    }

    integrateAgent(fish, fishSteering[fishIndex], state.world.fixedDt);
    const collision = resolveWallCollisions(
      fish,
      state.fishWallContactMasks[fishIndex],
      state.world,
    );
    state.fishWallContactMasks[fishIndex] = collision.contactMask;
    state.stats.fishWallCollisions[fishIndex] += collision.impactCount;
  }

  integrateAgent(state.predator, predatorSteering, state.world.fixedDt);
  const predatorCollision = resolveWallCollisions(
    state.predator,
    state.predatorWallContactMask,
    state.world,
  );
  state.predatorWallContactMask = predatorCollision.contactMask;
  state.stats.predatorWallCollisions += predatorCollision.impactCount;

  const nextStep = state.step + 1;
  for (let fishIndex = 0; fishIndex < state.fish.length; fishIndex += 1) {
    const fish = state.fish[fishIndex];
    if (fish.alive && agentsOverlap(fish, state.predator)) {
      fish.alive = false;
      state.stats.catchCount += 1;
      state.stats.catchSteps[fishIndex] = nextStep;
    }
  }

  state.step = nextStep;
  state.elapsedSeconds = state.step * state.world.fixedDt;
  state.finished = state.step >= state.episodeStepCount;
  return true;
}

export function runEpisode(state: SimulationState, controllers: EpisodeControllers) {
  const fishSteering = state.fish.map(() => ({ x: 0, y: 0 }));

  while (!state.finished) {
    for (let fishIndex = 0; fishIndex < state.fish.length; fishIndex += 1) {
      const fish = state.fish[fishIndex];
      const command = fish.alive
        ? controllers.fish(fish, fishIndex, state)
        : ZERO_STEERING;
      fishSteering[fishIndex].x = command.x;
      fishSteering[fishIndex].y = command.y;
    }
    const predatorSteering = controllers.predator(state.predator, state);
    stepSimulation(state, fishSteering, predatorSteering);
  }
  return state;
}

export function runScriptedEpisode({
  seed,
  fishCount = 1,
  world = WORLD_CONFIG,
}: ScriptedEpisodeOptions) {
  const state = createSimulationState(createSpawnLayout({ seed, fishCount, world }), world);
  return runEpisode(state, {
    fish: (fish) => scriptedFishSteering(fish, state.predator, state.world),
    predator: (predator) => {
      const target = findNearestLivingFish(predator, state.fish);
      return target ? scriptedPredatorSteering(predator, target) : ZERO_STEERING;
    },
  });
}

export { EPISODE_STEP_COUNT };
