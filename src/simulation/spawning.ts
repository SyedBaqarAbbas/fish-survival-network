import {
  FISH_CONFIG,
  PREDATOR_CONFIG,
  SPAWN_CONFIG,
  WORLD_CONFIG,
} from "./config";
import { deriveEpisodeSeed, SeededRandom } from "./random";
import type {
  AgentConfig,
  AgentState,
  SpawnConfig,
  SpawnLayout,
  Vector2,
  WorldConfig,
} from "./types";

export interface SpawnLayoutOptions {
  seed: number;
  fishCount?: number;
  world?: Readonly<WorldConfig>;
  spawn?: Readonly<SpawnConfig>;
}

export interface EpisodeSpawnLayoutOptions
  extends Omit<SpawnLayoutOptions, "seed"> {
  runSeed: number;
  generation: number;
  episodeIndex: number;
}

function squaredDistance(first: Vector2, second: Vector2) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function assertSpawnRange(
  world: Readonly<WorldConfig>,
  spawn: Readonly<SpawnConfig>,
  agent: Readonly<AgentConfig>,
) {
  const horizontalRoom = world.width - 2 * (spawn.wallMargin + agent.radius);
  const verticalRoom = world.height - 2 * (spawn.wallMargin + agent.radius);
  if (horizontalRoom <= 0 || verticalRoom <= 0) {
    throw new RangeError("World is too small for the configured spawn margin.");
  }
}

function samplePosition(
  random: SeededRandom,
  world: Readonly<WorldConfig>,
  spawn: Readonly<SpawnConfig>,
  agent: Readonly<AgentConfig>,
): Vector2 {
  const minimumX = spawn.wallMargin + agent.radius;
  const maximumX = world.width - spawn.wallMargin - agent.radius;
  const minimumY = spawn.wallMargin + agent.radius;
  const maximumY = world.height - spawn.wallMargin - agent.radius;

  return {
    x: random.nextBetween(minimumX, maximumX),
    y: random.nextBetween(minimumY, maximumY),
  };
}

function createAgent(
  id: number,
  position: Readonly<Vector2>,
  config: Readonly<AgentConfig>,
): AgentState {
  return {
    id,
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    radius: config.radius,
    maxSpeed: config.maxSpeed,
    maxAcceleration: config.maxAcceleration,
    alive: true,
  };
}

export function createSpawnLayout({
  seed,
  fishCount = 1,
  world = WORLD_CONFIG,
  spawn = SPAWN_CONFIG,
}: SpawnLayoutOptions): SpawnLayout {
  if (
    !Number.isFinite(world.width) ||
    !Number.isFinite(world.height) ||
    world.width <= 0 ||
    world.height <= 0
  ) {
    throw new RangeError("World dimensions must be finite and greater than zero.");
  }
  if (
    !Number.isFinite(spawn.wallMargin) ||
    !Number.isFinite(spawn.minFishPredatorDistance) ||
    !Number.isFinite(spawn.minFishSpacing) ||
    spawn.wallMargin < 0 ||
    spawn.minFishPredatorDistance < 0 ||
    spawn.minFishSpacing < 0
  ) {
    throw new RangeError("Spawn distances must be finite and non-negative.");
  }
  if (!Number.isSafeInteger(fishCount) || fishCount <= 0) {
    throw new RangeError("fishCount must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(spawn.maxPlacementAttempts) || spawn.maxPlacementAttempts <= 0) {
    throw new RangeError("maxPlacementAttempts must be a positive safe integer.");
  }

  assertSpawnRange(world, spawn, FISH_CONFIG);
  assertSpawnRange(world, spawn, PREDATOR_CONFIG);

  const random = new SeededRandom(seed);
  const predator = createAgent(
    -1,
    samplePosition(random, world, spawn, PREDATOR_CONFIG),
    PREDATOR_CONFIG,
  );
  const fish: AgentState[] = [];
  const predatorDistanceSquared = spawn.minFishPredatorDistance ** 2;
  const fishSpacingSquared = spawn.minFishSpacing ** 2;

  for (let fishIndex = 0; fishIndex < fishCount; fishIndex += 1) {
    let position: Vector2 | undefined;

    for (let attempt = 0; attempt < spawn.maxPlacementAttempts; attempt += 1) {
      const candidate = samplePosition(random, world, spawn, FISH_CONFIG);
      const clearOfPredator = squaredDistance(candidate, predator) >= predatorDistanceSquared;
      const clearOfFish = fish.every(
        (placedFish) => squaredDistance(candidate, placedFish) >= fishSpacingSquared,
      );

      if (clearOfPredator && clearOfFish) {
        position = candidate;
        break;
      }
    }

    if (!position) {
      throw new Error(
        `Unable to place fish ${fishIndex} after ${spawn.maxPlacementAttempts} attempts.`,
      );
    }

    fish.push(createAgent(fishIndex, position, FISH_CONFIG));
  }

  return { fish, predator };
}

export function createEpisodeSpawnLayout({
  runSeed,
  generation,
  episodeIndex,
  ...spawnOptions
}: EpisodeSpawnLayoutOptions) {
  return createSpawnLayout({
    ...spawnOptions,
    seed: deriveEpisodeSeed(runSeed, generation, episodeIndex),
  });
}
