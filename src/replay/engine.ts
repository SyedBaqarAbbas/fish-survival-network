import {
  createForwardBuffers,
  forwardUnchecked,
  type ForwardBuffers,
} from "@/evolution";
import {
  createSimulationState,
  createSpawnLayout,
  findNearestLivingFish,
  FISH_INPUT_COUNT,
  observeFish,
  scriptedPredatorSteering,
  stepSimulation,
  type SimulationState,
  type Steering,
} from "@/simulation";

import {
  REPLAY_PROTOCOL_VERSION,
  type ReplayActivationEvent,
  type ReplayCommand,
  type ReplayErrorCode,
  type ReplayEvent,
  type ReplayMappingEvent,
  type ReplaySpeed,
} from "./protocol";
import { packSimulationSnapshot } from "./snapshot";
import {
  cloneReplaySource,
  REPLAY_FISH_COUNT,
  type ReplaySource,
} from "./source";

const PULSE_MILLISECONDS = 1000 / 15;
const STEPS_PER_PULSE: Readonly<Record<ReplaySpeed, number>> = Object.freeze({
  0.5: 2,
  1: 4,
  2: 8,
});
const ZERO_STEERING: Readonly<Steering> = Object.freeze({ x: 0, y: 0 });

export type ReplayEngineStatus = "unloaded" | "paused" | "playing" | "disposed";

export interface ReplayEngineDependencies {
  emit: (event: ReplayEvent) => void;
  schedule?: (task: () => void, delayMilliseconds: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface ReplayLoad {
  source: ReplaySource;
  replaySeed: number;
}

interface ActiveReplay {
  load: ReplayLoad;
  state: SimulationState;
  steering: Steering[];
  observation: Float32Array<ArrayBuffer>;
  forwardBuffers: ForwardBuffers;
}

function defaultSchedule(task: () => void, delayMilliseconds: number) {
  return setTimeout(task, delayMilliseconds);
}

function defaultCancel(handle: unknown) {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isUint32(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

export class ReplayEngine {
  private readonly emitEvent: (event: ReplayEvent) => void;
  private readonly schedule: (task: () => void, delayMilliseconds: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private status: ReplayEngineStatus = "unloaded";
  private speed: ReplaySpeed = 1;
  private active?: ActiveReplay;
  private pending?: ActiveReplay;
  private selectedFishIndex: number | null = null;
  private timer: unknown;
  private scheduleToken = 0;
  private episodeId = 0;
  private sequence = 0;

  constructor({
    emit,
    schedule = defaultSchedule,
    cancel = defaultCancel,
  }: ReplayEngineDependencies) {
    this.emitEvent = emit;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  getStatus() {
    return this.status;
  }

  getSpeed() {
    return this.speed;
  }

  getEpisodeId() {
    return this.episodeId;
  }

  handle(command: ReplayCommand) {
    if (this.status === "disposed") return;
    switch (command.type) {
      case "LOAD":
        this.load(command.source, command.replaySeed);
        break;
      case "PLAY":
        this.play();
        break;
      case "PAUSE":
        this.pause();
        break;
      case "RESTART":
        this.restart();
        break;
      case "SPEED":
        this.setSpeed(command.speed);
        break;
      case "SELECT":
        this.select(command.fishIndex);
        break;
    }
  }

  reportInvalidCommand(message = "Unsupported replay command.") {
    if (this.status !== "disposed") {
      this.emitError("INVALID_COMMAND", message, true);
    }
  }

  dispose() {
    if (this.status === "disposed") return;
    this.invalidateSchedule();
    this.active = undefined;
    this.pending = undefined;
    this.status = "disposed";
  }

  private nextSequence() {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Replay event sequence exhausted the safe integer range.");
    }
    this.sequence += 1;
    return this.sequence;
  }

  private emitError(code: ReplayErrorCode, message: string, recoverable: boolean) {
    this.emitEvent({
      type: "ERROR",
      episodeId: this.active ? this.episodeId : null,
      sequence: this.nextSequence(),
      code,
      message,
      recoverable,
    });
  }

  private prepare(source: ReplaySource, replaySeed: number) {
    if (!isUint32(replaySeed)) {
      throw new RangeError("Replay seed must be an unsigned 32-bit integer.");
    }
    const ownedSource = cloneReplaySource(source);
    const state = createSimulationState(
      createSpawnLayout({
        seed: replaySeed,
        fishCount: REPLAY_FISH_COUNT,
        world: ownedSource.world,
      }),
      ownedSource.world,
      { endCondition: "all-fish-caught" },
    );
    return {
      load: { source: ownedSource, replaySeed },
      state,
      steering: Array.from({ length: REPLAY_FISH_COUNT }, () => ({ x: 0, y: 0 })),
      observation: new Float32Array(FISH_INPUT_COUNT),
      forwardBuffers: createForwardBuffers(ownedSource.entries[0].genome),
    } satisfies ActiveReplay;
  }

  private load(source: ReplaySource, replaySeed: number) {
    try {
      const prepared = this.prepare(source, replaySeed);
      const canApplyImmediately =
        !this.active ||
        (this.status === "paused" && this.active.state.step === 0);
      if (!canApplyImmediately) {
        this.pending = prepared;
        return;
      }

      this.invalidateSchedule();
      this.active = prepared;
      this.pending = undefined;
      this.status = "paused";
      this.beginEpisode(prepared);
    } catch (error) {
      this.emitError("LOAD_FAILED", errorMessage(error), true);
    }
  }

  private play() {
    if (!this.active) {
      this.emitError("INVALID_STATE", "Load a replay source before playing.", true);
      return;
    }
    if (this.status === "playing") return;
    this.status = "playing";
    this.invalidateSchedule();
    this.schedulePulse(this.scheduleToken);
  }

  private pause() {
    if (!this.active) {
      this.emitError("INVALID_STATE", "Load a replay source before pausing.", true);
      return;
    }
    if (this.status === "paused") return;
    this.status = "paused";
    this.invalidateSchedule();
  }

  private restart() {
    if (!this.active) {
      this.emitError("INVALID_STATE", "Load a replay source before restarting.", true);
      return;
    }
    const wasPlaying = this.status === "playing";
    this.invalidateSchedule();
    try {
      const next = this.pending ?? this.prepare(
        this.active.load.source,
        this.active.load.replaySeed,
      );
      this.pending = undefined;
      this.active = next;
      this.status = wasPlaying ? "playing" : "paused";
      this.beginEpisode(next);
      if (wasPlaying) this.schedulePulse(this.scheduleToken);
    } catch (error) {
      this.status = "paused";
      this.emitError("SIMULATION_FAILED", errorMessage(error), false);
    }
  }

  private setSpeed(speed: ReplaySpeed) {
    if (!(speed in STEPS_PER_PULSE)) {
      this.emitError("INVALID_COMMAND", "Replay speed must be 0.5, 1, or 2.", true);
      return;
    }
    if (this.speed === speed) return;
    this.speed = speed;
    if (this.status === "playing") {
      this.invalidateSchedule();
      this.schedulePulse(this.scheduleToken);
    }
  }

  private select(fishIndex: number | null) {
    if (!this.active) {
      this.emitError("INVALID_STATE", "Load a replay source before selecting fish.", true);
      return;
    }
    if (
      fishIndex !== null &&
      (!Number.isInteger(fishIndex) || fishIndex < 0 || fishIndex >= REPLAY_FISH_COUNT)
    ) {
      this.emitError("INVALID_COMMAND", "Selected fish index is outside the replay roster.", true);
      return;
    }
    this.selectedFishIndex = fishIndex;
    this.emitActivation();
  }

  private beginEpisode(active: ActiveReplay) {
    this.episodeId += 1;
    this.emitMapping(active);
    this.emitSnapshot(active);
    this.emitActivation();
  }

  private emitMapping(active: ActiveReplay) {
    const { source, replaySeed } = active.load;
    const event: ReplayMappingEvent = {
      type: "MAPPING",
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      episodeId: this.episodeId,
      sequence: this.nextSequence(),
      sourceId: source.sourceId,
      runId: source.runId,
      generation: source.generation,
      level: source.level,
      replaySeed,
      world: { ...source.world },
      championGenomeId: source.championGenomeId,
      entries: source.entries.map((entry, fishIndex) => ({
        fishIndex,
        genomeId: entry.genome.id,
        fitness: entry.fitness,
        survivalRate: entry.survivalRate,
      })),
      selectedFishIndex: this.selectedFishIndex,
      status: this.status === "playing" ? "playing" : "paused",
    };
    this.emitEvent(event);
  }

  private emitSnapshot(active: ActiveReplay) {
    this.emitEvent(
      packSimulationSnapshot(active.state, this.episodeId, this.nextSequence()),
    );
  }

  private emitActivation() {
    const active = this.active;
    const fishIndex = this.selectedFishIndex;
    if (!active || fishIndex === null) return;
    const fish = active.state.fish[fishIndex];
    const entry = active.load.source.entries[fishIndex];
    const inputs = new Float32Array(FISH_INPUT_COUNT);
    const hidden = new Float32Array(entry.genome.hiddenCount);
    const outputs = new Float32Array(entry.genome.outputCount);

    if (fish.alive) {
      observeFish(
        fish,
        active.state.predator,
        active.load.source.level,
        active.state.world,
        inputs,
      );
      forwardUnchecked(entry.genome, inputs, { hidden, output: outputs });
    }

    const event: ReplayActivationEvent = {
      type: "ACTIVATION",
      episodeId: this.episodeId,
      sequence: this.nextSequence(),
      simulationTime: active.state.elapsedSeconds,
      fishIndex,
      genomeId: entry.genome.id,
      alive: fish.alive,
      fitness: entry.fitness,
      survivalRate: entry.survivalRate,
      inputs,
      hidden,
      outputs,
      inputToHidden: new Float32Array(entry.genome.inputToHidden),
      hiddenToOutput: new Float32Array(entry.genome.hiddenToOutput),
    };
    this.emitEvent(event);
  }

  private stepOnce(active: ActiveReplay) {
    const { source } = active.load;
    for (let fishIndex = 0; fishIndex < REPLAY_FISH_COUNT; fishIndex += 1) {
      const fish = active.state.fish[fishIndex];
      const steering = active.steering[fishIndex];
      if (!fish.alive) {
        steering.x = 0;
        steering.y = 0;
        continue;
      }
      observeFish(
        fish,
        active.state.predator,
        source.level,
        active.state.world,
        active.observation,
      );
      const output = forwardUnchecked(
        source.entries[fishIndex].genome,
        active.observation,
        active.forwardBuffers,
      );
      steering.x = output[0];
      steering.y = output[1];
    }

    const target = findNearestLivingFish(active.state.predator, active.state.fish);
    const predatorSteering = target
      ? scriptedPredatorSteering(active.state.predator, target)
      : ZERO_STEERING;
    stepSimulation(active.state, active.steering, predatorSteering);

    for (let fishIndex = 0; fishIndex < REPLAY_FISH_COUNT; fishIndex += 1) {
      if (active.state.stats.catchSteps[fishIndex] !== active.state.step) continue;
      const fish = active.state.fish[fishIndex];
      this.emitEvent({
        type: "CATCH",
        episodeId: this.episodeId,
        sequence: this.nextSequence(),
        simulationTime: active.state.elapsedSeconds,
        fishIndex,
        genomeId: source.entries[fishIndex].genome.id,
        x: fish.x,
        y: fish.y,
      });
    }
  }

  private invalidateSchedule() {
    this.scheduleToken += 1;
    if (this.timer !== undefined) {
      this.cancel(this.timer);
      this.timer = undefined;
    }
  }

  private schedulePulse(token: number) {
    this.timer = this.schedule(() => this.processPulse(token), PULSE_MILLISECONDS);
  }

  private processPulse(token: number) {
    this.timer = undefined;
    if (
      token !== this.scheduleToken ||
      this.status !== "playing" ||
      !this.active
    ) {
      return;
    }

    try {
      for (let step = 0; step < STEPS_PER_PULSE[this.speed]; step += 1) {
        this.stepOnce(this.active);
        if (this.active.state.finished) break;
      }
      this.emitSnapshot(this.active);
      this.emitActivation();

      if (this.active.state.finished) {
        this.finishEpisode();
      }
      if (token === this.scheduleToken && this.status === "playing") {
        this.schedulePulse(token);
      }
    } catch (error) {
      this.status = "paused";
      this.invalidateSchedule();
      this.emitError("SIMULATION_FAILED", errorMessage(error), false);
    }
  }

  private finishEpisode() {
    const completed = this.active;
    if (!completed) return;
    const survivors = completed.state.fish.reduce(
      (count, fish) => count + Number(fish.alive),
      0,
    );
    this.emitEvent({
      type: "EPISODE_END",
      episodeId: this.episodeId,
      sequence: this.nextSequence(),
      simulationTime: completed.state.elapsedSeconds,
      sourceId: completed.load.source.sourceId,
      survivors,
      caught: REPLAY_FISH_COUNT - survivors,
    });

    const next = this.pending ?? this.prepare(
      completed.load.source,
      completed.load.replaySeed,
    );
    this.pending = undefined;
    this.active = next;
    this.beginEpisode(next);
  }
}
