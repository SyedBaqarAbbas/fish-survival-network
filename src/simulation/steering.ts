import { WORLD_CONFIG } from "./config";
import { calculateClosingSpeed } from "./sensors";
import type { AgentState, Steering, WorldConfig } from "./types";

const ZERO_STEERING: Readonly<Steering> = Object.freeze({ x: 0, y: 0 });

function normalize(x: number, y: number): Steering {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= Number.EPSILON) return { ...ZERO_STEERING };
  return { x: x / magnitude, y: y / magnitude };
}

export function findNearestLivingFish(
  predator: Readonly<AgentState>,
  fish: readonly Readonly<AgentState>[],
) {
  let nearest: Readonly<AgentState> | undefined;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const candidate of fish) {
    if (!candidate.alive) continue;
    const dx = candidate.x - predator.x;
    const dy = candidate.y - predator.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistanceSquared) {
      nearest = candidate;
      bestDistanceSquared = distanceSquared;
    }
  }

  return nearest;
}

export function scriptedPredatorSteering(
  predator: Readonly<AgentState>,
  target: Readonly<AgentState>,
): Steering {
  const distance = Math.hypot(target.x - predator.x, target.y - predator.y);
  const leadTime = Math.min(distance / predator.maxSpeed, 0.7);
  const predictedX = target.x + target.vx * leadTime;
  const predictedY = target.y + target.vy * leadTime;
  return normalize(predictedX - predator.x, predictedY - predator.y);
}

function wallAvoidance(
  fish: Readonly<AgentState>,
  world: Readonly<WorldConfig>,
  range = 100,
) {
  const left = Math.max(0, 1 - (fish.x - fish.radius) / range);
  const right = Math.max(0, 1 - (world.width - fish.x - fish.radius) / range);
  const top = Math.max(0, 1 - (fish.y - fish.radius) / range);
  const bottom = Math.max(0, 1 - (world.height - fish.y - fish.radius) / range);
  return {
    x: left * left - right * right,
    y: top * top - bottom * bottom,
  };
}

export function scriptedFishSteering(
  fish: Readonly<AgentState>,
  predator: Readonly<AgentState>,
  world: Readonly<WorldConfig> = WORLD_CONFIG,
): Steering {
  const predatorDx = predator.x - fish.x;
  const predatorDy = predator.y - fish.y;
  const distance = Math.max(Math.hypot(predatorDx, predatorDy), Number.EPSILON);
  const predatorDirectionX = predatorDx / distance;
  const predatorDirectionY = predatorDy / distance;
  const awayX = -predatorDirectionX;
  const awayY = -predatorDirectionY;
  const closingSpeed = calculateClosingSpeed(fish, predator);
  const dodgeSign = fish.id % 2 === 0 ? 1 : -1;
  const shouldDodge = distance < 180 && closingSpeed > 0;
  const dodgeX = -predatorDirectionY * dodgeSign;
  const dodgeY = predatorDirectionX * dodgeSign;
  const walls = wallAvoidance(fish, world);

  const desiredX =
    (shouldDodge ? awayX * 0.3 + dodgeX * 1.2 : awayX) + walls.x * 2;
  const desiredY =
    (shouldDodge ? awayY * 0.3 + dodgeY * 1.2 : awayY) + walls.y * 2;
  return normalize(desiredX, desiredY);
}
