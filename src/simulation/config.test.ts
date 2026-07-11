import { describe, expect, it } from "vitest";

import { EPISODE_STEP_COUNT, getEpisodeStepCount, WORLD_CONFIG } from "./config";

describe("simulation configuration", () => {
  it("defines exactly 900 steps for the default episode", () => {
    expect(EPISODE_STEP_COUNT).toBe(900);
    expect(getEpisodeStepCount()).toBe(900);
  });

  it("rejects invalid or fractional episode horizons", () => {
    expect(() =>
      getEpisodeStepCount({ ...WORLD_CONFIG, fixedDt: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      getEpisodeStepCount({ ...WORLD_CONFIG, episodeSeconds: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      getEpisodeStepCount({ ...WORLD_CONFIG, episodeSeconds: 1, fixedDt: 0.3 }),
    ).toThrow("whole number of fixed steps");
  });
});
