import { describe, expect, it } from "vitest";

import { createForwardBuffers, forward } from "./forward";
import type { NetworkGenome } from "./types";

function fixtureGenome(): NetworkGenome {
  return {
    id: "fixture",
    inputCount: 2,
    hiddenCount: 2,
    outputCount: 1,
    inputToHidden: new Float32Array([0.5, -0.25, -0.4, 0.3]),
    hiddenBias: new Float32Array([0.1, -0.2]),
    hiddenToOutput: new Float32Array([0.7, -0.6]),
    outputBias: new Float32Array([0.05]),
  };
}

describe("network forward pass", () => {
  it("matches a hand-calculated tanh fixture and reuses caller buffers", () => {
    const genome = fixtureGenome();
    const buffers = createForwardBuffers(genome);
    const output = forward(genome, new Float32Array([1, 2]), buffers);
    const hidden0 = Math.tanh(0.1 + 0.5 - 0.5);
    const hidden1 = Math.tanh(-0.2 - 0.4 + 0.6);
    const expected = Math.tanh(0.05 + hidden0 * 0.7 - hidden1 * 0.6);

    expect(output).toBe(buffers.output);
    expect(buffers.hidden[0]).toBeCloseTo(hidden0);
    expect(buffers.hidden[1]).toBeCloseTo(hidden1);
    expect(output[0]).toBeCloseTo(expected);
  });

  it("rejects mismatched input, hidden, and output buffers", () => {
    const genome = fixtureGenome();
    const buffers = createForwardBuffers(genome);
    expect(() => forward(genome, new Float32Array(1), buffers)).toThrow(
      "Input buffer",
    );
    expect(() =>
      forward(genome, new Float32Array(2), {
        hidden: new Float32Array(1),
        output: buffers.output,
      }),
    ).toThrow("Hidden buffer");
    expect(() =>
      forward(genome, new Float32Array(2), {
        hidden: buffers.hidden,
        output: new Float32Array(2),
      }),
    ).toThrow("Output buffer");
  });
});
