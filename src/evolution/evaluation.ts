import {
  FISH_INPUT_COUNT,
  SENSOR_DISTANCE_SCALE,
  WORLD_CONFIG,
} from "@/simulation/config";
import { createSimulationState, stepSimulation } from "@/simulation/episode";
import { deriveEpisodeSeed } from "@/simulation/random";
import { observeFish } from "@/simulation/sensors";
import { createSpawnLayout } from "@/simulation/spawning";
import { scriptedPredatorSteering } from "@/simulation/steering";
import type { CurriculumLevel, Steering, WorldConfig } from "@/simulation/types";

import { aggregateEpisodeEvaluations, calculateFishFitness } from "./fitness";
import { createForwardBuffers, forwardUnchecked } from "./forward";
import { assertGenomeShape } from "./genome";
import type {
  EpisodeEvaluation,
  GenomeEvaluation,
  NetworkGenome,
  PopulationEvaluation,
} from "./types";

const ZERO_STEERING: Readonly<Steering> = Object.freeze({ x: 0, y: 0 });

export interface EvaluateGenomeOptions {
  genome: Readonly<NetworkGenome>;
  populationIndex: number;
  episodeSeeds: readonly number[];
  level: CurriculumLevel;
  world?: Readonly<WorldConfig>;
}

export interface EvaluatePopulationOptions {
  runSeed: number;
  generation: number;
  level: CurriculumLevel;
  episodesPerGenome: number;
  world?: Readonly<WorldConfig>;
}

function evaluateEpisode(
  genome: Readonly<NetworkGenome>,
  seed: number,
  level: CurriculumLevel,
  world: Readonly<WorldConfig>,
): EpisodeEvaluation {
  const state = createSimulationState(createSpawnLayout({ seed, world }), world);
  const buffers = createForwardBuffers(genome);
  const observation = new Float32Array(FISH_INPUT_COUNT);
  const steering = [{ x: 0, y: 0 }];
  let aliveSteps = 0;
  let predatorDistanceTotal = 0;
  let accelerationSquaredTotal = 0;

  while (!state.finished) {
    const fish = state.fish[0];
    if (fish.alive) {
      observeFish(fish, state.predator, level, state.world, observation);
      const output = forwardUnchecked(genome, observation, buffers);
      steering[0].x = output[0];
      steering[0].y = output[1];
      predatorDistanceTotal += Math.min(
        Math.hypot(state.predator.x - fish.x, state.predator.y - fish.y) /
          SENSOR_DISTANCE_SCALE,
        1,
      );
      accelerationSquaredTotal += Math.min(
        steering[0].x * steering[0].x + steering[0].y * steering[0].y,
        1,
      );
      aliveSteps += 1;
    } else {
      steering[0].x = 0;
      steering[0].y = 0;
    }

    const predatorSteering = fish.alive
      ? scriptedPredatorSteering(state.predator, fish)
      : ZERO_STEERING;
    stepSimulation(state, steering, predatorSteering);
  }

  const stats = {
    aliveSeconds: aliveSteps * world.fixedDt,
    survived: state.fish[0].alive,
    meanPredatorDistance:
      aliveSteps === 0 ? 0 : predatorDistanceTotal / aliveSteps,
    wallCollisions: state.stats.fishWallCollisions[0],
    meanAccelerationSquared:
      aliveSteps === 0 ? 0 : accelerationSquaredTotal / aliveSteps,
  };
  return { seed, stats, fitness: calculateFishFitness(stats) };
}

export function evaluateGenome({
  genome,
  populationIndex,
  episodeSeeds,
  level,
  world = WORLD_CONFIG,
}: EvaluateGenomeOptions): GenomeEvaluation {
  assertGenomeShape(genome);
  if (genome.inputCount !== FISH_INPUT_COUNT || genome.outputCount !== 2) {
    throw new RangeError("Fish evaluation requires an 11-input, 2-output genome.");
  }
  if (episodeSeeds.length === 0) {
    throw new RangeError("At least one episode seed is required.");
  }

  const episodes = episodeSeeds.map((seed) =>
    evaluateEpisode(genome, seed, level, world),
  );
  return aggregateEpisodeEvaluations(genome.id, populationIndex, episodes);
}

export function evaluatePopulation(
  population: readonly Readonly<NetworkGenome>[],
  {
    runSeed,
    generation,
    level,
    episodesPerGenome,
    world = WORLD_CONFIG,
  }: EvaluatePopulationOptions,
): PopulationEvaluation {
  if (population.length === 0) {
    throw new RangeError("Population cannot be empty.");
  }
  if (!Number.isSafeInteger(episodesPerGenome) || episodesPerGenome <= 0) {
    throw new RangeError("episodesPerGenome must be a positive safe integer.");
  }

  const episodeSeeds = Array.from({ length: episodesPerGenome }, (_, index) =>
    deriveEpisodeSeed(runSeed, generation, index),
  );
  const genomes = population.map((genome, populationIndex) =>
    evaluateGenome({
      genome,
      populationIndex,
      episodeSeeds,
      level,
      world,
    }),
  );
  return { generation, level, episodeSeeds, genomes };
}
