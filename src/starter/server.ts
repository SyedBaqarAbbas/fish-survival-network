import { createHash } from "node:crypto";

import rawStarterCheckpoint from "./artifacts/level-6-starter.v1.json";

import { cloneReplaySource, type ReplaySource } from "@/replay";

import { STARTER_EXPECTED_ARTIFACT_SHA256 } from "./config";
import { validateStarterCheckpoint } from "./validation";

// Only server components import this module; clients receive an owned clone.
const serializedStarterCheckpoint = `${JSON.stringify(rawStarterCheckpoint, null, 2)}\n`;
const starterArtifactSha256 = createHash("sha256")
  .update(serializedStarterCheckpoint, "utf8")
  .digest("hex");
if (starterArtifactSha256 !== STARTER_EXPECTED_ARTIFACT_SHA256) {
  throw new Error(
    `Bundled starter checksum mismatch: expected ${STARTER_EXPECTED_ARTIFACT_SHA256}, received ${starterArtifactSha256}.`,
  );
}
const canonicalStarterReplaySource = validateStarterCheckpoint(
  rawStarterCheckpoint,
).replaySource;

export function getStarterReplaySource(): ReplaySource {
  return cloneReplaySource(canonicalStarterReplaySource);
}
