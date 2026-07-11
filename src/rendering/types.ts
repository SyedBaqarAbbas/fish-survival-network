export interface SimulationSnapshot {
  sequence: number;
  simulationTime: number;
  positions: Float32Array;
  velocities: Float32Array;
  alive: Uint8Array;
  predator: Float32Array;
}
