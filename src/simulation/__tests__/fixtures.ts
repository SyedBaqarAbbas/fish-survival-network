import { FISH_CONFIG, PREDATOR_CONFIG } from "../config";
import type { AgentState } from "../types";

export function makeFish(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 0,
    x: 500,
    y: 350,
    vx: 0,
    vy: 0,
    alive: true,
    ...FISH_CONFIG,
    ...overrides,
  };
}

export function makePredator(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: -1,
    x: 200,
    y: 350,
    vx: 0,
    vy: 0,
    alive: true,
    ...PREDATOR_CONFIG,
    ...overrides,
  };
}
