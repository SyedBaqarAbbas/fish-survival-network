import { describe, expect, it } from "vitest";

import { WORLD_CONFIG } from "./config";
import { integrateAgent, resolveWallCollisions } from "./physics";
import {
  findNearestLivingFish,
  scriptedFishSteering,
  scriptedPredatorSteering,
} from "./steering";
import { makeFish, makePredator } from "./__tests__/fixtures";

describe("scripted steering", () => {
  it("selects the nearest living fish with stable tie ordering", () => {
    const predator = makePredator({ x: 100, y: 100 });
    const first = makeFish({ id: 4, x: 200, y: 100 });
    const tied = makeFish({ id: 7, x: 100, y: 200 });
    const closerDead = makeFish({ id: 2, x: 101, y: 100, alive: false });
    expect(findNearestLivingFish(predator, [first, tied, closerDead])).toBe(first);
  });

  it("aims at a bounded predicted target position", () => {
    const predator = makePredator({ x: 0, y: 0 });
    const fish = makeFish({ x: 145, y: 0, vy: 100 });
    const steering = scriptedPredatorSteering(predator, fish);
    const expectedMagnitude = Math.hypot(145, 70);
    expect(steering.x).toBeCloseTo(145 / expectedMagnitude);
    expect(steering.y).toBeCloseTo(70 / expectedMagnitude);
  });

  it("returns finite zero steering at the target position", () => {
    const predator = makePredator({ x: 100, y: 100 });
    const fish = makeFish({ x: 100, y: 100 });
    expect(scriptedPredatorSteering(predator, fish)).toEqual({ x: 0, y: 0 });
  });

  it("uses a late lateral dodge and turns away from nearby walls", () => {
    const predator = makePredator({ x: 100, y: 350, vx: 145 });
    const fish = makeFish({ id: 0, x: 240, y: 350 });
    const dodge = scriptedFishSteering(fish, predator);
    expect(Math.abs(dodge.y)).toBeGreaterThan(Math.abs(dodge.x));

    const nearLeftWall = makeFish({ x: 20, y: 350 });
    const wallAvoidance = scriptedFishSteering(
      nearLeftWall,
      makePredator({ x: 300, y: 350 }),
    );
    expect(wallAvoidance.x).toBeGreaterThan(0);
  });

  it("keeps pursuit acceleration bounded and visibly overshoots a perpendicular dodge", () => {
    const predator = makePredator({ x: 100, y: 350 });
    const fish = makeFish({ x: 350, y: 350 });
    const initialDistance = Math.hypot(fish.x - predator.x, fish.y - predator.y);

    for (let step = 0; step < 60; step += 1) {
      integrateAgent(
        predator,
        scriptedPredatorSteering(predator, fish),
        WORLD_CONFIG.fixedDt,
      );
    }

    const distanceAtDodge = Math.hypot(
      fish.x - predator.x,
      fish.y - predator.y,
    );
    expect(distanceAtDodge).toBeLessThan(initialDistance);

    const formerInterceptX = fish.x;
    let crossedFormerIntercept = false;
    let recoveredHeading = false;
    let closestDistance = Number.POSITIVE_INFINITY;
    let greatestDistanceAfterCross = 0;
    let previousPredatorVelocityX = predator.vx;
    let previousPredatorVelocityY = predator.vy;

    for (let step = 0; step < 180; step += 1) {
      integrateAgent(fish, { x: 0, y: -1 }, WORLD_CONFIG.fixedDt);
      const steering = scriptedPredatorSteering(predator, fish);
      integrateAgent(predator, steering, WORLD_CONFIG.fixedDt);
      resolveWallCollisions(predator);

      const velocityDelta = Math.hypot(
        predator.vx - previousPredatorVelocityX,
        predator.vy - previousPredatorVelocityY,
      );
      expect(velocityDelta).toBeLessThanOrEqual(
        predator.maxAcceleration * WORLD_CONFIG.fixedDt + 1e-9,
      );
      expect(Math.hypot(predator.vx, predator.vy)).toBeLessThanOrEqual(
        predator.maxSpeed + 1e-9,
      );
      previousPredatorVelocityX = predator.vx;
      previousPredatorVelocityY = predator.vy;
      const currentDistance = Math.hypot(
        fish.x - predator.x,
        fish.y - predator.y,
      );
      closestDistance = Math.min(closestDistance, currentDistance);
      if (predator.x > formerInterceptX + 5) crossedFormerIntercept = true;
      if (crossedFormerIntercept) {
        greatestDistanceAfterCross = Math.max(
          greatestDistanceAfterCross,
          currentDistance,
        );
      }
      if (crossedFormerIntercept && predator.vx < 0) recoveredHeading = true;
    }

    expect(crossedFormerIntercept).toBe(true);
    expect(greatestDistanceAfterCross).toBeGreaterThan(closestDistance + 20);
    expect(recoveredHeading).toBe(true);
  });
});
