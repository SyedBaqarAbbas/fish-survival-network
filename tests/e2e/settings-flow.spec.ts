import { expect, test } from "./fixtures";

interface WorkerRecord {
  name: string;
  terminated: boolean;
}

interface WorkerAuditWindow extends Window {
  __workerAudit: WorkerRecord[];
}

test("confirms destructive settings and cleans up replaced workers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const audit = window as unknown as WorkerAuditWindow;
    const NativeWorker = window.Worker;
    audit.__workerAudit = [];
    window.Worker = class AuditedWorker extends NativeWorker {
      private readonly record: WorkerRecord;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = {
          name: options?.name ?? "",
          terminated: false,
        };
        audit.__workerAudit.push(this.record);
      }

      override terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });

  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.getByRole("tab", { name: "Train" }).click();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Population").selectOption("64");
  await page.getByLabel("Episodes").selectOption("4");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );

  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("progressbar", { name: "Training generation progress" })
          .getAttribute("value"),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause training" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "paused",
  );

  const reset = page.getByRole("button", { name: "Reset training run" });
  await reset.click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Replace local run?",
  });
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep run" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Replace run" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(reset).toBeFocused();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Run seed").fill("43");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(confirmation).toBeVisible();
  await page.getByRole("button", { name: "Replace run" }).click();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Run seed")).toHaveValue("43");
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const workers = (window as unknown as WorkerAuditWindow).__workerAudit.filter(
          (worker) => worker.name === "fish-survival-trainer",
        );
        return {
          active: workers.filter((worker) => !worker.terminated).length,
          createdAtLeastThree: workers.length >= 3,
          leaked:
            workers.filter((worker) => worker.terminated).length -
            (workers.length - 1),
        };
      }),
    )
    .toEqual({ active: 1, createdAtLeastThree: true, leaked: 0 });
});
