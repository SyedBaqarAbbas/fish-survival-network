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
