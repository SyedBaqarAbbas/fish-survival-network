import { expect, test } from "@playwright/test";

interface TrainerHarnessWindow extends Window {
  __trainerCommands: unknown[];
  __trainerWorkers: Worker[];
  __trainingLongTasks: number[];
}

test("trains a generation off the main thread", async ({ page }) => {
  await page.addInitScript(() => {
    const harness = window as unknown as TrainerHarnessWindow;
    const NativeWorker = window.Worker;
    harness.__trainerCommands = [];
    harness.__trainerWorkers = [];
    harness.__trainingLongTasks = [];

    window.Worker = class CapturedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        harness.__trainerWorkers.push(this);
      }

      override postMessage(
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        harness.__trainerCommands.push(structuredClone(message));
        if (options === undefined) {
          super.postMessage(message);
        } else if (Array.isArray(options)) {
          super.postMessage(message, options);
        } else {
          super.postMessage(message, options);
        }
      }
    };

    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          harness.__trainingLongTasks.push(entry.duration);
        }
      }).observe({ type: "longtask", buffered: true });
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );

  const result = await page.evaluate(async () => {
    const harness = window as unknown as TrainerHarnessWindow;
    const worker = harness.__trainerWorkers.at(-1);
    if (!worker) throw new Error("Trainer worker was not created.");
    harness.__trainingLongTasks.length = 0;

    const progress: number[] = [];
    const metric = await new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Trainer did not complete a generation.")),
        15_000,
      );
      worker.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "PROGRESS") progress.push(performance.now());
        if (event.data?.type === "ERROR") {
          window.clearTimeout(timeout);
          reject(new Error(event.data.message));
        }
        if (event.data?.type === "GENERATION") {
          window.clearTimeout(timeout);
          worker.postMessage({ type: "PAUSE", protocolVersion: 1 });
          resolve(event.data.metric);
        }
      });
      worker.postMessage({ type: "START", protocolVersion: 1 });
    });

    return {
      metric,
      progressCount: progress.length,
    };
  });

  expect(result.metric).toMatchObject({ generation: 0, level: 0 });
  expect(result.progressCount).toBeGreaterThan(1);

  await expect
    .poll(() =>
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
      ),
    )
    .toBe(1);

  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => [
      ...(window as unknown as TrainerHarnessWindow).__trainingLongTasks,
    ]),
  ).toEqual([]);

  await page.reload();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  expect(
    await page.evaluate(() => {
      const harness = window as unknown as TrainerHarnessWindow;
      const initialize = harness.__trainerCommands.find(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "INITIALIZE",
      ) as { checkpoint?: { evolution?: { generation?: number } } } | undefined;
      return initialize?.checkpoint?.evolution?.generation;
    }),
  ).toBe(1);
});
