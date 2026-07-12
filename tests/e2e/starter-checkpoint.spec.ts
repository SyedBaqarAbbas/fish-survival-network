import { expect, test } from "@playwright/test";

interface CapturedWorkerRecord {
  commands: unknown[];
  name: string;
  terminated: boolean;
}

interface StarterHarnessWindow extends Window {
  __starterWorkers: CapturedWorkerRecord[];
}

test("opens the bundled Level 6 starter on a clean first launch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const harness = window as unknown as StarterHarnessWindow;
    const NativeWorker = window.Worker;
    harness.__starterWorkers = [];

    window.Worker = class InstrumentedWorker extends NativeWorker {
      private record?: CapturedWorkerRecord;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = {
          commands: [],
          name: options?.name ?? "",
          terminated: false,
        };
        harness.__starterWorkers.push(this.record);
      }

      override postMessage(
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        this.record?.commands.push(structuredClone(message));
        if (options === undefined) {
          super.postMessage(message);
        } else if (Array.isArray(options)) {
          super.postMessage(message, options);
        } else {
          super.postMessage(message, options);
        }
      }

      override terminate() {
        if (this.record) this.record.terminated = true;
        super.terminate();
      }
    };
  });

  await page.goto("/");

  const canvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("data-ready", "true");

  const readFirstLaunch = () =>
    page.evaluate(() => {
      const records = (window as unknown as StarterHarnessWindow)
        .__starterWorkers;
      const replay = records.find(
        (record) =>
          record.name === "fish-survival-replay" && !record.terminated,
      );
      const trainer = records.find(
        (record) =>
          record.name === "fish-survival-trainer" && !record.terminated,
      );
      const load = replay?.commands.find(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "LOAD",
      ) as
        | {
            source?: {
              championGenomeId?: string;
              entries?: Array<{ genome?: { id?: string } }>;
              level?: number;
              sourceId?: string;
            };
          }
        | undefined;
      const initialize = trainer?.commands.find(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "INITIALIZE",
      ) as Record<string, unknown> | undefined;

      if (!load?.source || !initialize) return null;
      const genomeIds =
        load.source.entries?.map((entry) => entry.genome?.id) ?? [];
      return {
        championGenomeId: load.source.championGenomeId,
        championIsFirst: genomeIds[0] === load.source.championGenomeId,
        entryCount: load.source.entries?.length,
        hasTrainerCheckpoint: "checkpoint" in initialize,
        level: load.source.level,
        sourceId: load.source.sourceId,
        uniqueEntryCount: new Set(genomeIds).size,
      };
    });

  await expect.poll(readFirstLaunch).not.toBeNull();
  const firstLaunch = await readFirstLaunch();

  expect(firstLaunch).toEqual({
    championGenomeId: "g37-i60",
    championIsFirst: true,
    entryCount: 48,
    hasTrainerCheckpoint: false,
    level: 6,
    sourceId: "bundled-level-6-v1:generation:37",
    uniqueEntryCount: 48,
  });
});
