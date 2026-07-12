import { createHash } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { genomeFloat32Bytes } from "../src/persistence";
import {
  STARTER_ARTIFACT_FILENAME,
  STARTER_CHECKSUM_FILENAME,
  STARTER_EXPECTED_ARTIFACT_SHA256,
  STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256,
} from "../src/starter/config";
import { trainStarterCheckpoint } from "../src/starter/training";
import { validateStarterCheckpoint } from "../src/starter/validation";

const artifactPath = resolve(
  "src",
  "starter",
  "artifacts",
  STARTER_ARTIFACT_FILENAME,
);
const checksumPath = resolve(
  "src",
  "starter",
  "artifacts",
  STARTER_CHECKSUM_FILENAME,
);

async function writeAtomically(destination: string, content: string) {
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main() {
  console.log("Training deterministic bundled level 6 starter...");
  const checkpoint = trainStarterCheckpoint({
    onProgress(progress) {
      console.log(
        `[${progress.completedGenerations}/${progress.totalGenerations}] ` +
          `generation=${progress.generation} level=${progress.level} ` +
          `champion=${progress.championGenomeId} ` +
          `survival=${progress.championSurvivalRate}`,
      );
    },
  });
  const validation = validateStarterCheckpoint(checkpoint);
  const artifact = `${JSON.stringify(checkpoint, null, 2)}\n`;
  const checksum = createHash("sha256").update(artifact, "utf8").digest("hex");
  const championFloat32Sha256 = createHash("sha256")
    .update(genomeFloat32Bytes(validation.replaySource.entries[0].genome))
    .digest("hex");
  if (checksum !== STARTER_EXPECTED_ARTIFACT_SHA256) {
    throw new Error(`Unexpected starter artifact SHA-256 ${checksum}.`);
  }
  if (championFloat32Sha256 !== STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256) {
    throw new Error(
      `Unexpected starter champion Float32 SHA-256 ${championFloat32Sha256}.`,
    );
  }
  const checksumSidecar = `${checksum}  ${STARTER_ARTIFACT_FILENAME}\n`;

  await writeAtomically(artifactPath, artifact);
  await writeAtomically(checksumPath, checksumSidecar);

  console.log(
    JSON.stringify(
      {
        artifact: artifactPath,
        sha256: checksum,
        championFloat32Sha256,
        report: validation.report,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
