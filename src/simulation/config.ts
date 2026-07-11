import type { AgentConfig, SpawnConfig, WorldConfig } from "./types";

export const WORLD_CONFIG = Object.freeze({
  width: 1000,
  height: 700,
  fixedDt: 1 / 60,
  episodeSeconds: 15,
}) satisfies Readonly<WorldConfig>;

export const FISH_CONFIG = Object.freeze({
  radius: 7,
  maxSpeed: 115,
  maxAcceleration: 260,
}) satisfies Readonly<AgentConfig>;

export const PREDATOR_CONFIG = Object.freeze({
  radius: 22,
  maxSpeed: 145,
  maxAcceleration: 190,
}) satisfies Readonly<AgentConfig>;

export const SPAWN_CONFIG = Object.freeze({
  wallMargin: 50,
  minFishPredatorDistance: 300,
  minFishSpacing: 18,
  maxPlacementAttempts: 512,
}) satisfies Readonly<SpawnConfig>;

export const WALL_RESTITUTION = 0.25;
export const FISH_INPUT_COUNT = 11;
export const FISH_INPUT_INDEX = Object.freeze({
  bias: 0,
  distance: 1,
  directionX: 2,
  directionY: 3,
  closingSpeed: 4,
  wallTop: 5,
  wallBottom: 6,
  wallLeft: 7,
  wallRight: 8,
  velocityX: 9,
  velocityY: 10,
});
export const SENSOR_DISTANCE_SCALE = 700;
export const CLOSING_SPEED_SCALE = 260;

export function getEpisodeStepCount(world: Readonly<WorldConfig> = WORLD_CONFIG) {
  if (!Number.isFinite(world.fixedDt) || world.fixedDt <= 0) {
    throw new RangeError("fixedDt must be finite and greater than zero.");
  }
  if (!Number.isFinite(world.episodeSeconds) || world.episodeSeconds <= 0) {
    throw new RangeError("episodeSeconds must be finite and greater than zero.");
  }

  const stepCount = world.episodeSeconds / world.fixedDt;
  const roundedStepCount = Math.round(stepCount);

  if (!Number.isFinite(stepCount) || Math.abs(stepCount - roundedStepCount) > 1e-9) {
    throw new Error("Episode duration must contain a whole number of fixed steps.");
  }

  return roundedStepCount;
}

export const EPISODE_STEP_COUNT = getEpisodeStepCount();
