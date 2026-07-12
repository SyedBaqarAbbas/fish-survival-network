# Checkpoint Format

Run checkpoints are strict, versioned JSON-compatible records shared by browser IndexedDB persistence and the checked-in starter artifact. `src/persistence/checkpoint.ts` is the executable source of truth; this document describes schema version 1.

## Top-Level Record

```text
RunCheckpoint {
  schemaVersion: 1
  kind: "run"
  runId: string
  savedAt: ISO-8601 timestamp with an offset
  world: WorldConfig
  evolution: SerializedEvolutionRunState
  metricHistory: GenerationMetric[]
  replaySource?: SerializedReplaySource
}
```

`world` contains the positive finite width, height, fixed timestep, and episode duration used by the run.

`evolution` contains:

- The uint32 run seed, current generation, and seeded PRNG state
- The complete serialized population
- Curriculum level, consecutive stable-generation count, and archived level champions
- Population, elite, tournament, crossover, mutation, episode, weight-bound, and curriculum configuration

Each generation metric records its generation and level, best and mean fitness, champion and median survival rates, measured duration, and whether the curriculum advanced.

When present, `replaySource` contains exactly 48 ranked evaluated genomes, their fitness and survival rates, a champion genome ID, and source/run/generation/level identity. Its world configuration is inherited from the checkpoint.

## Genome Encoding

The fixed policy topology is `11 -> 8 -> 2`. Every serialized genome contains four Float32 vectors:

| Field | Float32 values |
| --- | ---: |
| `inputToHidden` | 88 |
| `hiddenBias` | 8 |
| `hiddenToOutput` | 16 |
| `outputBias` | 2 |

Vectors use this strict wrapper:

```json
{
  "encoding": "f32-le-base64",
  "length": 88,
  "data": "...canonical Base64..."
}
```

Values are serialized as IEEE-754 Float32 bytes in little-endian order. The decoder rejects noncanonical Base64, incorrect byte lengths, nonfinite parameters, topology mismatches, duplicate genome IDs, and invalid evolution configuration.

## Coherent Save Boundary

A checkpoint represents the state after one whole generation has been evaluated and the next population has been reproduced. It may include the ranked replay roster from the evaluated generation. Partial evaluation arrays and in-progress task state are never persisted.

Pause and explicit checkpoint requests operate at cooperative worker boundaries. After a worker crash, the client restores the last completed checkpoint in a paused state. Work performed after that boundary is intentionally repeated after resume.

## IndexedDB Layout

The local database is:

| Property | Value |
| --- | --- |
| Database | `fish-survival-network` |
| Database version | `1` |
| Active store | `active` |
| Active key | `active` |
| Quarantine store | `quarantine` |
| Quarantine retention | Newest 5 records |

The active store contains at most one run checkpoint. Repository operations are queued, records are cloned at ownership boundaries, and an older generation from the same run cannot overwrite a newer generation.

An invalid or unsupported active record is removed from the active store and added to quarantine with its raw value, validation reason, issues, and quarantine timestamp. When IndexedDB is unavailable or a write fails, the last known good checkpoint remains in memory for the current session and the UI reports that persistence is degraded.

## Compatibility

Schema version 1 is the only supported version. There is no migration from unknown future or legacy versions; those records are quarantined rather than guessed into the current shape. The strict decoder rejects unknown object properties and cross-field inconsistencies.

Changing any serialized field, invariant, vector encoding, or persistence meaning requires a new checkpoint schema version and an explicit migration or rejection policy. Changing the IndexedDB store layout independently requires a database version upgrade.

The bundled Level 6 artifact uses the same checkpoint codec and adds a checksum sidecar for release validation. The server validates the full artifact but sends only an owned replay roster and metric history to the initial browser page. V1 does not provide checkpoint import/export controls.
