import { describe, expect, it } from "vitest";

import {
  estimateSimulationRemainingMilliseconds,
  formatSimulationEta,
} from "./simulationPreparation";

describe("simulation preparation ETA", () => {
  it("estimates remaining time from completed training work", () => {
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 16,
        elapsedMilliseconds: 4_000,
        totalGenomes: 64,
      }),
    ).toBe(12_000);
  });

  it("uses the previous generation before live throughput is available", () => {
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 0,
        elapsedMilliseconds: 0,
        previousDurationMilliseconds: 8_000,
        totalGenomes: 64,
      }),
    ).toBe(8_000);
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 0,
        elapsedMilliseconds: 0,
        totalGenomes: 64,
      }),
    ).toBeNull();
  });

  it("clamps a completed generation to zero and rejects invalid samples", () => {
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 64,
        elapsedMilliseconds: 10_000,
        totalGenomes: 64,
      }),
    ).toBe(0);
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 65,
        elapsedMilliseconds: 10_000,
        totalGenomes: 64,
      }),
    ).toBeNull();
    expect(
      estimateSimulationRemainingMilliseconds({
        completedGenomes: 0,
        elapsedMilliseconds: Number.NaN,
        totalGenomes: 0,
      }),
    ).toBeNull();
  });

  it("formats compact, rounded-up ETAs", () => {
    expect(formatSimulationEta(null)).toBe("Estimating");
    expect(formatSimulationEta(0)).toBe("< 1 sec");
    expect(formatSimulationEta(1_001)).toBe("2 sec");
    expect(formatSimulationEta(60_000)).toBe("1 min");
    expect(formatSimulationEta(61_001)).toBe("1 min 2 sec");
  });
});
