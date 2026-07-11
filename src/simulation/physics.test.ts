import { describe, expect, it } from "vitest";

import { WORLD_CONFIG } from "./config";
import {
  agentsOverlap,
  integrateAgent,
  resolveWallCollisions,
  WALL_CONTACT,
} from "./physics";
import { makeFish, makePredator } from "./__tests__/fixtures";

describe("agent physics", () => {
  it("normalizes steering and clamps speed", () => {
    const fish = makeFish({ maxSpeed: 10, maxAcceleration: 100 });
    integrateAgent(fish, { x: 3, y: 4 }, 1);

    expect(Math.hypot(fish.vx, fish.vy)).toBeCloseTo(10);
    expect(fish.vx).toBeCloseTo(6);
    expect(fish.vy).toBeCloseTo(8);
    expect(fish.x).toBeCloseTo(506);
    expect(fish.y).toBeCloseTo(358);
  });

  it("reflects only outward normal velocity at 0.25 restitution", () => {
    const fish = makeFish({ x: 5, y: 200, vx: -40, vy: 13 });
    const collision = resolveWallCollisions(fish);

    expect(collision).toEqual({
      contactMask: WALL_CONTACT.left,
      impactCount: 1,
    });
    expect(fish.x).toBe(fish.radius);
    expect(fish.vx).toBe(10);
    expect(fish.vy).toBe(13);
  });

  it("counts one impact while acceleration holds an agent against a wall", () => {
    const fish = makeFish({ x: 7.01, vx: -1 });
    let contactMask = 0;
    let impacts = 0;

    for (let step = 0; step < 60; step += 1) {
      integrateAgent(fish, { x: -1, y: 0 }, WORLD_CONFIG.fixedDt);
      const collision = resolveWallCollisions(fish, contactMask);
      contactMask = collision.contactMask;
      impacts += collision.impactCount;
    }

    expect(impacts).toBe(1);
    expect(contactMask).toBe(WALL_CONTACT.left);
  });

  it("counts a new impact after leaving and returning", () => {
    const fish = makeFish({ x: 6, vx: -20 });
    const first = resolveWallCollisions(fish);
    expect(first.impactCount).toBe(1);

    fish.x = 30;
    fish.vx = 20;
    const departed = resolveWallCollisions(fish, first.contactMask);
    expect(departed.contactMask).toBe(0);

    fish.x = 6;
    fish.vx = -20;
    expect(resolveWallCollisions(fish, departed.contactMask).impactCount).toBe(1);
  });

  it("counts two contacted sides for a corner impact", () => {
    const fish = makeFish({ x: 0, y: 0, vx: -10, vy: -10 });
    const collision = resolveWallCollisions(fish);
    expect(collision.impactCount).toBe(2);
    expect(collision.contactMask).toBe(WALL_CONTACT.left | WALL_CONTACT.top);
  });

  it("uses inclusive radii for catch overlap", () => {
    const fish = makeFish({ x: 100, y: 100 });
    const predator = makePredator({ x: 129, y: 100 });
    expect(agentsOverlap(fish, predator)).toBe(true);
    predator.x = 129.0001;
    expect(agentsOverlap(fish, predator)).toBe(false);
  });
});
