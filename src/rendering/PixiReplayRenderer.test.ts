import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RendererMapping, RendererSnapshot } from "./types";

const pixi = vi.hoisted(() => {
  class FakePoint {
    x = 0;
    y = 0;

    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    }

    copyFrom(point: { x: number; y: number }) {
      this.x = point.x;
      this.y = point.y;
    }
  }

  class FakeContainer {
    alpha = 1;
    children: FakeContainer[] = [];
    eventMode = "auto";
    hitArea: unknown;
    position = new FakePoint();
    rotation = 0;
    scale = new FakePoint();
    tint = 0xffffff;
    visible = true;
    private readonly listeners = new Map<string, (event: unknown) => void>();

    constructor() {
      this.scale.set(1);
    }

    addChild(...children: FakeContainer[]) {
      this.children.push(...children);
      return children[0];
    }

    on(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, listener);
      return this;
    }

    off(type: string) {
      this.listeners.delete(type);
      return this;
    }

    destroy() {}

    removeChildren() {
      return this.children.splice(0);
    }

    emit(type: string, event: unknown) {
      this.listeners.get(type)?.(event);
    }
  }

  class FakeGraphics extends FakeContainer {
    clear = vi.fn(() => this);
    destroy = vi.fn();
    circle() {
      return this;
    }
    ellipse() {
      return this;
    }
    fill() {
      return this;
    }
    lineTo() {
      return this;
    }
    moveTo() {
      return this;
    }
    poly() {
      return this;
    }
    rect() {
      return this;
    }
    stroke() {
      return this;
    }
  }

  class FakeTexture {
    destroy = vi.fn();
  }

  class FakeSprite extends FakeContainer {
    anchor = new FakePoint();
    texture: FakeTexture;

    constructor(texture: FakeTexture) {
      super();
      this.texture = texture;
    }
  }

  class FakeRectangle {
    constructor(
      readonly x: number,
      readonly y: number,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  const applications: FakeApplication[] = [];
  const initBehaviors: Array<() => Promise<void>> = [];

  class FakeApplication {
    canvas = document.createElement("canvas");
    destroy = vi.fn();
    init: ReturnType<typeof vi.fn>;
    render = vi.fn();
    renderer = {
      generateTexture: vi.fn(() => new FakeTexture()),
      resize: vi.fn(),
    };
    stage = new FakeContainer();

    constructor() {
      const behavior = initBehaviors.shift() ?? (async () => undefined);
      this.init = vi.fn(behavior);
      applications.push(this);
    }
  }

  return {
    applications,
    initBehaviors,
    FakeApplication,
    FakeContainer,
    FakeGraphics,
    FakeRectangle,
    FakeSprite,
    FakeTexture,
  };
});

vi.mock("pixi.js", () => ({
  Application: pixi.FakeApplication,
  Container: pixi.FakeContainer,
  Graphics: pixi.FakeGraphics,
  Rectangle: pixi.FakeRectangle,
  Sprite: pixi.FakeSprite,
  Texture: pixi.FakeTexture,
}));

import { PixiReplayRenderer } from "./PixiReplayRenderer";

function mapping(episodeId = 1): RendererMapping {
  return {
    type: "MAPPING",
    protocolVersion: 1,
    episodeId,
    sequence: 0,
    sourceId: "source",
    runId: "run",
    generation: 2,
    level: 1,
    replaySeed: 42,
    world: { width: 1_000, height: 700, fixedDt: 1 / 60, episodeSeconds: 15 },
    championGenomeId: "fish-0",
    entries: Array.from({ length: 48 }, (_, fishIndex) => ({
      fishIndex,
      genomeId: `fish-${fishIndex}`,
      fitness: fishIndex,
      survivalRate: 0.5,
    })),
    selectedFishIndex: null,
    status: "playing",
  };
}

function snapshot(sequence = 0, episodeId = 1): RendererSnapshot {
  const positions = new Float32Array(96);
  const velocities = new Float32Array(96);
  const alive = new Uint8Array(48);
  alive.fill(1);
  for (let fishIndex = 0; fishIndex < 48; fishIndex += 1) {
    positions[fishIndex * 2] = 100 + fishIndex * 10;
    positions[fishIndex * 2 + 1] = 100;
    velocities[fishIndex * 2] = 20;
  }
  return {
    type: "SNAPSHOT",
    episodeId,
    sequence,
    simulationTime: sequence / 15,
    positions,
    velocities,
    alive,
    predator: new Float32Array([700, 350, -20, 0]),
  };
}

describe("PixiReplayRenderer", () => {
  let animationCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    pixi.applications.length = 0;
    animationCallbacks = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes one contained canvas and renders snapshots outside React", async () => {
    const onFrame = vi.fn();
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 560 },
    });
    const renderer = new PixiReplayRenderer({ onFrame, pixelRatio: 1 });

    await renderer.init(host);
    renderer.pushMapping(mapping());
    renderer.pushSnapshot(snapshot(0), 1_000);
    renderer.pushSnapshot(snapshot(1), 1_066);
    animationCallbacks.shift()?.(1_100);

    const canvas = host.querySelector("canvas");
    expect(canvas).toBe(renderer.canvas);
    expect(canvas).toHaveAttribute("data-ready", "true");
    expect(canvas).toHaveAttribute("data-sequence", "1");
    expect(canvas).toHaveAttribute("data-frame", "1");
    expect(pixi.applications[0].renderer.resize).toHaveBeenCalledWith(800, 560, 1);
    expect(pixi.applications[0].render).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ frame: 1, sequence: 1 }),
    );

    renderer.destroy();
    expect(host.querySelector("canvas")).toBeNull();
    expect(pixi.applications[0].destroy).toHaveBeenCalledOnce();
  });

  it("maps pointer selection to the stable genome entry", async () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 1_000 },
      clientHeight: { value: 700 },
    });
    const renderer = new PixiReplayRenderer({ onSelect, pixelRatio: 1 });
    await renderer.init(host);
    renderer.pushMapping(mapping());
    renderer.pushSnapshot(snapshot(), 1_000);
    animationCallbacks.shift()?.(1_000);

    const world = pixi.applications[0].stage.children[0];
    world.emit("pointertap", {
      getLocalPosition: () => ({ x: 130, y: 100 }),
    });

    expect(onSelect).toHaveBeenCalledWith(3, "fish-3");
    expect(renderer.canvas).toHaveAttribute("data-selected", "3");
    renderer.destroy();
  });

  it("ignores stale snapshots and safely cancels asynchronous initialization", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 1_000 },
      clientHeight: { value: 700 },
    });
    const renderer = new PixiReplayRenderer({ pixelRatio: 1 });
    await renderer.init(host);
    renderer.pushMapping(mapping());
    renderer.pushSnapshot(snapshot(2));
    renderer.pushSnapshot(snapshot(1));
    expect(renderer.canvas).toHaveAttribute("data-sequence", "2");
    renderer.destroy();

    const canceled = new PixiReplayRenderer({ pixelRatio: 1 });
    const initializing = canceled.init(host);
    canceled.destroy();
    await initializing;
    expect(host.querySelector("canvas")).toBeNull();
    expect(pixi.applications.at(-1)?.destroy).toHaveBeenCalledOnce();
  });

  it("does not let a failed stale initialization clear a newer scene", async () => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    pixi.initBehaviors.push(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 1_000 },
      clientHeight: { value: 700 },
    });
    const renderer = new PixiReplayRenderer({ pixelRatio: 1 });
    const staleInitialization = renderer.init(host);
    await Promise.resolve();

    await renderer.init(host);
    const currentCanvas = renderer.canvas;
    rejectFirst?.(new Error("stale context failed"));
    await staleInitialization;

    expect(renderer.isReady).toBe(true);
    expect(renderer.canvas).toBe(currentCanvas);
    expect(host.querySelector("canvas")).toBe(currentCanvas);
    renderer.destroy();
  });

  it("validates public selections, speeds, and packed snapshots", () => {
    const renderer = new PixiReplayRenderer();
    expect(() => renderer.setSelectedIndex(48)).toThrow(RangeError);
    expect(() => renderer.setSpeed(0)).toThrow(RangeError);
    expect(() =>
      renderer.pushSnapshot({
        ...snapshot(),
        positions: new Float32Array(2),
      }),
    ).toThrow(RangeError);
  });
});
