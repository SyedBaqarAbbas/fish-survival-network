import type { CSSProperties } from "react";

import {
  assertGenomeShape,
  FISH_NETWORK_TOPOLOGY,
  isInputUnlocked,
  type NetworkGenome,
} from "@/evolution";
import type { ReplayActivationEvent } from "@/replay";
import type { CurriculumLevel } from "@/simulation";

import styles from "./NeuralGraph.module.css";

const VIEWBOX_WIDTH = 620;
const VIEWBOX_HEIGHT = 340;
const INPUT_X = 108;
const HIDDEN_X = 348;
const OUTPUT_X = 545;
const NODE_TOP = 38;
const NODE_BOTTOM = 316;

const POSITIVE_COLOR = "#ff2794";
const NEGATIVE_COLOR = "#f4f1f6";
const ZERO_COLOR = "#716b76";
const LOCKED_COLOR = "#4e4953";

const INPUT_LABELS = [
  "bias",
  "distance",
  "dir x",
  "dir y",
  "closing",
  "wall top",
  "wall bottom",
  "wall left",
  "wall right",
  "velocity x",
  "velocity y",
] as const;

const OUTPUT_LABELS = ["steer x", "steer y"] as const;

export interface NeuralGraphProps {
  activation?: Readonly<ReplayActivationEvent>;
  genome: Readonly<NetworkGenome>;
  level: CurriculumLevel;
  reducedEffects?: boolean;
}

type EdgeLayer = "input-hidden" | "hidden-output";
type NodeKind = "input" | "hidden" | "output";

function distributeNodes(
  count: number,
  top = NODE_TOP,
  bottom = NODE_BOTTOM,
) {
  return Array.from({ length: count }, (_, index) =>
    count === 1
      ? (top + bottom) / 2
      : top + (index * (bottom - top)) / (count - 1),
  );
}

function requireFishTopology(genome: Readonly<NetworkGenome>) {
  assertGenomeShape(genome);
  if (
    genome.inputCount !== FISH_NETWORK_TOPOLOGY.inputCount ||
    genome.hiddenCount !== FISH_NETWORK_TOPOLOGY.hiddenCount ||
    genome.outputCount !== FISH_NETWORK_TOPOLOGY.outputCount
  ) {
    throw new RangeError("NeuralGraph requires the 11 -> 8 -> 2 fish topology.");
  }
}

function matchingActivation(
  genome: Readonly<NetworkGenome>,
  activation: Readonly<ReplayActivationEvent> | undefined,
) {
  if (
    activation?.genomeId !== genome.id ||
    activation.inputs.length !== genome.inputCount ||
    activation.hidden.length !== genome.hiddenCount ||
    activation.outputs.length !== genome.outputCount
  ) {
    return undefined;
  }
  return activation;
}

function edgeSign(weight: number) {
  if (weight > 0) return "positive" as const;
  if (weight < 0) return "negative" as const;
  return "zero" as const;
}

function edgeColor(weight: number, locked: boolean) {
  if (locked) return LOCKED_COLOR;
  if (weight > 0) return POSITIVE_COLOR;
  if (weight < 0) return NEGATIVE_COLOR;
  return ZERO_COLOR;
}

function activationStrength(value: number | undefined) {
  return value === undefined ? 0 : Math.min(1, Math.abs(value));
}

function nodeColor(value: number | undefined, locked: boolean) {
  if (locked) return LOCKED_COLOR;
  if (value === undefined || value === 0) return ZERO_COLOR;
  return value > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

interface EdgeProps {
  activity: number;
  layer: EdgeLayer;
  locked?: boolean;
  maximumMagnitude: number;
  sourceIndex: number;
  sourceX: number;
  sourceY: number;
  targetIndex: number;
  targetX: number;
  targetY: number;
  weight: number;
}

function Edge({
  activity,
  layer,
  locked = false,
  maximumMagnitude,
  sourceIndex,
  sourceX,
  sourceY,
  targetIndex,
  targetX,
  targetY,
  weight,
}: EdgeProps) {
  const magnitude = Math.abs(weight) / maximumMagnitude;
  const activityBrightness = 0.68 + activity * 0.32;
  const opacity = locked
    ? 0.08
    : (0.12 + magnitude * 0.7) * activityBrightness;
  const width = 0.55 + magnitude * 2.35;

  return (
    <line
      className={styles.edge}
      data-edge-layer={layer}
      data-edge-sign={edgeSign(weight)}
      data-edge-type={
        layer === "input-hidden" ? "input-to-hidden" : "hidden-to-output"
      }
      data-edge-weight={String(weight)}
      data-locked={String(locked)}
      data-source-index={sourceIndex}
      data-target-index={targetIndex}
      opacity={opacity}
      stroke={edgeColor(weight, locked)}
      strokeWidth={width}
      vectorEffect="non-scaling-stroke"
      x1={sourceX}
      x2={targetX}
      y1={sourceY}
      y2={targetY}
    />
  );
}

interface NodeProps {
  activation: number | undefined;
  index: number;
  kind: NodeKind;
  locked?: boolean;
  reducedEffects: boolean;
  x: number;
  y: number;
}

function Node({
  activation,
  index,
  kind,
  locked = false,
  reducedEffects,
  x,
  y,
}: NodeProps) {
  const strength = activationStrength(activation);
  const live = activation !== undefined && !locked;
  const glow = live && strength >= 0.55 && !reducedEffects;
  const radius = kind === "output" ? 8 : 6;
  const nodeStyle = {
    "--node-color": nodeColor(activation, locked),
  } as CSSProperties;

  return (
    <g
      className={styles.node}
      data-glow={String(glow)}
      data-node-activation={activation === undefined ? "" : String(activation)}
      data-node-index={index}
      data-node-kind={kind}
      data-node-locked={String(locked)}
      style={nodeStyle}
      transform={`translate(${x} ${y})`}
    >
      <circle
        className={glow ? styles.glowingNode : styles.nodeCircle}
        fill="var(--node-color)"
        fillOpacity={live ? 0.16 + strength * 0.78 : locked ? 0.1 : 0.16}
        r={radius}
        stroke="var(--node-color)"
        strokeOpacity={live ? 0.55 + strength * 0.45 : locked ? 0.35 : 0.72}
        strokeWidth={kind === "output" ? 1.8 : 1.35}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export function NeuralGraph({
  activation,
  genome,
  level,
  reducedEffects = false,
}: NeuralGraphProps) {
  requireFishTopology(genome);
  const liveActivation = matchingActivation(genome, activation);
  const inputY = distributeNodes(genome.inputCount);
  const hiddenY = distributeNodes(genome.hiddenCount);
  const outputY = distributeNodes(genome.outputCount, 126, 214);
  const maximumMagnitude = Math.max(
    1,
    ...genome.inputToHidden.map(Math.abs),
    ...genome.hiddenToOutput.map(Math.abs),
  );

  return (
    <svg
      aria-label={`Live neural policy for genome ${genome.id}`}
      className={`${styles.graph} ${reducedEffects ? styles.reducedEffects : ""}`}
      data-activation-genome-id={liveActivation?.genomeId ?? ""}
      data-activation-sequence={liveActivation?.sequence ?? ""}
      data-genome-id={genome.id}
      data-has-activation={String(liveActivation !== undefined)}
      data-level={level}
      data-reduced-effects={String(reducedEffects)}
      data-testid="neural-graph"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    >
      <title>{`Live neural policy for genome ${genome.id}`}</title>
      <desc>
        Eleven sensor inputs connect to eight hidden neurons and two steering
        outputs. Pink edges are positive and off-white edges are negative.
      </desc>

      <g aria-hidden="true" className={styles.columnLabels}>
        <text textAnchor="end" x={INPUT_X - 17} y="18">
          sensors
        </text>
        <text textAnchor="middle" x={HIDDEN_X} y="18">
          hidden
        </text>
        <text textAnchor="start" x={OUTPUT_X + 17} y="18">
          steering
        </text>
      </g>

      <g aria-hidden="true" data-edge-layer="input-hidden">
        {inputY.flatMap((sourceY, inputIndex) => {
          const locked = !isInputUnlocked(inputIndex, level);
          return hiddenY.map((targetY, hiddenIndex) => {
            const weight =
              genome.inputToHidden[
                hiddenIndex * genome.inputCount + inputIndex
              ];
            const activity = Math.max(
              activationStrength(liveActivation?.inputs[inputIndex]),
              activationStrength(liveActivation?.hidden[hiddenIndex]),
            );
            return (
              <Edge
                activity={activity}
                key={`input-${inputIndex}-hidden-${hiddenIndex}`}
                layer="input-hidden"
                locked={locked}
                maximumMagnitude={maximumMagnitude}
                sourceIndex={inputIndex}
                sourceX={INPUT_X}
                sourceY={sourceY}
                targetIndex={hiddenIndex}
                targetX={HIDDEN_X}
                targetY={targetY}
                weight={weight}
              />
            );
          });
        })}
      </g>

      <g aria-hidden="true" data-edge-layer="hidden-output">
        {hiddenY.flatMap((sourceY, hiddenIndex) =>
          outputY.map((targetY, outputIndex) => {
            const weight =
              genome.hiddenToOutput[
                outputIndex * genome.hiddenCount + hiddenIndex
              ];
            const activity = Math.max(
              activationStrength(liveActivation?.hidden[hiddenIndex]),
              activationStrength(liveActivation?.outputs[outputIndex]),
            );
            return (
              <Edge
                activity={activity}
                key={`hidden-${hiddenIndex}-output-${outputIndex}`}
                layer="hidden-output"
                maximumMagnitude={maximumMagnitude}
                sourceIndex={hiddenIndex}
                sourceX={HIDDEN_X}
                sourceY={sourceY}
                targetIndex={outputIndex}
                targetX={OUTPUT_X}
                targetY={targetY}
                weight={weight}
              />
            );
          }),
        )}
      </g>

      <g aria-hidden="true" className={styles.nodes}>
        {inputY.map((y, index) => {
          const locked = !isInputUnlocked(index, level);
          return (
            <g key={`input-node-${index}`}>
              <text
                className={locked ? styles.lockedLabel : styles.inputLabel}
                textAnchor="end"
                x={INPUT_X - 17}
                y={y + 4}
              >
                {INPUT_LABELS[index]}
              </text>
              <Node
                activation={locked ? undefined : liveActivation?.inputs[index]}
                index={index}
                kind="input"
                locked={locked}
                reducedEffects={reducedEffects}
                x={INPUT_X}
                y={y}
              />
            </g>
          );
        })}

        {hiddenY.map((y, index) => (
          <Node
            activation={liveActivation?.hidden[index]}
            index={index}
            key={`hidden-node-${index}`}
            kind="hidden"
            reducedEffects={reducedEffects}
            x={HIDDEN_X}
            y={y}
          />
        ))}

        {outputY.map((y, index) => (
          <g key={`output-node-${index}`}>
            <Node
              activation={liveActivation?.outputs[index]}
              index={index}
              kind="output"
              reducedEffects={reducedEffects}
              x={OUTPUT_X}
              y={y}
            />
            <text
              className={styles.outputLabel}
              textAnchor="start"
              x={OUTPUT_X + 17}
              y={y + 4}
            >
              {OUTPUT_LABELS[index]}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
