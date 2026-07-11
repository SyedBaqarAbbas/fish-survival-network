export interface Vector2 {
  x: number;
  y: number;
}

export interface AgentState extends Vector2 {
  id: number;
  vx: number;
  vy: number;
  radius: number;
  maxSpeed: number;
  maxAcceleration: number;
  alive: boolean;
}

export interface WorldConfig {
  width: number;
  height: number;
  fixedDt: number;
  episodeSeconds: number;
}

export interface AgentConfig {
  radius: number;
  maxSpeed: number;
  maxAcceleration: number;
}

export interface SpawnConfig {
  wallMargin: number;
  minFishPredatorDistance: number;
  minFishSpacing: number;
  maxPlacementAttempts: number;
}

export interface SpawnLayout {
  fish: AgentState[];
  predator: AgentState;
}

export type CurriculumLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Steering = Vector2;
