import { WALL_RESTITUTION, WORLD_CONFIG } from "./config";
import type { AgentState, Steering, WorldConfig } from "./types";

export const WALL_CONTACT = Object.freeze({
  left: 1,
  right: 2,
  top: 4,
  bottom: 8,
});

export interface WallCollisionResult {
  contactMask: number;
  impactCount: number;
}

function requireFiniteSteering(steering: Readonly<Steering>) {
  if (!Number.isFinite(steering.x) || !Number.isFinite(steering.y)) {
    throw new RangeError("Steering components must be finite.");
  }
}

export function integrateAgent(
  agent: AgentState,
  steering: Readonly<Steering>,
  dt: number,
) {
  if (!agent.alive) return;
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError("dt must be finite and greater than zero.");
  }
  requireFiniteSteering(steering);

  let steeringX = steering.x;
  let steeringY = steering.y;
  const steeringMagnitude = Math.hypot(steeringX, steeringY);
  if (steeringMagnitude > 1) {
    steeringX /= steeringMagnitude;
    steeringY /= steeringMagnitude;
  }

  agent.vx += steeringX * agent.maxAcceleration * dt;
  agent.vy += steeringY * agent.maxAcceleration * dt;

  const speed = Math.hypot(agent.vx, agent.vy);
  if (speed > agent.maxSpeed) {
    agent.vx = (agent.vx / speed) * agent.maxSpeed;
    agent.vy = (agent.vy / speed) * agent.maxSpeed;
  }

  agent.x += agent.vx * dt;
  agent.y += agent.vy * dt;
}

export function resolveWallCollisions(
  agent: AgentState,
  previousContactMask = 0,
  world: Readonly<WorldConfig> = WORLD_CONFIG,
  restitution = WALL_RESTITUTION,
): WallCollisionResult {
  if (!Number.isFinite(restitution) || restitution < 0 || restitution > 1) {
    throw new RangeError("restitution must be between zero and one.");
  }

  let contactMask = 0;
  let impactCount = 0;
  const minimumX = agent.radius;
  const maximumX = world.width - agent.radius;
  const minimumY = agent.radius;
  const maximumY = world.height - agent.radius;

  // Keep an active side latched until the agent actually moves back into the tank.
  const leftCollision =
    agent.x < minimumX ||
    (agent.x === minimumX && agent.vx < 0) ||
    ((previousContactMask & WALL_CONTACT.left) !== 0 && agent.x === minimumX);
  const rightCollision =
    agent.x > maximumX ||
    (agent.x === maximumX && agent.vx > 0) ||
    ((previousContactMask & WALL_CONTACT.right) !== 0 && agent.x === maximumX);
  const topCollision =
    agent.y < minimumY ||
    (agent.y === minimumY && agent.vy < 0) ||
    ((previousContactMask & WALL_CONTACT.top) !== 0 && agent.y === minimumY);
  const bottomCollision =
    agent.y > maximumY ||
    (agent.y === maximumY && agent.vy > 0) ||
    ((previousContactMask & WALL_CONTACT.bottom) !== 0 && agent.y === maximumY);

  if (leftCollision) {
    contactMask |= WALL_CONTACT.left;
    if ((previousContactMask & WALL_CONTACT.left) === 0) impactCount += 1;
    agent.x = minimumX;
    if (agent.vx < 0) agent.vx = Math.abs(agent.vx) * restitution;
  } else if (rightCollision) {
    contactMask |= WALL_CONTACT.right;
    if ((previousContactMask & WALL_CONTACT.right) === 0) impactCount += 1;
    agent.x = maximumX;
    if (agent.vx > 0) agent.vx = -Math.abs(agent.vx) * restitution;
  }

  if (topCollision) {
    contactMask |= WALL_CONTACT.top;
    if ((previousContactMask & WALL_CONTACT.top) === 0) impactCount += 1;
    agent.y = minimumY;
    if (agent.vy < 0) agent.vy = Math.abs(agent.vy) * restitution;
  } else if (bottomCollision) {
    contactMask |= WALL_CONTACT.bottom;
    if ((previousContactMask & WALL_CONTACT.bottom) === 0) impactCount += 1;
    agent.y = maximumY;
    if (agent.vy > 0) agent.vy = -Math.abs(agent.vy) * restitution;
  }

  return { contactMask, impactCount };
}

export function agentsOverlap(first: Readonly<AgentState>, second: Readonly<AgentState>) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const collisionRadius = first.radius + second.radius;
  return dx * dx + dy * dy <= collisionRadius * collisionRadius;
}
