export interface WorldTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  viewHeight: number;
  viewWidth: number;
  worldHeight: number;
  worldWidth: number;
}

function requirePositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero.`);
  }
}

export function containWorld(
  viewWidth: number,
  viewHeight: number,
  worldWidth: number,
  worldHeight: number,
): WorldTransform {
  requirePositiveFinite(viewWidth, "View width");
  requirePositiveFinite(viewHeight, "View height");
  requirePositiveFinite(worldWidth, "World width");
  requirePositiveFinite(worldHeight, "World height");

  const scale = Math.min(viewWidth / worldWidth, viewHeight / worldHeight);
  return {
    offsetX: (viewWidth - worldWidth * scale) / 2,
    offsetY: (viewHeight - worldHeight * scale) / 2,
    scale,
    viewHeight,
    viewWidth,
    worldHeight,
    worldWidth,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: Readonly<WorldTransform>,
) {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    throw new RangeError("Screen coordinates must be finite.");
  }

  return {
    x: (screenX - transform.offsetX) / transform.scale,
    y: (screenY - transform.offsetY) / transform.scale,
  };
}

export function interpolationAlpha(
  previousSimulationTime: number,
  currentSimulationTime: number,
  currentReceivedAt: number,
  renderTime: number,
  speed: number,
) {
  if (
    !Number.isFinite(previousSimulationTime) ||
    !Number.isFinite(currentSimulationTime) ||
    !Number.isFinite(currentReceivedAt) ||
    !Number.isFinite(renderTime)
  ) {
    return 1;
  }
  if (!Number.isFinite(speed) || speed <= 0) return 1;

  const simulationInterval = currentSimulationTime - previousSimulationTime;
  if (simulationInterval <= 0) return 1;
  const wallInterval = (simulationInterval * 1_000) / speed;
  const alpha = (renderTime - currentReceivedAt) / wallInterval;
  return Math.max(0, Math.min(1, alpha));
}

export function interpolateValues(
  previous: Float32Array,
  current: Float32Array,
  alpha: number,
  target: Float32Array,
) {
  if (previous.length !== current.length || current.length !== target.length) {
    throw new RangeError("Interpolation arrays must have matching lengths.");
  }
  const amount = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  for (let index = 0; index < target.length; index += 1) {
    target[index] = previous[index] + (current[index] - previous[index]) * amount;
  }
  return target;
}

export function findFishAtPoint(
  positions: Float32Array,
  alive: Uint8Array,
  worldX: number,
  worldY: number,
  hitRadius: number,
) {
  if (positions.length !== alive.length * 2) {
    throw new RangeError("Fish positions must contain two values per alive flag.");
  }
  if (
    !Number.isFinite(worldX) ||
    !Number.isFinite(worldY) ||
    !Number.isFinite(hitRadius) ||
    hitRadius < 0
  ) {
    return null;
  }

  const maximumDistanceSquared = hitRadius * hitRadius;
  let bestIndex: number | null = null;
  let bestDistanceSquared = maximumDistanceSquared;

  for (let fishIndex = 0; fishIndex < alive.length; fishIndex += 1) {
    if (alive[fishIndex] === 0) continue;
    const offset = fishIndex * 2;
    const dx = positions[offset] - worldX;
    const dy = positions[offset + 1] - worldY;
    const distanceSquared = dx * dx + dy * dy;
    if (
      distanceSquared < bestDistanceSquared ||
      (distanceSquared === bestDistanceSquared &&
        (bestIndex === null || fishIndex < bestIndex))
    ) {
      bestIndex = fishIndex;
      bestDistanceSquared = distanceSquared;
    }
  }
  return bestIndex;
}
