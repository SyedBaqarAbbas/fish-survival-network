import "fake-indexeddb/auto";

import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";

import { createCheckpointRepository } from "./repository";
import type { CheckpointRepository } from "./types";
import { makeCheckpoint } from "./__tests__/fixtures";

let databaseIndex = 0;
const repositories: CheckpointRepository[] = [];

function databaseName() {
  databaseIndex += 1;
  return `fish-survival-test-${databaseIndex}`;
}

function repository(options: Parameters<typeof createCheckpointRepository>[0] = {}) {
  const value = createCheckpointRepository(options);
  repositories.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((value) => value.close()));
});

describe("checkpoint repository", () => {
  it("stores one active checkpoint and restores it across repository instances", async () => {
    const name = databaseName();
    const first = repository({ databaseName: name });
    const generationZero = makeCheckpoint();
    const generationOne = makeCheckpoint(1);

    expect(await first.saveActive(generationZero)).toMatchObject({
      backend: "indexeddb",
      checkpoint: { evolution: { generation: 0 } },
    });
    expect(await first.saveActive(generationOne)).toMatchObject({
      backend: "indexeddb",
      checkpoint: { evolution: { generation: 1 } },
    });
    await first.close();

    const second = repository({ databaseName: name });
    expect(await second.loadActive()).toMatchObject({
      backend: "indexeddb",
      checkpoint: { evolution: { generation: 1 } },
    });
  });

  it("returns owned last-known-good snapshots", async () => {
    const value = repository({ databaseName: databaseName() });
    await value.saveActive(makeCheckpoint());
    const first = value.getLastKnownGood();
    expect(first.checkpoint).toBeDefined();
    first.checkpoint!.runId = "mutated";
    expect(value.getLastKnownGood().checkpoint?.runId).toBe("test-run");
  });

  it("atomically moves invalid and future active values to quarantine", async () => {
    const name = databaseName();
    const database = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("active");
        db.createObjectStore("quarantine", { autoIncrement: true });
      },
    });
    await database.put(
      "active",
      { ...makeCheckpoint(), schemaVersion: 9 },
      "active",
    );
    database.close();

    const value = repository({
      databaseName: name,
      now: () => "2026-07-12T02:00:00.000Z",
    });
    expect(await value.loadActive()).toMatchObject({
      backend: "indexeddb",
      warning: {
        code: "CHECKPOINT_QUARANTINED",
        validationReason: "UNSUPPORTED_VERSION",
      },
    });

    const inspection = await openDB(name, 1);
    expect(await inspection.get("active", "active")).toBeUndefined();
    expect(await inspection.getAll("quarantine")).toEqual([
      expect.objectContaining({
        quarantinedAt: "2026-07-12T02:00:00.000Z",
        reason: "UNSUPPORTED_VERSION",
        raw: expect.objectContaining({ schemaVersion: 9 }),
      }),
    ]);
    inspection.close();
  });

  it("uses a sticky in-memory fallback when IndexedDB cannot open", async () => {
    const value = repository({
      openDatabase: async () => {
        throw new Error("blocked");
      },
    });
    expect(await value.loadActive()).toMatchObject({
      backend: "memory",
      warning: { code: "INDEXED_DB_UNAVAILABLE" },
    });
    expect(await value.saveActive(makeCheckpoint())).toMatchObject({
      backend: "memory",
      checkpoint: { runId: "test-run" },
      warning: { code: "INDEXED_DB_UNAVAILABLE" },
    });
    expect(value.getLastKnownGood()).toMatchObject({
      backend: "memory",
      checkpoint: { runId: "test-run" },
    });
  });

  it("keeps the completed checkpoint in memory when an IndexedDB write fails", async () => {
    const value = repository({
      openDatabase: async () =>
        ({
          put: async () => {
            throw new Error("quota exceeded");
          },
          close() {},
        }) as never,
    });
    expect(await value.saveActive(makeCheckpoint())).toMatchObject({
      backend: "memory",
      checkpoint: { evolution: { generation: 0 } },
      warning: { code: "INDEXED_DB_WRITE_FAILED" },
    });
  });

  it("serializes writes and refuses same-run generation regression", async () => {
    const generations: number[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const value = repository({
      openDatabase: async () =>
        ({
          async put(_store: string, checkpoint: ReturnType<typeof makeCheckpoint>) {
            generations.push(checkpoint.evolution.generation);
            if (generations.length === 1) {
              markFirstStarted();
              await firstWrite;
            }
          },
          close() {},
        }) as never,
    });

    const zeroSave = value.saveActive(makeCheckpoint());
    const oneSave = value.saveActive(makeCheckpoint(1));
    await firstStarted;
    expect(generations).toEqual([0]);
    releaseFirst();
    await Promise.all([zeroSave, oneSave]);
    expect(generations).toEqual([0, 1]);

    expect(await value.saveActive(makeCheckpoint())).toMatchObject({
      checkpoint: { evolution: { generation: 1 } },
      warning: { code: "CHECKPOINT_REJECTED" },
    });
  });

  it("clears the in-memory and persisted active checkpoint", async () => {
    const name = databaseName();
    const value = repository({ databaseName: name });
    await value.saveActive(makeCheckpoint());
    expect(await value.clearActive()).toEqual({ backend: "indexeddb" });
    expect(value.getLastKnownGood()).toEqual({ backend: "indexeddb" });

    const inspection = await openDB(name, 1);
    expect(await inspection.get("active", "active")).toBeUndefined();
    inspection.close();
  });
});
