import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";

import { WORLD_CONFIG } from "@/simulation";

import {
  containWorld,
  findFishAtPoint,
  interpolateValues,
  interpolationAlpha,
  type WorldTransform,
} from "./math";
import { TrailBuffer } from "./trailBuffer";
import type {
  PixiReplayRendererOptions,
  RendererCatch,
  RendererMapping,
  RendererSnapshot,
} from "./types";

const FISH_COUNT = 48;
const POSITION_VALUE_COUNT = FISH_COUNT * 2;
const PREDATOR_VALUE_COUNT = 4;
const TRAIL_LENGTH = 16;
const PARTICLE_POOL_SIZE = 192;
const PARTICLES_PER_CATCH = 8;
const CATCH_DURATION_SECONDS = 0.48;
const DEFAULT_BACKGROUND = 0x0f0d12;
const WORLD_BACKGROUND = 0x121016;
const GRID_COLOR = 0x2d2832;
const PRIMARY_COLOR = 0xff2794;
const FISH_COLOR = 0xf4f1f6;
const TRAIL_COLOR = 0xaaa4ae;
const PREDATOR_COLOR = 0xff6b81;

interface TimedSnapshot {
  event: RendererSnapshot;
  receivedAt: number;
}

interface CatchVisual {
  angle: number;
  simulationTime: number;
  x: number;
  y: number;
}

interface ParticleVisual {
  active: boolean;
  bornAt: number;
  life: number;
  sprite: Sprite;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
}

interface SceneLayers {
  background: Container;
  fish: Container;
  overlay: Container;
  particles: Container;
  predator: Container;
  trails: Container;
}

function errorFrom(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

function requireSnapshotShape(snapshot: RendererSnapshot) {
  if (
    snapshot.positions.length !== POSITION_VALUE_COUNT ||
    snapshot.velocities.length !== POSITION_VALUE_COUNT ||
    snapshot.alive.length !== FISH_COUNT ||
    snapshot.predator.length !== PREDATOR_VALUE_COUNT
  ) {
    throw new RangeError("Replay snapshot has an invalid packed layout.");
  }
}

function normalizedHash(...values: number[]) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 16;
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function destroyInitializedApplication(app: Application, textures: Texture[]) {
  for (const texture of textures) texture.destroy(true);
  app.destroy(
    { removeView: true },
    { children: true, context: true },
  );
}

export class PixiReplayRenderer {
  private readonly options: PixiReplayRendererOptions;
  private app?: Application;
  private host?: HTMLElement;
  private world?: Container;
  private layers?: SceneLayers;
  private resizeObserver?: ResizeObserver;
  private animationFrame?: number;
  private lifecycleToken = 0;
  private initialized = false;
  private effectsEnabled: boolean;
  private worldWidth: number = WORLD_CONFIG.width;
  private worldHeight: number = WORLD_CONFIG.height;
  private transform: WorldTransform = containWorld(
    WORLD_CONFIG.width,
    WORLD_CONFIG.height,
    WORLD_CONFIG.width,
    WORLD_CONFIG.height,
  );
  private mapping?: RendererMapping;
  private previous?: TimedSnapshot;
  private current?: TimedSnapshot;
  private selectedIndex: number | null = null;
  private playing = true;
  private speed = 1;
  private frame = 0;
  private lastFrameAt = 0;
  private smoothedFps = 60;
  private readonly positions = new Float32Array(POSITION_VALUE_COUNT);
  private readonly velocities = new Float32Array(POSITION_VALUE_COUNT);
  private readonly predator = new Float32Array(PREDATOR_VALUE_COUNT);
  private readonly angles = new Float32Array(FISH_COUNT);
  private predatorAngle = 0;
  private readonly trails = Array.from(
    { length: FISH_COUNT },
    () => new TrailBuffer(TRAIL_LENGTH),
  );
  private trailGraphics: Graphics[] = [];
  private fishSprites: Sprite[] = [];
  private catchGlows: Sprite[] = [];
  private predatorSprite?: Sprite;
  private selectionRing?: Graphics;
  private particles: ParticleVisual[] = [];
  private nextParticle = 0;
  private readonly catches = new Map<number, CatchVisual>();
  private ownedTextures: Texture[] = [];

  constructor(options: PixiReplayRendererOptions = {}) {
    this.options = options;
    this.effectsEnabled = options.effectsEnabled ?? true;
  }

  get canvas() {
    return this.app?.canvas as HTMLCanvasElement | undefined;
  }

  get isReady() {
    return this.initialized;
  }

  async init(host: HTMLElement) {
    this.destroy();
    const token = ++this.lifecycleToken;
    this.host = host;
    this.frame = 0;
    this.lastFrameAt = 0;
    this.smoothedFps = 60;
    host.replaceChildren();

    const app = new Application();
    const textures: Texture[] = [];
    try {
      const width = Math.max(1, Math.round(host.clientWidth || WORLD_CONFIG.width));
      const height = Math.max(
        1,
        Math.round(host.clientHeight || (width * WORLD_CONFIG.height) / WORLD_CONFIG.width),
      );
      await app.init({
        antialias: false,
        autoDensity: true,
        autoStart: false,
        backgroundAlpha: 1,
        backgroundColor: DEFAULT_BACKGROUND,
        height,
        preference: "webgl",
        resolution: this.getPixelRatio(),
        webgl: {
          powerPreference: "high-performance",
          preferWebGLVersion: 2,
        },
        width,
      });

      if (token !== this.lifecycleToken || this.host !== host) {
        destroyInitializedApplication(app, textures);
        return;
      }

      this.app = app;
      this.world = new Container();
      this.layers = this.createLayers(this.world);
      app.stage.addChild(this.world);
      this.buildBackground(this.layers.background, this.worldWidth, this.worldHeight);
      this.buildScene(textures);
      this.ownedTextures = textures;
      this.world.eventMode = "static";
      this.world.hitArea = new Rectangle(
        0,
        0,
        this.worldWidth,
        this.worldHeight,
      );
      this.world.on("pointertap", this.handlePointerTap);

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.setAttribute("aria-label", "Fish survival replay");
      canvas.setAttribute("role", "img");
      canvas.dataset.effectsEnabled = String(this.effectsEnabled);
      canvas.dataset.frame = "0";
      canvas.dataset.ready = "true";
      canvas.dataset.selected =
        this.selectedIndex === null ? "" : String(this.selectedIndex);
      canvas.dataset.sequence = String(this.current?.event.sequence ?? -1);
      canvas.style.display = "block";
      canvas.style.height = "100%";
      canvas.style.touchAction = "manipulation";
      canvas.style.width = "100%";
      host.replaceChildren(canvas);

      this.resize();
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
      }

      this.initialized = true;
      this.redrawTrails();
      app.render();
      this.animationFrame = requestAnimationFrame(this.renderFrame);
    } catch (error) {
      const ownsLifecycle = token === this.lifecycleToken;
      if (ownsLifecycle) {
        this.options.onError?.(errorFrom(error));
        this.host?.replaceChildren();
      }
      if (this.app === app) {
        this.app = undefined;
      }
      if (app.renderer) {
        destroyInitializedApplication(app, textures);
      }
      if (ownsLifecycle) {
        this.initialized = false;
        this.world = undefined;
        this.layers = undefined;
        throw error;
      }
    }
  }

  pushMapping(mapping: RendererMapping) {
    if (this.mapping && mapping.episodeId < this.mapping.episodeId) return;
    const changedEpisode = this.mapping?.episodeId !== mapping.episodeId;
    this.mapping = mapping;
    this.playing = mapping.status === "playing";
    this.updateWorld(mapping.world.width, mapping.world.height);
    if (changedEpisode) this.resetEpisode();
    this.setSelectedIndex(mapping.selectedFishIndex);
  }

  pushSnapshot(snapshot: RendererSnapshot, receivedAt = performance.now()) {
    requireSnapshotShape(snapshot);
    if (!Number.isFinite(receivedAt)) {
      throw new RangeError("Snapshot receipt time must be finite.");
    }
    if (this.mapping && snapshot.episodeId < this.mapping.episodeId) return;
    if (this.current && snapshot.episodeId < this.current.event.episodeId) return;
    if (
      this.current &&
      snapshot.episodeId === this.current.event.episodeId &&
      snapshot.sequence <= this.current.event.sequence
    ) {
      return;
    }

    if (!this.current || snapshot.episodeId !== this.current.event.episodeId) {
      this.resetEpisode();
      this.previous = { event: snapshot, receivedAt };
    } else {
      this.previous = this.current;
    }
    this.current = { event: snapshot, receivedAt };
    this.appendTrails(snapshot);
    this.redrawTrails();
    if (this.canvas) this.canvas.dataset.sequence = String(snapshot.sequence);
  }

  handleCatch(event: RendererCatch) {
    if (this.mapping && event.episodeId !== this.mapping.episodeId) return;
    if (event.fishIndex < 0 || event.fishIndex >= FISH_COUNT) return;
    if (this.catches.has(event.fishIndex)) return;
    this.catches.set(event.fishIndex, {
      angle: this.angles[event.fishIndex],
      simulationTime: event.simulationTime,
      x: event.x,
      y: event.y,
    });
    if (this.effectsEnabled) this.emitCatchParticles(event);
  }

  setSelectedIndex(index: number | null) {
    if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= FISH_COUNT)) {
      throw new RangeError("Selected fish index must be null or between 0 and 47.");
    }
    this.selectedIndex = index;
    if (this.canvas) this.canvas.dataset.selected = index === null ? "" : String(index);
    this.redrawTrails();
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new RangeError("Replay speed must be finite and greater than zero.");
    }
    this.speed = speed;
  }

  setEffectsEnabled(enabled: boolean) {
    this.effectsEnabled = enabled;
    if (this.canvas) this.canvas.dataset.effectsEnabled = String(enabled);
    if (!enabled) {
      for (const graphic of this.trailGraphics) graphic.visible = false;
      for (const glow of this.catchGlows) glow.visible = false;
      for (const particle of this.particles) {
        particle.active = false;
        particle.sprite.visible = false;
      }
    } else {
      for (const graphic of this.trailGraphics) graphic.visible = true;
      this.redrawTrails();
    }
  }

  destroy() {
    this.lifecycleToken += 1;
    this.initialized = false;
    if (this.animationFrame !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.world?.off("pointertap", this.handlePointerTap);

    const app = this.app;
    const textures = this.ownedTextures;
    this.app = undefined;
    this.ownedTextures = [];
    if (app) destroyInitializedApplication(app, textures);
    this.host?.replaceChildren();
    this.host = undefined;
    this.world = undefined;
    this.layers = undefined;
    this.mapping = undefined;
    this.previous = undefined;
    this.current = undefined;
    this.fishSprites = [];
    this.catchGlows = [];
    this.trailGraphics = [];
    this.particles = [];
    this.predatorSprite = undefined;
    this.selectionRing = undefined;
    this.catches.clear();
    for (const trail of this.trails) trail.clear();
  }

  private getPixelRatio() {
    const requested = this.options.pixelRatio ?? 1;
    return Math.max(1, Math.min(2, requested));
  }

  private createLayers(world: Container): SceneLayers {
    const layers = {
      background: new Container(),
      trails: new Container(),
      fish: new Container(),
      predator: new Container(),
      particles: new Container(),
      overlay: new Container(),
    };
    world.addChild(
      layers.background,
      layers.trails,
      layers.fish,
      layers.predator,
      layers.particles,
      layers.overlay,
    );
    return layers;
  }

  private buildBackground(layer: Container, width: number, height: number) {
    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill(WORLD_BACKGROUND);
    const grid = new Graphics();
    for (let x = 100; x < width; x += 100) {
      grid.moveTo(x, 0).lineTo(x, height);
    }
    for (let y = 100; y < height; y += 100) {
      grid.moveTo(0, y).lineTo(width, y);
    }
    grid.stroke({ alpha: 0.22, color: GRID_COLOR, width: 1 });
    layer.addChild(background, grid);
  }

  private buildScene(textures: Texture[]) {
    if (!this.app || !this.layers) return;
    const fishTexture = this.createFishTexture();
    textures.push(fishTexture);
    const predatorTexture = this.createPredatorTexture();
    textures.push(predatorTexture);
    const particleTexture = this.createParticleTexture();
    textures.push(particleTexture);

    for (let fishIndex = 0; fishIndex < FISH_COUNT; fishIndex += 1) {
      const trail = new Graphics();
      this.trailGraphics.push(trail);
      this.layers.trails.addChild(trail);

      const fish = new Sprite(fishTexture);
      fish.anchor.set(0.5);
      fish.tint = FISH_COLOR;
      fish.visible = false;
      this.fishSprites.push(fish);
      this.layers.fish.addChild(fish);

      const glow = new Sprite(particleTexture);
      glow.anchor.set(0.5);
      glow.alpha = 0;
      glow.scale.set(7);
      glow.tint = PRIMARY_COLOR;
      glow.visible = false;
      this.catchGlows.push(glow);
      this.layers.overlay.addChild(glow);
    }

    const predator = new Sprite(predatorTexture);
    predator.anchor.set(0.5);
    predator.tint = PREDATOR_COLOR;
    predator.visible = false;
    this.predatorSprite = predator;
    this.layers.predator.addChild(predator);

    for (let index = 0; index < PARTICLE_POOL_SIZE; index += 1) {
      const sprite = new Sprite(particleTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.layers.particles.addChild(sprite);
      this.particles.push({
        active: false,
        bornAt: 0,
        life: 0,
        sprite,
        velocityX: 0,
        velocityY: 0,
        x: 0,
        y: 0,
      });
    }

    this.selectionRing = new Graphics()
      .circle(0, 0, 15)
      .stroke({ alpha: 0.95, color: PRIMARY_COLOR, width: 2 });
    this.selectionRing.visible = false;
    this.layers.overlay.addChild(this.selectionRing);
  }

  private createFishTexture() {
    if (!this.app) throw new Error("Pixi application is not initialized.");
    const graphic = new Graphics()
      .poly([-6, 0, -16, -8, -14, 8], true)
      .fill(FISH_COLOR)
      .ellipse(3, 0, 11, 6)
      .fill(FISH_COLOR)
      .poly([1, -3, -4, -10, 7, -5], true)
      .fill({ alpha: 0.7, color: FISH_COLOR })
      .circle(9, -2, 1.2)
      .fill(0x17141c);
    const texture = this.app.renderer.generateTexture({
      antialias: true,
      frame: new Rectangle(-18, -11, 36, 22),
      resolution: this.getPixelRatio(),
      target: graphic,
    });
    graphic.destroy({ context: true });
    return texture;
  }

  private createPredatorTexture() {
    if (!this.app) throw new Error("Pixi application is not initialized.");
    const graphic = new Graphics()
      .poly([-13, 0, -29, -15, -25, 15], true)
      .fill(FISH_COLOR)
      .ellipse(5, 0, 22, 13)
      .fill(FISH_COLOR)
      .poly([2, -8, 10, -22, 17, -8], true)
      .fill({ alpha: 0.82, color: FISH_COLOR })
      .poly([3, 8, 14, 20, 18, 7], true)
      .fill({ alpha: 0.7, color: FISH_COLOR })
      .circle(20, -4, 2)
      .fill(0x17141c);
    const texture = this.app.renderer.generateTexture({
      antialias: true,
      frame: new Rectangle(-32, -24, 64, 48),
      resolution: this.getPixelRatio(),
      target: graphic,
    });
    graphic.destroy({ context: true });
    return texture;
  }

  private createParticleTexture() {
    if (!this.app) throw new Error("Pixi application is not initialized.");
    const graphic = new Graphics().circle(0, 0, 2.5).fill(FISH_COLOR);
    const texture = this.app.renderer.generateTexture({
      antialias: true,
      frame: new Rectangle(-3, -3, 6, 6),
      resolution: this.getPixelRatio(),
      target: graphic,
    });
    graphic.destroy({ context: true });
    return texture;
  }

  private resize() {
    if (!this.app || !this.host || !this.world) return;
    const width = Math.max(1, Math.round(this.host.clientWidth));
    const height = Math.max(1, Math.round(this.host.clientHeight));
    this.app.renderer.resize(width, height, this.getPixelRatio());
    this.transform = containWorld(
      width,
      height,
      this.worldWidth,
      this.worldHeight,
    );
    this.world.position.set(this.transform.offsetX, this.transform.offsetY);
    this.world.scale.set(this.transform.scale);
  }

  private updateWorld(width: number, height: number) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new RangeError("Replay world dimensions must be finite and positive.");
    }
    if (width === this.worldWidth && height === this.worldHeight) return;
    this.worldWidth = width;
    this.worldHeight = height;
    if (this.world) {
      this.world.hitArea = new Rectangle(0, 0, width, height);
    }
    if (this.layers) {
      const previous = this.layers.background.removeChildren();
      for (const child of previous) {
        child.destroy({ children: true, context: true });
      }
      this.buildBackground(this.layers.background, width, height);
    }
    this.resize();
  }

  private resetEpisode() {
    this.previous = undefined;
    this.current = undefined;
    this.catches.clear();
    this.nextParticle = 0;
    for (const trail of this.trails) trail.clear();
    for (const graphic of this.trailGraphics) graphic.clear();
    for (const fish of this.fishSprites) fish.visible = false;
    for (const glow of this.catchGlows) glow.visible = false;
    for (const particle of this.particles) {
      particle.active = false;
      particle.sprite.visible = false;
    }
    if (this.predatorSprite) this.predatorSprite.visible = false;
    if (this.selectionRing) this.selectionRing.visible = false;
    if (this.canvas) this.canvas.dataset.sequence = "-1";
  }

  private appendTrails(snapshot: RendererSnapshot) {
    if (!this.effectsEnabled) return;
    for (let fishIndex = 0; fishIndex < FISH_COUNT; fishIndex += 1) {
      if (snapshot.alive[fishIndex] === 0) continue;
      const offset = fishIndex * 2;
      this.trails[fishIndex].push(
        snapshot.positions[offset],
        snapshot.positions[offset + 1],
      );
    }
  }

  private redrawTrails() {
    if (!this.effectsEnabled) return;
    for (let fishIndex = 0; fishIndex < this.trailGraphics.length; fishIndex += 1) {
      const graphic = this.trailGraphics[fishIndex];
      const trail = this.trails[fishIndex];
      graphic.clear();
      if (trail.length < 2) continue;
      const selected = fishIndex === this.selectedIndex;
      const champion = this.genomeIdForIndex(fishIndex) === this.mapping?.championGenomeId;
      for (let pointIndex = 1; pointIndex < trail.length; pointIndex += 1) {
        const previous = trail.at(pointIndex - 1);
        const current = trail.at(pointIndex);
        if (!previous || !current) continue;
        const age = pointIndex / (trail.length - 1);
        graphic
          .moveTo(previous.x, previous.y)
          .lineTo(current.x, current.y)
          .stroke({
            alpha: (selected ? 0.9 : champion ? 0.62 : 0.24) * age * age,
            color: selected || champion ? PRIMARY_COLOR : TRAIL_COLOR,
            width: selected ? 2.8 : champion ? 2 : 1.15,
          });
      }
    }
  }

  private genomeIdForIndex(fishIndex: number) {
    return this.mapping?.entries.find((entry) => entry.fishIndex === fishIndex)?.genomeId;
  }

  private emitCatchParticles(event: RendererCatch) {
    for (let ordinal = 0; ordinal < PARTICLES_PER_CATCH; ordinal += 1) {
      const particle = this.particles[this.nextParticle];
      if (!particle) return;
      this.nextParticle = (this.nextParticle + 1) % this.particles.length;
      const angle =
        normalizedHash(event.episodeId, event.sequence, event.fishIndex, ordinal) *
        Math.PI *
        2;
      const speed =
        42 +
        normalizedHash(event.sequence, event.fishIndex, ordinal, 0x9e37) * 72;
      particle.active = true;
      particle.bornAt = event.simulationTime;
      particle.life =
        0.3 + normalizedHash(event.fishIndex, event.sequence, ordinal, 0x85eb) * 0.3;
      particle.velocityX = Math.cos(angle) * speed;
      particle.velocityY = Math.sin(angle) * speed;
      particle.x = event.x;
      particle.y = event.y;
      particle.sprite.alpha = 1;
      particle.sprite.position.set(event.x, event.y);
      particle.sprite.scale.set(1);
      particle.sprite.tint = ordinal % 3 === 0 ? FISH_COLOR : PRIMARY_COLOR;
      particle.sprite.visible = true;
    }
  }

  private readonly handlePointerTap = (event: FederatedPointerEvent) => {
    if (!this.world || !this.current) return;
    const local = event.getLocalPosition(this.world);
    const hitRadius = Math.max(18, 12 / this.transform.scale);
    const fishIndex = findFishAtPoint(
      this.positions,
      this.current.event.alive,
      local.x,
      local.y,
      hitRadius,
    );
    if (fishIndex === null) return;
    const genomeId = this.genomeIdForIndex(fishIndex);
    if (!genomeId) return;
    this.setSelectedIndex(fishIndex);
    this.options.onSelect?.(fishIndex, genomeId);
  };

  private readonly renderFrame = (renderTime: number) => {
    if (!this.app || !this.initialized) return;
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    const simulationTime = this.updateScene(renderTime);
    this.app.render();
    this.frame += 1;
    const delta = this.lastFrameAt === 0 ? 1000 / 60 : renderTime - this.lastFrameAt;
    this.lastFrameAt = renderTime;
    if (delta > 0 && Number.isFinite(delta)) {
      const instantaneous = Math.min(240, 1_000 / delta);
      this.smoothedFps += (instantaneous - this.smoothedFps) * 0.08;
    }
    const sequence = this.current?.event.sequence ?? -1;
    const canvas = this.canvas;
    if (canvas) {
      canvas.dataset.frame = String(this.frame);
      canvas.dataset.sequence = String(sequence);
    }
    this.options.onFrame?.({
      fps: this.smoothedFps,
      frame: this.frame,
      sequence,
      simulationTime,
    });
  };

  private updateScene(renderTime: number) {
    if (!this.current) return 0;
    const previous = this.previous ?? this.current;
    const alpha = this.playing
      ? interpolationAlpha(
          previous.event.simulationTime,
          this.current.event.simulationTime,
          this.current.receivedAt,
          renderTime,
          this.speed,
        )
      : 1;
    interpolateValues(
      previous.event.positions,
      this.current.event.positions,
      alpha,
      this.positions,
    );
    interpolateValues(
      previous.event.velocities,
      this.current.event.velocities,
      alpha,
      this.velocities,
    );
    interpolateValues(
      previous.event.predator,
      this.current.event.predator,
      alpha,
      this.predator,
    );
    const simulationTime =
      previous.event.simulationTime +
      (this.current.event.simulationTime - previous.event.simulationTime) * alpha;
    this.updateFish(simulationTime);
    this.updatePredator();
    this.updateParticles(simulationTime);
    return simulationTime;
  }

  private updateFish(simulationTime: number) {
    if (!this.current) return;
    for (let fishIndex = 0; fishIndex < FISH_COUNT; fishIndex += 1) {
      const sprite = this.fishSprites[fishIndex];
      const glow = this.catchGlows[fishIndex];
      if (!sprite || !glow) continue;
      const catchVisual = this.catches.get(fishIndex);
      const offset = fishIndex * 2;
      const genomeId = this.genomeIdForIndex(fishIndex);
      const emphasized =
        fishIndex === this.selectedIndex || genomeId === this.mapping?.championGenomeId;

      if (catchVisual) {
        const progress = Math.max(
          0,
          Math.min(
            1,
            (simulationTime - catchVisual.simulationTime) / CATCH_DURATION_SECONDS,
          ),
        );
        sprite.visible = progress < 1;
        sprite.position.set(catchVisual.x, catchVisual.y);
        sprite.rotation = catchVisual.angle;
        sprite.scale.set(Math.max(0.02, 1 - progress));
        sprite.alpha = 1 - progress * 0.7;
        sprite.tint = PRIMARY_COLOR;
        glow.visible = this.effectsEnabled && progress < 1;
        glow.position.set(catchVisual.x, catchVisual.y);
        glow.alpha = Math.sin(progress * Math.PI) * 0.38;
        glow.scale.set(6 + progress * 5);
      } else if (this.current.event.alive[fishIndex] !== 0) {
        sprite.visible = true;
        sprite.position.set(this.positions[offset], this.positions[offset + 1]);
        sprite.scale.set(1);
        sprite.alpha = 0.96;
        sprite.tint = emphasized ? PRIMARY_COLOR : FISH_COLOR;
        const velocityX = this.velocities[offset];
        const velocityY = this.velocities[offset + 1];
        if (velocityX * velocityX + velocityY * velocityY > 0.01) {
          this.angles[fishIndex] = Math.atan2(velocityY, velocityX);
        }
        sprite.rotation = this.angles[fishIndex];
        glow.visible = false;
      } else {
        sprite.visible = false;
        glow.visible = false;
      }
    }

    if (this.selectionRing && this.selectedIndex !== null) {
      const selectedSprite = this.fishSprites[this.selectedIndex];
      const caught = this.catches.has(this.selectedIndex);
      this.selectionRing.visible = Boolean(selectedSprite?.visible && !caught);
      if (this.selectionRing.visible && selectedSprite) {
        this.selectionRing.position.copyFrom(selectedSprite.position);
        const pulse = 1 + Math.sin(simulationTime * Math.PI * 3) * 0.06;
        this.selectionRing.scale.set(pulse);
      }
    } else if (this.selectionRing) {
      this.selectionRing.visible = false;
    }
  }

  private updatePredator() {
    if (!this.predatorSprite) return;
    this.predatorSprite.visible = true;
    this.predatorSprite.position.set(this.predator[0], this.predator[1]);
    const velocityX = this.predator[2];
    const velocityY = this.predator[3];
    if (velocityX * velocityX + velocityY * velocityY > 0.01) {
      this.predatorAngle = Math.atan2(velocityY, velocityX);
    }
    this.predatorSprite.rotation = this.predatorAngle;
  }

  private updateParticles(simulationTime: number) {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      const age = Math.max(0, simulationTime - particle.bornAt);
      const progress = age / particle.life;
      if (!this.effectsEnabled || progress >= 1) {
        particle.active = false;
        particle.sprite.visible = false;
        continue;
      }
      particle.sprite.position.set(
        particle.x + particle.velocityX * age,
        particle.y + particle.velocityY * age + 80 * age * age,
      );
      particle.sprite.alpha = 1 - progress;
      particle.sprite.scale.set(1 - progress * 0.55);
    }
  }
}
