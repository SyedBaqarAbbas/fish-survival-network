import type { GenerationMetric } from "@/persistence";

import styles from "./GenerationChart.module.css";

const WIDTH = 720;
const HEIGHT = 188;
const PLOT_LEFT = 42;
const PLOT_RIGHT = 682;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 144;

export interface GenerationChartProps {
  metrics: readonly Readonly<GenerationMetric>[];
}

interface ChartPoint {
  generation: number;
  x: number;
  y: number;
}

export interface GenerationChartSeries {
  best: ChartPoint[];
  mean: ChartPoint[];
  survival: ChartPoint[];
  transitions: ChartPoint[];
  fitnessMaximum: number;
  fitnessMinimum: number;
}

function scale(
  value: number,
  domainMinimum: number,
  domainMaximum: number,
  rangeMinimum: number,
  rangeMaximum: number,
) {
  if (domainMaximum === domainMinimum) return (rangeMinimum + rangeMaximum) / 2;
  const ratio = (value - domainMinimum) / (domainMaximum - domainMinimum);
  return rangeMinimum + ratio * (rangeMaximum - rangeMinimum);
}

export function buildGenerationChartSeries(
  metrics: readonly Readonly<GenerationMetric>[],
): GenerationChartSeries {
  if (metrics.length === 0) {
    return {
      best: [],
      mean: [],
      survival: [],
      transitions: [],
      fitnessMaximum: 0,
      fitnessMinimum: 0,
    };
  }

  const fitnessValues = metrics.flatMap((metric) => [
    metric.bestFitness,
    metric.meanFitness,
  ]);
  const fitnessMinimum = Math.min(...fitnessValues);
  const fitnessMaximum = Math.max(...fitnessValues);
  const firstGeneration = metrics[0].generation;
  const lastGeneration = metrics.at(-1)?.generation ?? firstGeneration;
  const xFor = (generation: number) =>
    scale(generation, firstGeneration, lastGeneration, PLOT_LEFT, PLOT_RIGHT);
  const fitnessY = (value: number) =>
    scale(value, fitnessMinimum, fitnessMaximum, PLOT_BOTTOM, PLOT_TOP);

  return {
    best: metrics.map((metric) => ({
      generation: metric.generation,
      x: xFor(metric.generation),
      y: fitnessY(metric.bestFitness),
    })),
    mean: metrics.map((metric) => ({
      generation: metric.generation,
      x: xFor(metric.generation),
      y: fitnessY(metric.meanFitness),
    })),
    survival: metrics.map((metric) => ({
      generation: metric.generation,
      x: xFor(metric.generation),
      y: scale(metric.championSurvivalRate, 0, 1, PLOT_BOTTOM, PLOT_TOP),
    })),
    transitions: metrics
      .filter((metric) => metric.curriculumAdvanced)
      .map((metric) => ({
        generation: metric.generation,
        x: xFor(metric.generation),
        y: PLOT_TOP,
      })),
    fitnessMaximum,
    fitnessMinimum,
  };
}

function pointList(points: readonly ChartPoint[]) {
  return points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

export function GenerationChart({ metrics }: GenerationChartProps) {
  const series = buildGenerationChartSeries(metrics);
  const firstGeneration = metrics[0]?.generation;
  const lastGeneration = metrics.at(-1)?.generation;

  return (
    <div className={styles.frame}>
      <div className={styles.plot}>
        <svg
          aria-label="Generation history for best fitness, mean fitness, and champion survival"
          className={styles.chart}
          data-testid="generation-chart"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <title>Generation history</title>
          <g className={styles.grid}>
            {[PLOT_TOP, (PLOT_TOP + PLOT_BOTTOM) / 2, PLOT_BOTTOM].map((y) => (
              <line key={y} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
            ))}
          </g>

          {metrics.length > 0 ? (
            <>
              <g aria-hidden="true" className={styles.transitions}>
                {series.transitions.map((point) => (
                  <line
                    data-generation={point.generation}
                    key={point.generation}
                    x1={point.x}
                    x2={point.x}
                    y1={PLOT_TOP}
                    y2={PLOT_BOTTOM}
                  />
                ))}
              </g>
              <polyline
                className={styles.mean}
                data-series="mean-fitness"
                fill="none"
                points={pointList(series.mean)}
              />
              <polyline
                className={styles.best}
                data-series="best-fitness"
                fill="none"
                points={pointList(series.best)}
              />
              <polyline
                className={styles.survival}
                data-series="champion-survival"
                fill="none"
                points={pointList(series.survival)}
              />
              {series.best.length === 1 ? (
                <g aria-hidden="true">
                  <circle className={styles.bestPoint} cx={series.best[0].x} cy={series.best[0].y} r="3" />
                  <circle className={styles.meanPoint} cx={series.mean[0].x} cy={series.mean[0].y} r="3" />
                  <circle className={styles.survivalPoint} cx={series.survival[0].x} cy={series.survival[0].y} r="3" />
                </g>
              ) : null}
            </>
          ) : null}
        </svg>
        {metrics.length === 0 ? (
          <p className={styles.empty}>History begins after the first training generation</p>
        ) : null}
        <span className={styles.fitnessMaximum}>{series.fitnessMaximum.toFixed(1)}</span>
        <span className={styles.fitnessMinimum}>{series.fitnessMinimum.toFixed(1)}</span>
        <span className={styles.survivalMaximum}>100%</span>
        <span className={styles.survivalMinimum}>0%</span>
      </div>
      <div className={styles.range}>
        <span>{firstGeneration === undefined ? "generation" : `gen ${firstGeneration}`}</span>
        <span>{lastGeneration === undefined ? "-" : `gen ${lastGeneration}`}</span>
      </div>
      <div aria-hidden="true" className={styles.legend}>
        <span><i className={styles.bestKey} />Best</span>
        <span><i className={styles.meanKey} />Mean</span>
        <span><i className={styles.survivalKey} />Survival</span>
        <span><i className={styles.transitionKey} />Level change</span>
      </div>
    </div>
  );
}
