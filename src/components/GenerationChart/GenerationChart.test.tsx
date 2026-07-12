import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GenerationMetric } from "@/persistence";

import {
  buildGenerationChartSeries,
  GenerationChart,
} from "./GenerationChart";

function metric(
  generation: number,
  overrides: Partial<GenerationMetric> = {},
): GenerationMetric {
  return {
    generation,
    level: 0,
    bestFitness: generation + 4,
    meanFitness: generation + 2,
    championSurvivalRate: generation / 10,
    medianSurvivalRate: generation / 20,
    durationMilliseconds: 10,
    curriculumAdvanced: false,
    ...overrides,
  };
}

describe("GenerationChart", () => {
  it("renders a bounded empty state", () => {
    render(<GenerationChart metrics={[]} />);

    expect(screen.getByRole("img", { name: /generation history/i })).toBeInTheDocument();
    expect(screen.getByText(/history begins/i)).toBeInTheDocument();
  });

  it("renders all three series and level transitions", () => {
    const { container } = render(
      <GenerationChart
        metrics={[
          metric(0),
          metric(1, { curriculumAdvanced: true }),
          metric(2, { level: 1 }),
        ]}
      />,
    );

    expect(container.querySelectorAll("polyline")).toHaveLength(3);
    expect(container.querySelector('[data-series="best-fitness"]')).toBeTruthy();
    expect(container.querySelector('[data-series="mean-fitness"]')).toBeTruthy();
    expect(container.querySelector('[data-series="champion-survival"]')).toBeTruthy();
    expect(container.querySelector('[data-generation="1"]')).toBeTruthy();
  });

  it("keeps chart coordinates within the plot for single and varied metrics", () => {
    const single = buildGenerationChartSeries([metric(7)]);
    expect(single.best[0]).toMatchObject({ generation: 7, x: 362, y: 28 });

    const varied = buildGenerationChartSeries([
      metric(3, { bestFitness: -2, meanFitness: -4, championSurvivalRate: 0 }),
      metric(8, { bestFitness: 12, meanFitness: 5, championSurvivalRate: 1 }),
    ]);
    for (const point of [...varied.best, ...varied.mean, ...varied.survival]) {
      expect(point.x).toBeGreaterThanOrEqual(42);
      expect(point.x).toBeLessThanOrEqual(682);
      expect(point.y).toBeGreaterThanOrEqual(28);
      expect(point.y).toBeLessThanOrEqual(144);
    }
  });
});
