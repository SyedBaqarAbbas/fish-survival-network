import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NetworkGenome } from "@/evolution";
import type { ReplayActivationEvent } from "@/replay";

import { NeuralGraph } from "./NeuralGraph";

function createGenome(id = "selected-genome"): NetworkGenome {
  const inputToHidden = new Float32Array(88);
  const hiddenToOutput = new Float32Array(16);
  inputToHidden.fill(0.25);
  hiddenToOutput.fill(-0.5);
  inputToHidden[0] = 0;
  inputToHidden[1] = 1;
  inputToHidden[2] = -2;

  return {
    id,
    inputCount: 11,
    hiddenCount: 8,
    outputCount: 2,
    inputToHidden,
    hiddenBias: new Float32Array(8),
    hiddenToOutput,
    outputBias: new Float32Array(2),
  };
}

function createActivation(
  genome: Readonly<NetworkGenome>,
  genomeId = genome.id,
): ReplayActivationEvent {
  return {
    type: "ACTIVATION",
    episodeId: 1,
    sequence: 9,
    simulationTime: 0.5,
    fishIndex: 3,
    genomeId,
    alive: true,
    fitness: 12.5,
    survivalRate: 0.75,
    inputs: new Float32Array([1, -0.5, 0.25, 0, 0.75, 0.4, 0.3, 0.2, 0.1, -1, 1]),
    hidden: new Float32Array([0.9, -0.8, 0.7, -0.6, 0.5, -0.4, 0.3, -0.2]),
    outputs: new Float32Array([0.85, -0.65]),
    inputToHidden: new Float32Array(genome.inputToHidden),
    hiddenToOutput: new Float32Array(genome.hiddenToOutput),
  };
}

function edge(
  graph: HTMLElement,
  type: "input-to-hidden" | "hidden-to-output",
  sourceIndex: number,
  targetIndex: number,
) {
  const value = graph.querySelector<SVGLineElement>(
    `[data-edge-type="${type}"][data-source-index="${sourceIndex}"][data-target-index="${targetIndex}"]`,
  );
  if (!value) throw new Error("Expected neural edge was not rendered.");
  return value;
}

function node(graph: HTMLElement, kind: string, index: number) {
  const value = graph.querySelector<SVGGElement>(
    `[data-node-kind="${kind}"][data-node-index="${index}"]`,
  );
  if (!value) throw new Error("Expected neural node was not rendered.");
  return value;
}

describe("NeuralGraph", () => {
  it("renders the fixed topology, canonical labels, and stable graph metadata", () => {
    const genome = createGenome();
    render(<NeuralGraph genome={genome} level={6} />);

    const graph = screen.getByRole("img", {
      name: `Live neural policy for genome ${genome.id}`,
    });
    expect(graph).toHaveAttribute("data-testid", "neural-graph");
    expect(graph).toHaveAttribute("data-genome-id", genome.id);
    expect(graph).toHaveAttribute("data-level", "6");
    expect(graph).toHaveAttribute("data-has-activation", "false");
    expect(graph.querySelectorAll('[data-edge-type="input-to-hidden"]')).toHaveLength(88);
    expect(graph.querySelectorAll('[data-edge-type="hidden-to-output"]')).toHaveLength(16);
    expect(graph.querySelectorAll("line")).toHaveLength(104);
    expect(graph.querySelectorAll('[data-node-kind="input"]')).toHaveLength(11);
    expect(graph.querySelectorAll('[data-node-kind="hidden"]')).toHaveLength(8);
    expect(graph.querySelectorAll('[data-node-kind="output"]')).toHaveLength(2);

    for (const label of [
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
      "steer x",
      "steer y",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("encodes weight sign and scales width and opacity by magnitude", () => {
    render(<NeuralGraph genome={createGenome()} level={6} />);
    const graph = screen.getByTestId("neural-graph");
    const zero = edge(graph, "input-to-hidden", 0, 0);
    const positive = edge(graph, "input-to-hidden", 1, 0);
    const negative = edge(graph, "input-to-hidden", 2, 0);

    expect(zero).toHaveAttribute("data-edge-layer", "input-hidden");
    expect(zero).toHaveAttribute("data-edge-sign", "zero");
    expect(zero).toHaveAttribute("stroke", "#716b76");
    expect(positive).toHaveAttribute("data-edge-sign", "positive");
    expect(positive).toHaveAttribute("data-edge-weight", "1");
    expect(positive).toHaveAttribute("stroke", "#ff2794");
    expect(negative).toHaveAttribute("data-edge-sign", "negative");
    expect(negative).toHaveAttribute("data-edge-weight", "-2");
    expect(negative).toHaveAttribute("stroke", "#f4f1f6");
    expect(Number(positive.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(zero.getAttribute("stroke-width")),
    );
    expect(Number(negative.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(positive.getAttribute("stroke-width")),
    );
    expect(Number(negative.getAttribute("opacity"))).toBeGreaterThan(
      Number(positive.getAttribute("opacity")),
    );
  });

  it("mutes inputs and their edges until the curriculum unlocks them", () => {
    render(<NeuralGraph genome={createGenome()} level={2} />);
    const graph = screen.getByTestId("neural-graph");

    expect(
      graph.querySelectorAll(
        '[data-node-kind="input"][data-node-locked="false"]',
      ),
    ).toHaveLength(4);
    expect(
      graph.querySelectorAll(
        '[data-node-kind="input"][data-node-locked="true"]',
      ),
    ).toHaveLength(7);
    expect(node(graph, "input", 3)).toHaveAttribute("data-node-locked", "false");
    expect(node(graph, "input", 4)).toHaveAttribute("data-node-locked", "true");
    expect(edge(graph, "input-to-hidden", 4, 0)).toHaveAttribute(
      "data-locked",
      "true",
    );
    expect(edge(graph, "input-to-hidden", 4, 0)).toHaveAttribute(
      "stroke",
      "#4e4953",
    );
  });

  it("uses only activation data belonging to the selected genome", () => {
    const genome = createGenome();
    const { rerender } = render(
      <NeuralGraph
        activation={createActivation(genome)}
        genome={genome}
        level={6}
      />,
    );
    const graph = screen.getByTestId("neural-graph");
    expect(graph).toHaveAttribute("data-has-activation", "true");
    expect(graph).toHaveAttribute("data-activation-genome-id", genome.id);
    expect(node(graph, "input", 0)).toHaveAttribute(
      "data-node-activation",
      "1",
    );
    expect(node(graph, "hidden", 0)).toHaveAttribute(
      "data-node-activation",
      expect.stringMatching(/^0\.89/),
    );

    rerender(
      <NeuralGraph
        activation={createActivation(genome, "different-genome")}
        genome={genome}
        level={6}
      />,
    );
    expect(graph).toHaveAttribute("data-has-activation", "false");
    expect(graph).toHaveAttribute("data-activation-genome-id", "");
    expect(node(graph, "input", 0)).toHaveAttribute("data-node-activation", "");
    expect(node(graph, "hidden", 0)).toHaveAttribute("data-node-activation", "");
    expect(node(graph, "output", 0)).toHaveAttribute("data-node-activation", "");
  });

  it("removes glow effects without changing the neural data", () => {
    const genome = createGenome();
    const activation = createActivation(genome);
    const { rerender } = render(
      <NeuralGraph
        activation={activation}
        genome={genome}
        level={6}
      />,
    );
    const graph = screen.getByTestId("neural-graph");
    expect(node(graph, "input", 0)).toHaveAttribute("data-glow", "true");
    expect(graph).toHaveAttribute("data-reduced-effects", "false");

    rerender(
      <NeuralGraph
        activation={activation}
        genome={genome}
        level={6}
        reducedEffects
      />,
    );
    expect(graph).toHaveAttribute("data-reduced-effects", "true");
    expect(node(graph, "input", 0)).toHaveAttribute("data-glow", "false");
    expect(graph.querySelectorAll("line")).toHaveLength(104);
    expect(node(graph, "input", 0)).toHaveAttribute(
      "data-node-activation",
      "1",
    );
  });
});
