import {
  CLOSING_SPEED_SCALE,
  FISH_INPUT_COUNT,
  FISH_INPUT_INDEX,
  SENSOR_DISTANCE_SCALE,
  WORLD_CONFIG,
} from "./config";
import type { AgentState, CurriculumLevel, WorldConfig } from "./types";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function calculateClosingSpeed(
  fish: Readonly<AgentState>,
  predator: Readonly<AgentState>,
) {
  const dx = predator.x - fish.x;
  const dy = predator.y - fish.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= Number.EPSILON) return 0;

  const directionX = dx / distance;
  const directionY = dy / distance;
  const relativeVelocityX = predator.vx - fish.vx;
  const relativeVelocityY = predator.vy - fish.vy;
  return -(directionX * relativeVelocityX + directionY * relativeVelocityY);
}

export function observeFish(
  fish: Readonly<AgentState>,
  predator: Readonly<AgentState>,
  level: CurriculumLevel,
  world: Readonly<WorldConfig> = WORLD_CONFIG,
  target = new Float32Array(FISH_INPUT_COUNT),
) {
  if (target.length !== FISH_INPUT_COUNT) {
    throw new RangeError(`Fish observation target must contain ${FISH_INPUT_COUNT} values.`);
  }

  target.fill(0);
  target[FISH_INPUT_INDEX.bias] = 1;

  const dx = predator.x - fish.x;
  const dy = predator.y - fish.y;
  const distance = Math.hypot(dx, dy);
  const safeDistance = Math.max(distance, Number.EPSILON);

  if (level >= 1) {
    target[FISH_INPUT_INDEX.distance] = clamp(distance / SENSOR_DISTANCE_SCALE, 0, 1);
  }
  if (level >= 2) {
    target[FISH_INPUT_INDEX.directionX] = clamp(dx / safeDistance, -1, 1);
    target[FISH_INPUT_INDEX.directionY] = clamp(dy / safeDistance, -1, 1);
  }
  if (level >= 3) {
    target[FISH_INPUT_INDEX.closingSpeed] = clamp(
      calculateClosingSpeed(fish, predator) / CLOSING_SPEED_SCALE,
      -1,
      1,
    );
  }
  if (level >= 4) {
    target[FISH_INPUT_INDEX.wallTop] = clamp(fish.y / world.height, 0, 1);
    target[FISH_INPUT_INDEX.wallBottom] = clamp(
      (world.height - fish.y) / world.height,
      0,
      1,
    );
  }
  if (level >= 5) {
    target[FISH_INPUT_INDEX.wallLeft] = clamp(fish.x / world.width, 0, 1);
    target[FISH_INPUT_INDEX.wallRight] = clamp(
      (world.width - fish.x) / world.width,
      0,
      1,
    );
  }
  if (level >= 6) {
    target[FISH_INPUT_INDEX.velocityX] = clamp(fish.vx / fish.maxSpeed, -1, 1);
    target[FISH_INPUT_INDEX.velocityY] = clamp(fish.vy / fish.maxSpeed, -1, 1);
  }

  return target;
}
