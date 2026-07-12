import {
  evaluateGenome,
  genomeParametersEqual,
} from "@/evolution";
import {
  parseRunCheckpoint,
  type RestoredRunCheckpoint,
  type RunCheckpoint,
} from "@/persistence";
import { REPLAY_FISH_COUNT, type ReplaySource } from "@/replay";
import { WORLD_CONFIG } from "@/simulation/config";
import { deriveEpisodeSeed } from "@/simulation/random";
import type { CurriculumLevel } from "@/simulation/types";

import {
  STARTER_COMPLETED_GENERATIONS,
  STARTER_EVOLUTION_CONFIG,
  STARTER_EXPECTED_CHAMPION_ID,
  STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS,
  STARTER_EXPECTED_HELD_OUT_SURVIVORS,
  STARTER_FINAL_EVALUATED_GENERATION,
  STARTER_HELD_OUT_EPISODE_COUNT,
  STARTER_HELD_OUT_GENERATION,
  STARTER_HELD_OUT_MEAN_TOLERANCE,
  STARTER_HELD_OUT_RUN_SEED,
  STARTER_REPLAY_SOURCE_ID,
  STARTER_RUN_ID,
  STARTER_RUN_SEED,
  STARTER_SAVED_AT,
  starterChampionGeneration,
  starterLevelForGeneration,
} from "./config";

export interface StarterCheckpointValidationIssue {
  path: Array<string | number>;
  code: string;
  message: string;
}

export interface StarterHeldOutReport {
  runSeed: number;
  generation: number;
  seeds: number[];
  survivors: number;
  episodeCount: number;
  survivalRate: number;
  meanAliveSeconds: number;
}

export interface StarterValidationReport {
  runId: string;
  savedAt: string;
  runSeed: number;
  completedGenerations: number;
  level: CurriculumLevel;
  championLevels: CurriculumLevel[];
  championGenomeId: string;
  replayPopulationSize: number;
  heldOut: StarterHeldOutReport;
}

export interface StarterValidationResult {
  checkpoint: RunCheckpoint;
  restored: RestoredRunCheckpoint;
  replaySource: ReplaySource;
  report: StarterValidationReport;
}

export class StarterCheckpointValidationError extends Error {
  readonly issues: StarterCheckpointValidationIssue[];

  constructor(issues: StarterCheckpointValidationIssue[]) {
    super(issues[0]?.message ?? "Invalid bundled starter checkpoint.");
    this.name = "StarterCheckpointValidationError";
    this.issues = issues.map((issue) => ({
      ...issue,
      path: [...issue.path],
    }));
  }
}

function issue(
  issues: StarterCheckpointValidationIssue[],
  path: Array<string | number>,
  code: string,
  message: string,
) {
  issues.push({ path, code, message });
}

function sameRecord(actual: object, expected: object) {
  const actualValues = actual as Record<string, unknown>;
  const expectedValues = expected as Record<string, unknown>;
  const keys = Object.keys(expectedValues);
  return (
    keys.length === Object.keys(actualValues).length &&
    keys.every((key) => Object.is(actualValues[key], expectedValues[key]))
  );
}

function assertCanonicalIdentity(
  restored: Readonly<RestoredRunCheckpoint>,
  issues: StarterCheckpointValidationIssue[],
) {
  if (restored.runId !== STARTER_RUN_ID) {
    issue(issues, ["runId"], "starter_run_id", `runId must be ${STARTER_RUN_ID}.`);
  }
  if (restored.savedAt !== STARTER_SAVED_AT) {
    issue(
      issues,
      ["savedAt"],
      "starter_saved_at",
      `savedAt must be ${STARTER_SAVED_AT}.`,
    );
  }
  if (restored.state.runSeed !== STARTER_RUN_SEED) {
    issue(
      issues,
      ["evolution", "runSeed"],
      "starter_run_seed",
      `runSeed must be ${STARTER_RUN_SEED}.`,
    );
  }
  if (restored.state.generation !== STARTER_COMPLETED_GENERATIONS) {
    issue(
      issues,
      ["evolution", "generation"],
      "starter_generation",
      `Starter must contain ${STARTER_COMPLETED_GENERATIONS} completed generations.`,
    );
  }
  if (restored.state.curriculum.level !== 6) {
    issue(
      issues,
      ["evolution", "curriculum", "level"],
      "starter_level",
      "Starter curriculum must be at level 6.",
    );
  }
  if (!sameRecord(restored.world, WORLD_CONFIG)) {
    issue(
      issues,
      ["world"],
      "starter_world",
      "Starter world must match the canonical simulation world.",
    );
  }
  if (
    !sameRecord(restored.state.config, STARTER_EVOLUTION_CONFIG)
  ) {
    issue(
      issues,
      ["evolution", "config"],
      "starter_evolution_config",
      "Starter evolution config does not match the pinned robust recipe.",
    );
  }
}

function assertHistory(
  restored: Readonly<RestoredRunCheckpoint>,
  issues: StarterCheckpointValidationIssue[],
) {
  if (restored.metricHistory.length !== STARTER_COMPLETED_GENERATIONS) return;

  restored.metricHistory.forEach((metric, generation) => {
    const path = ["metricHistory", generation] as Array<string | number>;
    const expectedLevel = starterLevelForGeneration(generation);
    if (metric.generation !== generation || metric.level !== expectedLevel) {
      issue(
        issues,
        path,
        "starter_history_schedule",
        `Generation ${generation} must be trained at level ${expectedLevel}.`,
      );
    }
    if (metric.durationMilliseconds !== 0) {
      issue(
        issues,
        [...path, "durationMilliseconds"],
        "starter_history_duration",
        "Bundled training durations must be normalized to zero.",
      );
    }
    const shouldAdvance = [2, 5, 8, 11, 14, 17].includes(generation);
    if (metric.curriculumAdvanced !== shouldAdvance) {
      issue(
        issues,
        [...path, "curriculumAdvanced"],
        "starter_history_transition",
        `Generation ${generation} has an invalid curriculum transition flag.`,
      );
    }
  });
}

function assertChampionArchive(
  restored: Readonly<RestoredRunCheckpoint>,
  replaySource: Readonly<ReplaySource>,
  issues: StarterCheckpointValidationIssue[],
) {
  const championLevels = Object.keys(restored.state.curriculum.champions)
    .map(Number)
    .sort((left, right) => left - right);
  if (
    championLevels.length !== 7 ||
    championLevels.some((level, index) => level !== index)
  ) {
    issue(
      issues,
      ["evolution", "curriculum", "champions"],
      "starter_champion_levels",
      "Starter must archive exactly one champion for every level 0 through 6.",
    );
  }

  for (let level = 0; level <= 6; level += 1) {
    const curriculumLevel = level as CurriculumLevel;
    const champion = restored.state.curriculum.champions[curriculumLevel];
    if (!champion) continue;
    const expectedGeneration = starterChampionGeneration(curriculumLevel);
    if (champion.generation !== expectedGeneration) {
      issue(
        issues,
        ["evolution", "curriculum", "champions", level, "generation"],
        "starter_champion_generation",
        `Level ${level} champion must come from generation ${expectedGeneration}.`,
      );
    }
  }

  const finalChampion = restored.state.curriculum.champions[6];
  const replayChampion = replaySource.entries[0];
  if (!finalChampion || !replayChampion) return;
  if (
    replaySource.championGenomeId !== replayChampion.genome.id ||
    replayChampion.genome.id !== finalChampion.genome.id ||
    !genomeParametersEqual(replayChampion.genome, finalChampion.genome)
  ) {
    issue(
      issues,
      ["replaySource", "entries", 0],
      "starter_champion_mismatch",
      "The first replay genome must byte-match the archived level 6 champion.",
    );
  }
  if (
    replayChampion.fitness !== finalChampion.evaluation.fitness ||
    replayChampion.survivalRate !== finalChampion.evaluation.survivalRate
  ) {
    issue(
      issues,
      ["replaySource", "entries", 0],
      "starter_champion_metadata",
      "Replay champion metadata must match its archived evaluation.",
    );
  }
}

function assertReplayRoster(
  replaySource: Readonly<ReplaySource>,
  issues: StarterCheckpointValidationIssue[],
) {
  if (replaySource.sourceId !== STARTER_REPLAY_SOURCE_ID) {
    issue(
      issues,
      ["replaySource", "sourceId"],
      "starter_replay_source_id",
      `Replay sourceId must be ${STARTER_REPLAY_SOURCE_ID}.`,
    );
  }
  if (
    replaySource.runId !== STARTER_RUN_ID ||
    replaySource.generation !== STARTER_FINAL_EVALUATED_GENERATION ||
    replaySource.level !== 6
  ) {
    issue(
      issues,
      ["replaySource"],
      "starter_replay_provenance",
      "Replay roster must be the final pre-reproduction level 6 ranking.",
    );
  }
  if (replaySource.championGenomeId !== STARTER_EXPECTED_CHAMPION_ID) {
    issue(
      issues,
      ["replaySource", "championGenomeId"],
      "starter_expected_champion",
      `Starter champion must be ${STARTER_EXPECTED_CHAMPION_ID}.`,
    );
  }
  if (replaySource.entries.length !== REPLAY_FISH_COUNT) return;

  const genomeIds = new Set<string>();
  replaySource.entries.forEach((entry, index) => {
    const path = ["replaySource", "entries", index] as Array<string | number>;
    if (entry.fitness === null || entry.survivalRate === null) {
      issue(
        issues,
        path,
        "starter_replay_metadata",
        "Every starter replay entry requires fitness and survival metadata.",
      );
    }
    if (genomeIds.has(entry.genome.id)) {
      issue(
        issues,
        [...path, "genome", "id"],
        "starter_replay_duplicate",
        `Duplicate starter replay genome ${entry.genome.id}.`,
      );
    }
    genomeIds.add(entry.genome.id);
    const previous = replaySource.entries[index - 1];
    if (
      previous &&
      previous.fitness !== null &&
      entry.fitness !== null &&
      previous.fitness < entry.fitness
    ) {
      issue(
        issues,
        [...path, "fitness"],
        "starter_replay_order",
        "Starter replay entries must remain ordered by descending fitness.",
      );
    }
  });
}

function createHeldOutReport(champion: ReplaySource["entries"][number]) {
  const seeds = Array.from({ length: STARTER_HELD_OUT_EPISODE_COUNT }, (_, index) =>
    deriveEpisodeSeed(
      STARTER_HELD_OUT_RUN_SEED,
      STARTER_HELD_OUT_GENERATION,
      index,
    ),
  );
  const evaluation = evaluateGenome({
    genome: champion.genome,
    populationIndex: 0,
    episodeSeeds: seeds,
    level: 6,
    world: WORLD_CONFIG,
  });
  const survivors = evaluation.episodes.filter(
    (episode) => episode.stats.survived,
  ).length;
  return {
    runSeed: STARTER_HELD_OUT_RUN_SEED,
    generation: STARTER_HELD_OUT_GENERATION,
    seeds,
    survivors,
    episodeCount: evaluation.episodes.length,
    survivalRate: evaluation.survivalRate,
    meanAliveSeconds: evaluation.meanAliveSeconds,
  } satisfies StarterHeldOutReport;
}

function assertHeldOut(
  report: Readonly<StarterHeldOutReport>,
  issues: StarterCheckpointValidationIssue[],
) {
  const trainingSeeds = new Set<number>();
  for (let generation = 0; generation < STARTER_COMPLETED_GENERATIONS; generation += 1) {
    for (
      let episodeIndex = 0;
      episodeIndex < STARTER_EVOLUTION_CONFIG.episodesPerGenome;
      episodeIndex += 1
    ) {
      trainingSeeds.add(
        deriveEpisodeSeed(STARTER_RUN_SEED, generation, episodeIndex),
      );
    }
  }
  if (report.seeds.some((seed) => trainingSeeds.has(seed))) {
    issue(
      issues,
      ["heldOut", "seeds"],
      "starter_held_out_overlap",
      "Held-out validation seeds must be disjoint from all training seeds.",
    );
  }
  if (report.survivors !== STARTER_EXPECTED_HELD_OUT_SURVIVORS) {
    issue(
      issues,
      ["heldOut", "survivors"],
      "starter_held_out_survivors",
      `Starter champion must survive ${STARTER_EXPECTED_HELD_OUT_SURVIVORS} of ${STARTER_HELD_OUT_EPISODE_COUNT} held-out episodes.`,
    );
  }
  if (
    Math.abs(
      report.meanAliveSeconds -
        STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS,
    ) > STARTER_HELD_OUT_MEAN_TOLERANCE
  ) {
    issue(
      issues,
      ["heldOut", "meanAliveSeconds"],
      "starter_held_out_mean",
      `Starter held-out mean alive time must be ${STARTER_EXPECTED_HELD_OUT_MEAN_ALIVE_SECONDS}.`,
    );
  }
}

export function validateStarterCheckpoint(
  value: unknown,
): StarterValidationResult {
  const parsed = parseRunCheckpoint(value);
  if (!parsed.success) {
    throw new StarterCheckpointValidationError(
      parsed.issues.map((baseIssue) => ({
        ...baseIssue,
        code: `checkpoint_${baseIssue.code}`,
      })),
    );
  }
  const { checkpoint, restored } = parsed;
  const replaySource = restored.replaySource;
  if (!replaySource) {
    throw new StarterCheckpointValidationError([
      {
        path: ["replaySource"],
        code: "starter_replay_missing",
        message: "Bundled starter checkpoint requires a replay roster.",
      },
    ]);
  }

  const issues: StarterCheckpointValidationIssue[] = [];
  assertCanonicalIdentity(restored, issues);
  assertHistory(restored, issues);
  assertReplayRoster(replaySource, issues);
  assertChampionArchive(restored, replaySource, issues);

  const heldOut = createHeldOutReport(replaySource.entries[0]);
  assertHeldOut(heldOut, issues);
  if (issues.length > 0) throw new StarterCheckpointValidationError(issues);

  return {
    checkpoint,
    restored,
    replaySource,
    report: {
      runId: restored.runId,
      savedAt: restored.savedAt,
      runSeed: restored.state.runSeed,
      completedGenerations: restored.state.generation,
      level: restored.state.curriculum.level,
      championLevels: Object.keys(restored.state.curriculum.champions)
        .map(Number)
        .sort((left, right) => left - right) as CurriculumLevel[],
      championGenomeId: replaySource.championGenomeId,
      replayPopulationSize: replaySource.entries.length,
      heldOut,
    },
  };
}
