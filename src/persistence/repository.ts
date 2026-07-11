import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import { parseRunCheckpoint } from "./checkpoint";
import type {
  CheckpointRepository,
  CheckpointRepositoryResult,
  PersistenceBackendName,
  PersistenceWarning,
  QuarantinedCheckpoint,
  RunCheckpoint,
} from "./types";

export const CHECKPOINT_DATABASE_NAME = "fish-survival-network";
export const CHECKPOINT_DATABASE_VERSION = 1;
export const ACTIVE_CHECKPOINT_KEY = "active" as const;
export const ACTIVE_CHECKPOINT_STORE = "active" as const;
export const QUARANTINE_CHECKPOINT_STORE = "quarantine" as const;

const DEFAULT_QUARANTINE_LIMIT = 5;

interface CheckpointDatabase extends DBSchema {
  active: {
    key: typeof ACTIVE_CHECKPOINT_KEY;
    value: unknown;
  };
  quarantine: {
    key: number;
    value: QuarantinedCheckpoint;
  };
}

type OpenCheckpointDatabase = () => Promise<IDBPDatabase<CheckpointDatabase>>;

export interface CreateCheckpointRepositoryOptions {
  databaseName?: string;
  now?: () => string;
  openDatabase?: OpenCheckpointDatabase;
  quarantineLimit?: number;
}

function cloneCheckpoint(checkpoint: RunCheckpoint) {
  return structuredClone(checkpoint);
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown IndexedDB error.";
}

function openCheckpointDatabase(databaseName: string) {
  return openDB<CheckpointDatabase>(
    databaseName,
    CHECKPOINT_DATABASE_VERSION,
    {
      upgrade(database) {
        if (!database.objectStoreNames.contains(ACTIVE_CHECKPOINT_STORE)) {
          database.createObjectStore(ACTIVE_CHECKPOINT_STORE);
        }
        if (!database.objectStoreNames.contains(QUARANTINE_CHECKPOINT_STORE)) {
          database.createObjectStore(QUARANTINE_CHECKPOINT_STORE, {
            autoIncrement: true,
          });
        }
      },
    },
  );
}

export class IndexedDbCheckpointRepository implements CheckpointRepository {
  private readonly openDatabase: OpenCheckpointDatabase;
  private readonly now: () => string;
  private readonly quarantineLimit: number;
  private backend: PersistenceBackendName = "indexeddb";
  private databasePromise?: Promise<IDBPDatabase<CheckpointDatabase>>;
  private lastKnownGood?: RunCheckpoint;
  private stickyWarning?: PersistenceWarning;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor({
    databaseName = CHECKPOINT_DATABASE_NAME,
    now = () => new Date().toISOString(),
    openDatabase: injectedOpenDatabase,
    quarantineLimit = DEFAULT_QUARANTINE_LIMIT,
  }: CreateCheckpointRepositoryOptions = {}) {
    if (!Number.isSafeInteger(quarantineLimit) || quarantineLimit <= 0) {
      throw new RangeError("quarantineLimit must be a positive safe integer.");
    }
    this.openDatabase =
      injectedOpenDatabase ?? (() => openCheckpointDatabase(databaseName));
    this.now = now;
    this.quarantineLimit = quarantineLimit;
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async database() {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private result(
    checkpoint = this.lastKnownGood,
    warning = this.stickyWarning,
  ): CheckpointRepositoryResult {
    return {
      ...(checkpoint ? { checkpoint: cloneCheckpoint(checkpoint) } : {}),
      backend: this.backend,
      ...(warning ? { warning: { ...warning } } : {}),
    };
  }

  private useMemory(warning: PersistenceWarning) {
    this.backend = "memory";
    this.stickyWarning = warning;
    const databasePromise = this.databasePromise;
    this.databasePromise = undefined;
    void databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
  }

  async loadActive() {
    return this.enqueue(async () => {
      if (this.backend === "memory") return this.result();

      try {
        const database = await this.database();
        const transaction = database.transaction(
          [ACTIVE_CHECKPOINT_STORE, QUARANTINE_CHECKPOINT_STORE],
          "readwrite",
        );
        const activeStore = transaction.objectStore(ACTIVE_CHECKPOINT_STORE);
        const quarantineStore = transaction.objectStore(
          QUARANTINE_CHECKPOINT_STORE,
        );
        const raw = await activeStore.get(ACTIVE_CHECKPOINT_KEY);
        if (raw === undefined) {
          await transaction.done;
          this.lastKnownGood = undefined;
          return this.result(undefined, undefined);
        }

        const parsed = parseRunCheckpoint(raw);
        if (parsed.success) {
          await transaction.done;
          this.lastKnownGood = cloneCheckpoint(parsed.checkpoint);
          return this.result(this.lastKnownGood, undefined);
        }

        await quarantineStore.add({
          quarantinedAt: this.now(),
          reason: parsed.reason,
          issues: parsed.issues,
          raw,
        });
        await activeStore.delete(ACTIVE_CHECKPOINT_KEY);
        const quarantineKeys = await quarantineStore.getAllKeys();
        const excessCount = quarantineKeys.length - this.quarantineLimit;
        for (let index = 0; index < excessCount; index += 1) {
          await quarantineStore.delete(quarantineKeys[index]);
        }
        await transaction.done;
        this.lastKnownGood = undefined;
        return this.result(undefined, {
          code: "CHECKPOINT_QUARANTINED",
          message: "The saved checkpoint was invalid and has been quarantined.",
          validationReason: parsed.reason,
          issues: parsed.issues,
        });
      } catch (error) {
        this.useMemory({
          code: "INDEXED_DB_UNAVAILABLE",
          message: `IndexedDB is unavailable; checkpoints will remain in memory for this session. ${errorMessage(error)}`,
        });
        return this.result();
      }
    });
  }

  async saveActive(checkpoint: RunCheckpoint) {
    const parsed = parseRunCheckpoint(checkpoint);
    if (!parsed.success) {
      return this.result(this.lastKnownGood, {
        code: "CHECKPOINT_REJECTED",
        message: "The checkpoint was rejected before persistence.",
        validationReason: parsed.reason,
        issues: parsed.issues,
      });
    }

    const canonical = cloneCheckpoint(parsed.checkpoint);
    if (
      this.lastKnownGood?.runId === canonical.runId &&
      canonical.evolution.generation <
        this.lastKnownGood.evolution.generation
    ) {
      return this.result(this.lastKnownGood, {
        code: "CHECKPOINT_REJECTED",
        message: "A checkpoint cannot replace a newer generation from the same run.",
      });
    }

    this.lastKnownGood = cloneCheckpoint(canonical);
    return this.enqueue(async () => {
      if (this.backend === "memory") return this.result(canonical);

      try {
        const database = await this.database();
        await database.put(
          ACTIVE_CHECKPOINT_STORE,
          canonical,
          ACTIVE_CHECKPOINT_KEY,
        );
        return this.result(canonical, undefined);
      } catch (error) {
        this.useMemory({
          code: "INDEXED_DB_WRITE_FAILED",
          message: `The checkpoint remains available in memory, but IndexedDB could not save it. ${errorMessage(error)}`,
        });
        return this.result(canonical);
      }
    });
  }

  async clearActive() {
    this.lastKnownGood = undefined;
    return this.enqueue(async () => {
      if (this.backend === "memory") return this.result();

      try {
        const database = await this.database();
        await database.delete(ACTIVE_CHECKPOINT_STORE, ACTIVE_CHECKPOINT_KEY);
        return this.result(undefined, undefined);
      } catch (error) {
        this.useMemory({
          code: "CLEAR_FAILED",
          message: `The in-memory checkpoint was cleared, but IndexedDB could not be cleared. ${errorMessage(error)}`,
        });
        return this.result();
      }
    });
  }

  getLastKnownGood() {
    return this.result();
  }

  async close() {
    await this.enqueue(async () => {
      const databasePromise = this.databasePromise;
      this.databasePromise = undefined;
      if (databasePromise) {
        const database = await databasePromise.catch(() => undefined);
        database?.close();
      }
    });
  }
}

export function createCheckpointRepository(
  options: CreateCheckpointRepositoryOptions = {},
): CheckpointRepository {
  return new IndexedDbCheckpointRepository(options);
}
