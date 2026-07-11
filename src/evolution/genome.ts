import { SeededRandom } from "@/simulation/random";
import type { CurriculumLevel } from "@/simulation/types";

import { getUnlockedInputIndices } from "./inputs";
import { FISH_NETWORK_TOPOLOGY, type NetworkGenome, type NetworkTopology } from "./types";

function requirePositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

export function getGenomeParameterCount(topology: Readonly<NetworkTopology>) {
  return (
    topology.inputCount * topology.hiddenCount +
    topology.hiddenCount +
    topology.hiddenCount * topology.outputCount +
    topology.outputCount
  );
}

export function assertGenomeShape(genome: Readonly<NetworkGenome>) {
  requirePositiveInteger(genome.inputCount, "inputCount");
  requirePositiveInteger(genome.hiddenCount, "hiddenCount");
  requirePositiveInteger(genome.outputCount, "outputCount");

  if (genome.inputToHidden.length !== genome.inputCount * genome.hiddenCount) {
    throw new RangeError("inputToHidden does not match the declared topology.");
  }
  if (genome.hiddenBias.length !== genome.hiddenCount) {
    throw new RangeError("hiddenBias does not match the declared topology.");
  }
  if (genome.hiddenToOutput.length !== genome.hiddenCount * genome.outputCount) {
    throw new RangeError("hiddenToOutput does not match the declared topology.");
  }
  if (genome.outputBias.length !== genome.outputCount) {
    throw new RangeError("outputBias does not match the declared topology.");
  }

  return genome;
}

function fillXavier(
  target: Float32Array,
  fanIn: number,
  fanOut: number,
  random: SeededRandom,
) {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  for (let index = 0; index < target.length; index += 1) {
    target[index] = random.nextBetween(-limit, limit);
  }
}

export function createRandomGenome(
  id: string,
  random: SeededRandom,
  topology: Readonly<NetworkTopology> = FISH_NETWORK_TOPOLOGY,
  level: CurriculumLevel = 0,
): NetworkGenome {
  requirePositiveInteger(topology.inputCount, "inputCount");
  requirePositiveInteger(topology.hiddenCount, "hiddenCount");
  requirePositiveInteger(topology.outputCount, "outputCount");

  const genome: NetworkGenome = {
    id,
    ...topology,
    inputToHidden: new Float32Array(topology.inputCount * topology.hiddenCount),
    hiddenBias: new Float32Array(topology.hiddenCount),
    hiddenToOutput: new Float32Array(topology.hiddenCount * topology.outputCount),
    outputBias: new Float32Array(topology.outputCount),
  };
  const inputLimit = Math.sqrt(6 / (topology.inputCount + topology.hiddenCount));
  for (let hiddenIndex = 0; hiddenIndex < topology.hiddenCount; hiddenIndex += 1) {
    for (const inputIndex of getUnlockedInputIndices(level)) {
      if (inputIndex >= topology.inputCount) continue;
      genome.inputToHidden[hiddenIndex * topology.inputCount + inputIndex] =
        random.nextBetween(-inputLimit, inputLimit);
    }
  }
  fillXavier(
    genome.hiddenToOutput,
    topology.hiddenCount,
    topology.outputCount,
    random,
  );
  return genome;
}

function copyFloat32Bytes(source: Float32Array) {
  const copy = new Float32Array(source.length);
  new Uint8Array(copy.buffer).set(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
  return copy;
}

export function cloneGenome(genome: Readonly<NetworkGenome>, id = genome.id): NetworkGenome {
  assertGenomeShape(genome);
  return {
    id,
    inputCount: genome.inputCount,
    hiddenCount: genome.hiddenCount,
    outputCount: genome.outputCount,
    inputToHidden: copyFloat32Bytes(genome.inputToHidden),
    hiddenBias: copyFloat32Bytes(genome.hiddenBias),
    hiddenToOutput: copyFloat32Bytes(genome.hiddenToOutput),
    outputBias: copyFloat32Bytes(genome.outputBias),
  };
}

export function genomeParametersEqual(
  first: Readonly<NetworkGenome>,
  second: Readonly<NetworkGenome>,
) {
  assertGenomeShape(first);
  assertGenomeShape(second);
  if (
    first.inputCount !== second.inputCount ||
    first.hiddenCount !== second.hiddenCount ||
    first.outputCount !== second.outputCount
  ) {
    return false;
  }

  const pairs = [
    [first.inputToHidden, second.inputToHidden],
    [first.hiddenBias, second.hiddenBias],
    [first.hiddenToOutput, second.hiddenToOutput],
    [first.outputBias, second.outputBias],
  ] as const;
  return pairs.every(([left, right]) => {
    const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    return leftBytes.every((value, index) => value === rightBytes[index]);
  });
}
