import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

interface CapturedWorkerRecord {
  commands: unknown[];
  events: unknown[];
  name: string;
  terminated: boolean;
  url: string;
  worker: Worker;
}

interface ReplayHarnessWindow extends Window {
  __capturedWorkers: CapturedWorkerRecord[];
}

interface ReplayMappingCapture {
  type: "MAPPING";
  episodeId: number;
  sourceId: string;
  world: { height: number; width: number };
  entries: Array<{ fishIndex: number; genomeId: string }>;
}

interface ReplaySnapshotCapture {
  type: "SNAPSHOT";
  episodeId: number;
  sequence: number;
  simulationTime: number;
  positions: Float32Array;
  alive: Uint8Array;
}

async function analyzeCanvasFrames(
  page: Page,
  first: Buffer,
  second: Buffer,
) {
  return page.evaluate(
    async ({ firstUrl, secondUrl }) => {
      async function readPixels(url: string) {
        const response = await fetch(url);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("A 2D canvas context is unavailable.");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
          height: canvas.height,
          width: canvas.width,
        };
      }

      const [before, after] = await Promise.all([
        readPixels(firstUrl),
        readPixels(secondUrl),
      ]);
      if (before.width !== after.width || before.height !== after.height) {
        throw new Error("Replay canvas dimensions changed between samples.");
      }

      let changedPixels = 0;
      let luminanceMinimum = 255;
      let luminanceMaximum = 0;
      let luminanceSum = 0;
      let luminanceSquareSum = 0;
      const pixelCount = before.data.length / 4;

      for (let offset = 0; offset < before.data.length; offset += 4) {
        const red = before.data[offset];
        const green = before.data[offset + 1];
        const blue = before.data[offset + 2];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        luminanceMinimum = Math.min(luminanceMinimum, luminance);
        luminanceMaximum = Math.max(luminanceMaximum, luminance);
        luminanceSum += luminance;
        luminanceSquareSum += luminance * luminance;

        const colorDelta =
          Math.abs(red - after.data[offset]) +
          Math.abs(green - after.data[offset + 1]) +
          Math.abs(blue - after.data[offset + 2]);
        if (colorDelta >= 24) changedPixels += 1;
      }

      const mean = luminanceSum / pixelCount;
      return {
        changedFraction: changedPixels / pixelCount,
        height: before.height,
        luminanceRange: luminanceMaximum - luminanceMinimum,
        luminanceVariance: luminanceSquareSum / pixelCount - mean * mean,
        width: before.width,
      };
    },
    {
      firstUrl: `data:image/png;base64,${first.toString("base64")}`,
      secondUrl: `data:image/png;base64,${second.toString("base64")}`,
    },
  );
}

async function installWorkerHarness(page: Page) {
  await page.addInitScript(() => {
    const harness = window as unknown as ReplayHarnessWindow;
    const NativeWorker = window.Worker;
    harness.__capturedWorkers = [];

    window.Worker = class InstrumentedWorker extends NativeWorker {
      private record?: CapturedWorkerRecord;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = {
          commands: [],
          events: [],
          name: options?.name ?? "",
          terminated: false,
          url: String(url),
          worker: this,
        };
        harness.__capturedWorkers.push(this.record);
        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          this.record?.events.push(structuredClone(event.data));
        });
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
}

test("renders and selects fish through the replay worker", async ({ page }) => {
  await installWorkerHarness(page);

  await page.goto("/");
  const canvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });

  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const records = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers;
        return records.filter(
          (record) =>
            record.name === "fish-survival-replay" && !record.terminated,
        ).length;
      }),
    )
    .toBe(1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        const load = replay?.commands.some(
            (command) =>
              typeof command === "object" &&
              command !== null &&
              "type" in command &&
              command.type === "LOAD",
          ) ?? false;
        const play = replay?.commands.some(
            (command) =>
              typeof command === "object" &&
              command !== null &&
              "type" in command &&
              command.type === "PLAY",
          ) ?? false;
        const snapshots = replay?.events.filter(
              (event) =>
                typeof event === "object" &&
                event !== null &&
                "type" in event &&
                event.type === "SNAPSHOT",
            ).length ?? 0;
        return load && play && snapshots >= 3;
      }),
    )
    .toBe(true);

  const firstFrame = await canvas.screenshot();
  await page.waitForTimeout(500);
  const secondFrame = await canvas.screenshot();
  const pixels = await analyzeCanvasFrames(page, firstFrame, secondFrame);
  expect(pixels.width).toBeGreaterThan(300);
  expect(pixels.height).toBeGreaterThan(200);
  expect(pixels.luminanceRange).toBeGreaterThan(100);
  expect(pixels.luminanceVariance).toBeGreaterThan(5);
  expect(pixels.changedFraction).toBeGreaterThan(0.001);

  const cadence = await canvas.evaluate(async (element) => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const startFrame = Number(element.dataset.frame);
    const startedAt = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    const durationMilliseconds = performance.now() - startedAt;
    const renderedFrames = Number(element.dataset.frame) - startFrame;
    return {
      durationMilliseconds,
      framesPerSecond: (renderedFrames * 1_000) / durationMilliseconds,
      renderedFrames,
    };
  });
  expect(cadence.durationMilliseconds).toBeGreaterThanOrEqual(1_400);
  expect(cadence.renderedFrames).toBeGreaterThan(80);
  expect(cadence.framesPerSecond).toBeGreaterThanOrEqual(55);

  await page.evaluate(() => {
    const replay = (window as unknown as ReplayHarnessWindow)
      .__capturedWorkers.find(
        (record) =>
          record.name === "fish-survival-replay" && !record.terminated,
      );
    if (!replay) throw new Error("The active replay worker is missing.");
    replay.worker.postMessage({ type: "PAUSE", protocolVersion: 1 });
  });
  await page.waitForTimeout(200);

  const target = await page.evaluate(() => {
    const replay = (window as unknown as ReplayHarnessWindow)
      .__capturedWorkers.find(
        (record) =>
          record.name === "fish-survival-replay" && !record.terminated,
      );
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Fish survival replay"]',
    );
    if (!replay || !canvas) throw new Error("The replay harness is unavailable.");

    const snapshots = replay.events.filter(
      (event): event is ReplaySnapshotCapture =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "SNAPSHOT",
    );
    const snapshot = snapshots.at(-1);
    if (!snapshot) throw new Error("No replay snapshot was captured.");
    const mapping = replay.events.findLast(
      (event): event is ReplayMappingCapture =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "MAPPING" &&
        "episodeId" in event &&
        event.episodeId === snapshot.episodeId,
    );
    if (!mapping) throw new Error("No mapping exists for the latest snapshot.");

    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / mapping.world.width,
      bounds.height / mapping.world.height,
    );
    const offsetX = (bounds.width - mapping.world.width * scale) / 2;
    const offsetY = (bounds.height - mapping.world.height * scale) / 2;
    const candidates: Array<{
      fishIndex: number;
      genomeId: string;
      nearestDistanceSquared: number;
      x: number;
      y: number;
    }> = [];

    for (let fishIndex = 0; fishIndex < snapshot.alive.length; fishIndex += 1) {
      if (snapshot.alive[fishIndex] === 0) continue;
      const worldX = snapshot.positions[fishIndex * 2];
      const worldY = snapshot.positions[fishIndex * 2 + 1];
      const x = bounds.left + offsetX + worldX * scale;
      const y = bounds.top + offsetY + worldY * scale;
      if (document.elementFromPoint(x, y) !== canvas) continue;

      let nearestDistanceSquared = Number.POSITIVE_INFINITY;
      for (let otherIndex = 0; otherIndex < snapshot.alive.length; otherIndex += 1) {
        if (otherIndex === fishIndex || snapshot.alive[otherIndex] === 0) continue;
        const deltaX = snapshot.positions[otherIndex * 2] - worldX;
        const deltaY = snapshot.positions[otherIndex * 2 + 1] - worldY;
        nearestDistanceSquared = Math.min(
          nearestDistanceSquared,
          deltaX * deltaX + deltaY * deltaY,
        );
      }
      const genomeId = mapping.entries.find(
        (entry) => entry.fishIndex === fishIndex,
      )?.genomeId;
      if (genomeId) {
        candidates.push({
          fishIndex,
          genomeId,
          nearestDistanceSquared,
          x,
          y,
        });
      }
    }

    candidates.sort(
      (left, right) =>
        right.nearestDistanceSquared - left.nearestDistanceSquared ||
        left.fishIndex - right.fishIndex,
    );
    const candidate = candidates[0];
    if (!candidate) throw new Error("No unobscured living fish can be selected.");
    return candidate;
  });

  await page.mouse.click(target.x, target.y);
  await expect(canvas).toHaveAttribute(
    "data-selected",
    String(target.fishIndex),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        const select = replay?.commands.findLast(
          (command) =>
            typeof command === "object" &&
            command !== null &&
            "type" in command &&
            command.type === "SELECT",
        ) as { fishIndex?: unknown } | undefined;
        return typeof select?.fishIndex === "number" ? select.fishIndex : null;
      }),
    )
    .toBe(target.fishIndex);
  await expect
    .poll(() =>
      page.evaluate((fishIndex) => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        const activation = replay?.events.findLast(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            event.type === "ACTIVATION" &&
            "fishIndex" in event &&
            event.fishIndex === fishIndex,
        ) as { genomeId?: unknown } | undefined;
        return typeof activation?.genomeId === "string"
          ? activation.genomeId
          : null;
      }, target.fishIndex),
    )
    .toBe(target.genomeId);
  await expect(page.getByTestId("neural-graph")).toHaveAttribute(
    "data-genome-id",
    target.genomeId,
  );
  await expect(page.getByTestId("neural-graph")).toHaveAttribute(
    "data-has-activation",
    "true",
  );

  const lifecycleBeforeReload = await page.evaluate(() => {
    const replayWorkers = (window as unknown as ReplayHarnessWindow)
      .__capturedWorkers.filter(
        (record) => record.name === "fish-survival-replay",
      );
    return {
      active: replayWorkers.filter((record) => !record.terminated).length,
      created: replayWorkers.length,
      terminated: replayWorkers.filter((record) => record.terminated).length,
    };
  });
  expect(lifecycleBeforeReload.active).toBe(1);
  expect(lifecycleBeforeReload.terminated).toBe(
    lifecycleBeforeReload.created - 1,
  );

  await page.reload();
  const remountedCanvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });
  await expect(remountedCanvas).toHaveCount(1);
  await expect(remountedCanvas).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const replayWorkers = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.filter(
            (record) => record.name === "fish-survival-replay",
          );
        return {
          active: replayWorkers.filter((record) => !record.terminated).length,
          leaked: replayWorkers.filter((record) => record.terminated).length -
            (replayWorkers.length - 1),
        };
      }),
    )
    .toEqual({ active: 1, leaked: 0 });
});

test("keeps the bundled replay alive past the evaluation horizon until restart", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await installWorkerHarness(page);

  await page.goto("/");
  const canvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });
  const tank = page.locator('section[aria-labelledby="tank-heading"]');
  const fastSpeed = page.getByRole("button", { name: "2x" });

  await expect(page.getByRole("heading", { name: "Bundled replay" })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        return replay?.events.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            event.type === "MAPPING",
        ) ?? false;
      }),
    )
    .toBe(true);

  const initialMapping = await page.evaluate(() => {
    const replay = (window as unknown as ReplayHarnessWindow)
      .__capturedWorkers.find(
        (record) =>
          record.name === "fish-survival-replay" && !record.terminated,
      );
    const mapping = replay?.events.find(
      (event): event is ReplayMappingCapture =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "MAPPING",
    );
    if (!mapping) throw new Error("The bundled replay mapping is unavailable.");
    return { episodeId: mapping.episodeId, sourceId: mapping.sourceId };
  });
  expect(initialMapping.sourceId).toBe("bundled-level-6-v1:generation:37");

  await fastSpeed.click();
  await expect(fastSpeed).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        return replay?.commands.some(
          (command) =>
            typeof command === "object" &&
            command !== null &&
            "type" in command &&
            command.type === "SPEED" &&
            "speed" in command &&
            command.speed === 2,
        ) ?? false;
      }),
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate((episodeId) => {
          const replay = (window as unknown as ReplayHarnessWindow)
            .__capturedWorkers.find(
              (record) =>
                record.name === "fish-survival-replay" && !record.terminated,
            );
          const snapshot = replay?.events.findLast(
            (event): event is ReplaySnapshotCapture =>
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "SNAPSHOT" &&
              "episodeId" in event &&
              event.episodeId === episodeId,
          );
          return snapshot?.simulationTime ?? 0;
        }, initialMapping.episodeId),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(15);

  const continued = await page.evaluate((episodeId) => {
    const replay = (window as unknown as ReplayHarnessWindow)
      .__capturedWorkers.find(
        (record) =>
          record.name === "fish-survival-replay" && !record.terminated,
      );
    if (!replay) throw new Error("The active replay worker is unavailable.");
    const mappings = replay.events.filter(
      (event): event is ReplayMappingCapture =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "MAPPING",
    );
    const snapshot = replay.events.findLast(
      (event): event is ReplaySnapshotCapture =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "SNAPSHOT" &&
        "episodeId" in event &&
        event.episodeId === episodeId,
    );
    if (!snapshot) throw new Error("A post-horizon snapshot is unavailable.");
    return {
      episodeEndCount: replay.events.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "EPISODE_END",
      ).length,
      mappingCount: mappings.length,
      simulationTime: snapshot.simulationTime,
      snapshotEpisodeId: snapshot.episodeId,
      survivors: snapshot.alive.reduce((count, alive) => count + alive, 0),
    };
  }, initialMapping.episodeId);

  expect(continued).toMatchObject({
    episodeEndCount: 0,
    mappingCount: 1,
    snapshotEpisodeId: initialMapping.episodeId,
  });
  expect(continued.simulationTime).toBeGreaterThan(15);
  expect(continued.survivors).toBeGreaterThan(0);
  await expect(tank).toContainText(/\d+ \/ 48 fish left/);
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
  await expect(page.getByText("Playing", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Restart replay" }).click();
  await expect
    .poll(() =>
      page.evaluate((previousEpisodeId) => {
        const replay = (window as unknown as ReplayHarnessWindow)
          .__capturedWorkers.find(
            (record) =>
              record.name === "fish-survival-replay" && !record.terminated,
          );
        const mapping = replay?.events.findLast(
          (event): event is ReplayMappingCapture =>
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            event.type === "MAPPING",
        );
        if (!mapping || mapping.episodeId <= previousEpisodeId) return null;
        const initialSnapshot = replay?.events.find(
          (event): event is ReplaySnapshotCapture =>
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            event.type === "SNAPSHOT" &&
            "episodeId" in event &&
            event.episodeId === mapping.episodeId &&
            "simulationTime" in event &&
            event.simulationTime === 0,
        );
        const restartSent = replay?.commands.some(
          (command) =>
            typeof command === "object" &&
            command !== null &&
            "type" in command &&
            command.type === "RESTART",
        );
        return initialSnapshot && restartSent
          ? {
              episodeId: mapping.episodeId,
              simulationTime: initialSnapshot.simulationTime,
            }
          : null;
      }, initialMapping.episodeId),
    )
    .toEqual({
      episodeId: initialMapping.episodeId + 1,
      simulationTime: 0,
    });
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
});
