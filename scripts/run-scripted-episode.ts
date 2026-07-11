import { runScriptedEpisode, UINT32_MAX } from "../src/simulation";

const requestedSeed = Number(process.argv[2] ?? 42);
if (
  !Number.isSafeInteger(requestedSeed) ||
  requestedSeed < 0 ||
  requestedSeed > UINT32_MAX
) {
  throw new RangeError(`Seed must be an integer from 0 to ${UINT32_MAX}.`);
}

const state = runScriptedEpisode({ seed: requestedSeed });
console.log(
  JSON.stringify(
    {
      seed: requestedSeed,
      steps: state.step,
      elapsedSeconds: state.elapsedSeconds,
      catches: state.stats.catchCount,
      fishSurvived: state.fish.filter((fish) => fish.alive).length,
      fishWallCollisions: Array.from(state.stats.fishWallCollisions),
      predatorWallCollisions: state.stats.predatorWallCollisions,
    },
    null,
    2,
  ),
);
