import { assertGenomeShape } from "./genome";
import type { NetworkGenome } from "./types";

export interface ForwardBuffers {
  hidden: Float32Array;
  output: Float32Array;
}

export function createForwardBuffers(genome: Readonly<NetworkGenome>): ForwardBuffers {
  assertGenomeShape(genome);
  return {
    hidden: new Float32Array(genome.hiddenCount),
    output: new Float32Array(genome.outputCount),
  };
}

export function forward(
  genome: Readonly<NetworkGenome>,
  input: Float32Array,
  buffers: ForwardBuffers,
) {
  assertGenomeShape(genome);
  if (input.length !== genome.inputCount) {
    throw new RangeError("Input buffer does not match the genome topology.");
  }
  if (buffers.hidden.length !== genome.hiddenCount) {
    throw new RangeError("Hidden buffer does not match the genome topology.");
  }
  if (buffers.output.length !== genome.outputCount) {
    throw new RangeError("Output buffer does not match the genome topology.");
  }

  return forwardUnchecked(genome, input, buffers);
}

export function forwardUnchecked(
  genome: Readonly<NetworkGenome>,
  input: Float32Array,
  buffers: ForwardBuffers,
) {

  for (let hiddenIndex = 0; hiddenIndex < genome.hiddenCount; hiddenIndex += 1) {
    let sum = genome.hiddenBias[hiddenIndex];
    const weightOffset = hiddenIndex * genome.inputCount;
    for (let inputIndex = 0; inputIndex < genome.inputCount; inputIndex += 1) {
      sum += input[inputIndex] * genome.inputToHidden[weightOffset + inputIndex];
    }
    buffers.hidden[hiddenIndex] = Math.tanh(sum);
  }

  for (let outputIndex = 0; outputIndex < genome.outputCount; outputIndex += 1) {
    let sum = genome.outputBias[outputIndex];
    const weightOffset = outputIndex * genome.hiddenCount;
    for (let hiddenIndex = 0; hiddenIndex < genome.hiddenCount; hiddenIndex += 1) {
      sum +=
        buffers.hidden[hiddenIndex] *
        genome.hiddenToOutput[weightOffset + hiddenIndex];
    }
    buffers.output[outputIndex] = Math.tanh(sum);
  }

  return buffers.output;
}
