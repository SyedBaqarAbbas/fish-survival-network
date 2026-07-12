import { expect, test } from "./fixtures";

const FPS_SAMPLE_COUNT = 3;
const FPS_SAMPLE_MILLISECONDS = 2_000;
const MAX_PROGRESS_GAP_MILLISECONDS = 500;
const MAX_SNAPSHOT_BYTES = 5 * 1_024;

interface SnapshotMeasurement {
  aliveLength: number;
  byteLength: number;
  positionsLength: number;
  predatorLength: number;
  sharedBuffer: boolean;
  velocitiesLength: number;
}

interface CapturedWorkerRecord {
  commands: unknown[];
  name: string;
  terminated: boolean;
  worker: Worker;
}

interface PerformanceHarness {
  flushLongTasks: () => void;
  generationCount: number;
  longTaskObserver?: PerformanceObserver;
  longTaskSupported: boolean;
  longTasks: number[];
  monitorEndedAt?: number;
  monitorStartedAt?: number;
  progressReceivedAt: number[];
  snapshots: SnapshotMeasurement[];
  workers: CapturedWorkerRecord[];
}

interface PerformanceHarnessWindow extends Window {
  __performanceHarness: PerformanceHarness;
}

interface FpsSample {
  durationMilliseconds: number;
  framesPerSecond: number;
  renderedFrames: number;
  sequenceDelta: number;
  trainerStateAfter: string | undefined;
  trainerStateBefore: string | undefined;
}

test("keeps replay and training within the release performance budgets", async ({
  page,
}, testInfo) => {
  test.setTimeout(45_000);

  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const longTaskSupported =
      "PerformanceObserver" in window &&
      PerformanceObserver.supportedEntryTypes.includes("longtask");
    const harness: PerformanceHarness = {
      flushLongTasks: () => undefined,
      generationCount: 0,
      longTaskSupported,
      longTasks: [],
      progressReceivedAt: [],
      snapshots: [],
      workers: [],
    };
    (window as unknown as PerformanceHarnessWindow).__performanceHarness = harness;

    function collectLongTasks(entries: readonly PerformanceEntry[]) {
      const startedAt = harness.monitorStartedAt;
      if (startedAt === undefined) return;
      const endedAt = harness.monitorEndedAt;
      for (const entry of entries) {
        const overlapsTraining =
          entry.startTime + entry.duration >= startedAt &&
          (endedAt === undefined || entry.startTime <= endedAt);
        if (overlapsTraining) harness.longTasks.push(entry.duration);
      }
    }

    if (longTaskSupported) {
      const observer = new PerformanceObserver((list) => {
        collectLongTasks(list.getEntries());
      });
      observer.observe({ type: "longtask", buffered: false });
      harness.longTaskObserver = observer;
      harness.flushLongTasks = () => collectLongTasks(observer.takeRecords());
    }

    window.Worker = class InstrumentedWorker extends NativeWorker {
      private record?: CapturedWorkerRecord;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = {
          commands: [],
          name: options?.name ?? "",
          terminated: false,
          worker: this,
        };
        harness.workers.push(this.record);

        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          const value = event.data;
          if (typeof value !== "object" || value === null || !("type" in value)) {
            return;
          }

          if (this.record?.name === "fish-survival-trainer") {
            if (value.type === "PROGRESS" && harness.monitorStartedAt !== undefined) {
              harness.progressReceivedAt.push(performance.now());
            } else if (value.type === "GENERATION") {
              harness.generationCount += 1;
            }
            return;
          }

          if (this.record?.name !== "fish-survival-replay" || value.type !== "SNAPSHOT") {
            return;
          }
          const snapshot = value as {
            alive?: Uint8Array;
            positions?: Float32Array;
            predator?: Float32Array;
            velocities?: Float32Array;
          };
          if (
            !(snapshot.positions instanceof Float32Array) ||
            !(snapshot.velocities instanceof Float32Array) ||
            !(snapshot.alive instanceof Uint8Array) ||
            !(snapshot.predator instanceof Float32Array)
          ) {
            return;
          }
          const buffer = snapshot.positions.buffer;
          harness.snapshots.push({
            aliveLength: snapshot.alive.length,
            byteLength: buffer.byteLength,
            positionsLength: snapshot.positions.length,
            predatorLength: snapshot.predator.length,
            sharedBuffer:
              snapshot.velocities.buffer === buffer &&
              snapshot.alive.buffer === buffer &&
              snapshot.predator.buffer === buffer,
            velocitiesLength: snapshot.velocities.length,
          });
        });
      }

      override postMessage(
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        this.record?.commands.push(structuredClone(message));
        if (
          this.record?.name === "fish-survival-trainer" &&
          typeof message === "object" &&
          message !== null &&
          "type" in message
        ) {
          if (message.type === "START") {
            harness.longTaskObserver?.takeRecords();
            harness.generationCount = 0;
            harness.longTasks.length = 0;
            harness.progressReceivedAt.length = 0;
            harness.snapshots.length = 0;
            harness.monitorStartedAt = performance.now();
            harness.monitorEndedAt = undefined;
          } else if (
            message.type === "PAUSE" &&
            harness.monitorStartedAt !== undefined &&
            harness.monitorEndedAt === undefined
          ) {
            harness.monitorEndedAt = performance.now();
          }
        }

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
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(canvas).toHaveAttribute("data-ready", "true");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as PerformanceHarnessWindow).__performanceHarness
          .longTaskSupported,
    ),
    "Chromium must expose the Long Tasks API for this release gate.",
  ).toBe(true);

  await page.getByRole("tab", { name: "Train" }).click();
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as PerformanceHarnessWindow).__performanceHarness
              .progressReceivedAt.length,
        ),
      { message: "Training did not publish multiple progress events." },
    )
    .toBeGreaterThanOrEqual(2);

  await page.waitForTimeout(500);
  const fpsSamples = await page.evaluate(
    async ({ sampleCount, sampleMilliseconds }) => {
      const replayCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Fish survival replay"]',
      );
      const trainerStatus = document.querySelector<HTMLElement>(
        '[data-testid="worker-status"]',
      );
      if (!replayCanvas || !trainerStatus) {
        throw new Error("The replay performance probes are unavailable.");
      }

      const samples: FpsSample[] = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const trainerStateBefore = trainerStatus.dataset.state;
        const startFrame = Number(replayCanvas.dataset.frame);
        const startSequence = Number(replayCanvas.dataset.sequence);
        const startedAt = performance.now();
        await new Promise((resolve) => window.setTimeout(resolve, sampleMilliseconds));
        const durationMilliseconds = performance.now() - startedAt;
        const renderedFrames = Number(replayCanvas.dataset.frame) - startFrame;
        const sequenceDelta = Number(replayCanvas.dataset.sequence) - startSequence;
        samples.push({
          durationMilliseconds,
          framesPerSecond: (renderedFrames * 1_000) / durationMilliseconds,
          renderedFrames,
          sequenceDelta,
          trainerStateAfter: trainerStatus.dataset.state,
          trainerStateBefore,
        });
      }
      return samples;
    },
    {
      sampleCount: FPS_SAMPLE_COUNT,
      sampleMilliseconds: FPS_SAMPLE_MILLISECONDS,
    },
  );

  const fpsDiagnostics = JSON.stringify(fpsSamples, null, 2);
  expect(
    Math.min(...fpsSamples.map((sample) => sample.framesPerSecond)),
    `Every replay FPS window must meet the budget while training:\n${fpsDiagnostics}`,
  ).toBeGreaterThanOrEqual(55);
  expect(
    fpsSamples.every(
      (sample) =>
        sample.trainerStateBefore === "running" &&
        sample.trainerStateAfter === "running",
    ),
    `Training stopped during an FPS window:\n${fpsDiagnostics}`,
  ).toBe(true);
  expect(
    fpsSamples.every((sample) => sample.sequenceDelta > 0),
    `Replay snapshots did not advance during every FPS window:\n${fpsDiagnostics}`,
  ).toBe(true);

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as PerformanceHarnessWindow).__performanceHarness
              .generationCount,
        ),
      {
        message: "Training did not complete a generation for persistence verification.",
        timeout: 20_000,
      },
    )
    .toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Pause training" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "paused",
  );
  await page.waitForTimeout(100);

  const diagnostics = await page.evaluate(() => {
    const harness = (window as unknown as PerformanceHarnessWindow)
      .__performanceHarness;
    harness.flushLongTasks();
    const startedAt = harness.monitorStartedAt;
    const endedAt = harness.monitorEndedAt;
    if (startedAt === undefined || endedAt === undefined) {
      throw new Error("The training measurement interval is incomplete.");
    }
    const progressReceivedAt = harness.progressReceivedAt.filter(
      (timestamp) => timestamp >= startedAt && timestamp <= endedAt,
    );
    const progressGaps = progressReceivedAt.length
      ? [
          progressReceivedAt[0] - startedAt,
          ...progressReceivedAt
            .slice(1)
            .map((timestamp, index) => timestamp - progressReceivedAt[index]),
          endedAt - progressReceivedAt.at(-1)!,
        ]
      : [endedAt - startedAt];
    const activeWorkers = harness.workers.filter((worker) => !worker.terminated);

    return {
      activeReplayWorkers: activeWorkers.filter(
        (worker) => worker.name === "fish-survival-replay",
      ).length,
      activeTrainerWorkers: activeWorkers.filter(
        (worker) => worker.name === "fish-survival-trainer",
      ).length,
      generationCount: harness.generationCount,
      longTaskSupported: harness.longTaskSupported,
      longTasks: [...harness.longTasks],
      maxProgressGap: Math.max(...progressGaps),
      progressCount: progressReceivedAt.length,
      progressGaps,
      snapshots: [...harness.snapshots],
      trainingDuration: endedAt - startedAt,
    };
  });
  const diagnosticText = JSON.stringify(diagnostics, null, 2);
  const browserEnvironment = await page.evaluate(() => ({
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
  }));
  await testInfo.attach("release-performance.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          budgets: {
            minimumFramesPerSecond: 55,
            maximumLongTaskMilliseconds: 50,
            maximumProgressGapMilliseconds: MAX_PROGRESS_GAP_MILLISECONDS,
            maximumSnapshotBytes: MAX_SNAPSHOT_BYTES,
          },
          browserEnvironment,
          fpsSamples,
          measurements: {
            activeReplayWorkers: diagnostics.activeReplayWorkers,
            activeTrainerWorkers: diagnostics.activeTrainerWorkers,
            generationCount: diagnostics.generationCount,
            longTasks: diagnostics.longTasks,
            maximumProgressGapMilliseconds: diagnostics.maxProgressGap,
            maximumSnapshotBytes: diagnostics.snapshots.length
              ? Math.max(
                  ...diagnostics.snapshots.map((snapshot) => snapshot.byteLength),
                )
              : null,
            minimumFramesPerSecond: Math.min(
              ...fpsSamples.map((sample) => sample.framesPerSecond),
            ),
            progressCount: diagnostics.progressCount,
            sharedSnapshotLayouts: diagnostics.snapshots.every(
              (snapshot) => snapshot.sharedBuffer,
            ),
            snapshotCount: diagnostics.snapshots.length,
            trainingDurationMilliseconds: diagnostics.trainingDuration,
          },
          node: {
            architecture: process.arch,
            platform: process.platform,
            version: process.version,
          },
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  expect(diagnostics.longTaskSupported).toBe(true);
  expect(
    diagnostics.longTasks,
    `Main-thread long tasks overlapped training:\n${diagnosticText}`,
  ).toEqual([]);
  expect(
    diagnostics.progressCount,
    `Training progress was not observable:\n${diagnosticText}`,
  ).toBeGreaterThan(1);
  expect(
    diagnostics.maxProgressGap,
    `Progress exceeded the 500ms cadence budget:\n${diagnosticText}`,
  ).toBeLessThanOrEqual(MAX_PROGRESS_GAP_MILLISECONDS);
  expect(
    diagnostics.snapshots.length,
    `No transported replay snapshots were observed:\n${diagnosticText}`,
  ).toBeGreaterThan(0);
  expect(
    Math.max(...diagnostics.snapshots.map((snapshot) => snapshot.byteLength)),
    `A replay snapshot exceeded the 5KB transport budget:\n${diagnosticText}`,
  ).toBeLessThan(MAX_SNAPSHOT_BYTES);
  expect(
    diagnostics.snapshots.every(
      (snapshot) =>
        snapshot.sharedBuffer &&
        snapshot.positionsLength === 96 &&
        snapshot.velocitiesLength === 96 &&
        snapshot.aliveLength === 48 &&
        snapshot.predatorLength === 4,
    ),
    `Replay snapshots did not retain their canonical shared layout:\n${diagnosticText}`,
  ).toBe(true);
  expect(diagnostics.activeReplayWorkers, diagnosticText).toBe(1);
  expect(diagnostics.activeTrainerWorkers, diagnosticText).toBe(1);

  const readPersistedGeneration = () =>
    page.evaluate(
      () =>
        new Promise<number | undefined>((resolve, reject) => {
          const openRequest = indexedDB.open("fish-survival-network");
          openRequest.onerror = () => reject(openRequest.error);
          openRequest.onsuccess = () => {
            const database = openRequest.result;
            const request = database
              .transaction("active", "readonly")
              .objectStore("active")
              .get("active");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const checkpoint = request.result as
                | { evolution?: { generation?: number } }
                | undefined;
              database.close();
              resolve(checkpoint?.evolution?.generation);
            };
          };
        }),
    );

  await expect.poll(readPersistedGeneration).toBeGreaterThanOrEqual(1);
  const persistedGeneration = await readPersistedGeneration();

  await page.reload();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const harness = (window as unknown as PerformanceHarnessWindow)
          .__performanceHarness;
        const initialize = harness.workers
          .find((worker) => worker.name === "fish-survival-trainer")
          ?.commands.find(
            (command) =>
              typeof command === "object" &&
              command !== null &&
              "type" in command &&
              command.type === "INITIALIZE",
          ) as
          | { checkpoint?: { evolution?: { generation?: number } } }
          | undefined;
        return initialize?.checkpoint?.evolution?.generation;
      }),
    )
    .toBe(persistedGeneration);
  await page.getByRole("tab", { name: "Train" }).click();
  await expect(
    page.getByRole("button", { name: "Resume training" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local replay" }),
  ).toBeVisible();
});
