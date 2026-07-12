import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { genomeFloat32Bytes } from "../src/persistence";
import {
  STARTER_ARTIFACT_FILENAME,
  STARTER_CHECKSUM_FILENAME,
  STARTER_EXPECTED_ARTIFACT_SHA256,
  STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256,
} from "../src/starter/config";
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

async function main() {
  const [artifact, checksumSidecar] = await Promise.all([
    readFile(artifactPath, "utf8"),
    readFile(checksumPath, "utf8"),
  ]);
  const parsed: unknown = JSON.parse(artifact);
  const canonicalArtifact = `${JSON.stringify(parsed, null, 2)}\n`;
  if (artifact !== canonicalArtifact) {
    throw new Error(
      "Starter artifact must be pretty-printed JSON with one trailing newline.",
    );
  }

  const validation = validateStarterCheckpoint(parsed);
  const sha256 = createHash("sha256").update(artifact, "utf8").digest("hex");
  const championFloat32Sha256 = createHash("sha256")
    .update(genomeFloat32Bytes(validation.replaySource.entries[0].genome))
    .digest("hex");
  if (sha256 !== STARTER_EXPECTED_ARTIFACT_SHA256) {
    throw new Error(`Unexpected starter artifact SHA-256 ${sha256}.`);
  }
  if (championFloat32Sha256 !== STARTER_EXPECTED_CHAMPION_FLOAT32_SHA256) {
    throw new Error(
      `Unexpected starter champion Float32 SHA-256 ${championFloat32Sha256}.`,
    );
  }
  const expectedSidecar = `${sha256}  ${STARTER_ARTIFACT_FILENAME}\n`;
  if (checksumSidecar !== expectedSidecar) {
    throw new Error(
      `Starter checksum mismatch: expected sidecar ${JSON.stringify(expectedSidecar)}.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        artifact: artifactPath,
        checksum: checksumPath,
        sha256,
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
