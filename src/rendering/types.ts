import type {
  ReplayCatchEvent,
  ReplayMappingEvent,
  ReplaySnapshotEvent,
} from "@/replay";

export interface ReplayRendererFrameStats {
  fps: number;
  frame: number;
  sequence: number;
  simulationTime: number;
}

export interface PixiReplayRendererOptions {
  effectsEnabled?: boolean;
  onError?: (error: Error) => void;
  onFrame?: (stats: Readonly<ReplayRendererFrameStats>) => void;
  onSelect?: (fishIndex: number, genomeId: string) => void;
  pixelRatio?: number;
}

export type RendererMapping = ReplayMappingEvent;
export type RendererSnapshot = ReplaySnapshotEvent;
export type RendererCatch = ReplayCatchEvent;
