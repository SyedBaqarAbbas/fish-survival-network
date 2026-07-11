import { describe, expect, it } from "vitest";

import { FISH_CONFIG, PREDATOR_CONFIG, SPAWN_CONFIG, WORLD_CONFIG } from "./config";
import { createEpisodeSpawnLayout, createSpawnLayout } from "./spawning";

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

describe("spawn layouts", () => {
  it("is identical for the same seed", () => {
    expect(createSpawnLayout({ seed: 92, fishCount: 48 })).toEqual(
      createSpawnLayout({ seed: 92, fishCount: 48 }),
    );
  });

  it("keeps 48 fish inside margins and separated", () => {
    const layout = createSpawnLayout({ seed: 11, fishCount: 48 });

    expect(layout.predator.x).toBeGreaterThanOrEqual(
      SPAWN_CONFIG.wallMargin + PREDATOR_CONFIG.radius,
    );
    expect(layout.predator.x).toBeLessThanOrEqual(
      WORLD_CONFIG.width - SPAWN_CONFIG.wallMargin - PREDATOR_CONFIG.radius,
    );

    for (let index = 0; index < layout.fish.length; index += 1) {
      const fish = layout.fish[index];
      expect(fish.x).toBeGreaterThanOrEqual(
        SPAWN_CONFIG.wallMargin + FISH_CONFIG.radius,
      );
      expect(fish.x).toBeLessThanOrEqual(
        WORLD_CONFIG.width - SPAWN_CONFIG.wallMargin - FISH_CONFIG.radius,
      );
      expect(fish.y).toBeGreaterThanOrEqual(
        SPAWN_CONFIG.wallMargin + FISH_CONFIG.radius,
      );
      expect(fish.y).toBeLessThanOrEqual(
        WORLD_CONFIG.height - SPAWN_CONFIG.wallMargin - FISH_CONFIG.radius,
      );
      expect(distance(fish, layout.predator)).toBeGreaterThanOrEqual(
        SPAWN_CONFIG.minFishPredatorDistance,
      );

      for (let previous = 0; previous < index; previous += 1) {
        expect(distance(fish, layout.fish[previous])).toBeGreaterThanOrEqual(
          SPAWN_CONFIG.minFishSpacing,
        );
      }
    }
  });

  it("changes layouts across derived episodes and generations", () => {
    const base = { runSeed: 4, generation: 3, episodeIndex: 2 };
    expect(createEpisodeSpawnLayout(base)).not.toEqual(
      createEpisodeSpawnLayout({ ...base, episodeIndex: 3 }),
    );
    expect(createEpisodeSpawnLayout(base)).not.toEqual(
      createEpisodeSpawnLayout({ ...base, generation: 4 }),
    );
  });

  it("fails deterministically when constraints are impossible", () => {
    const options = {
      seed: 1,
      spawn: {
        ...SPAWN_CONFIG,
        maxPlacementAttempts: 4,
        minFishPredatorDistance: 10_000,
      },
    };
    expect(() => createSpawnLayout(options)).toThrow(
      "Unable to place fish 0 after 4 attempts.",
    );
    expect(() => createSpawnLayout(options)).toThrow(
      "Unable to place fish 0 after 4 attempts.",
    );
  });

  it("rejects invalid geometry before consuming random values", () => {
    expect(() =>
      createSpawnLayout({
        seed: 1,
        spawn: { ...SPAWN_CONFIG, wallMargin: -1 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createSpawnLayout({
        seed: 1,
        world: { ...WORLD_CONFIG, width: 100 },
      }),
    ).toThrow("World is too small");
  });
});
