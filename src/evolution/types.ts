export interface NetworkTopology {
  inputCount: number;
  hiddenCount: number;
  outputCount: number;
}

export interface NetworkGenome extends NetworkTopology {
  id: string;
  inputToHidden: Float32Array;
  hiddenBias: Float32Array;
  hiddenToOutput: Float32Array;
  outputBias: Float32Array;
}

export const FISH_NETWORK_TOPOLOGY = {
  inputCount: 11,
  hiddenCount: 8,
  outputCount: 2,
} as const satisfies NetworkTopology;
