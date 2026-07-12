import { expect, test } from "./fixtures";

test("keeps training available when IndexedDB is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      value() {
        throw new DOMException("IndexedDB blocked for release test.", "InvalidStateError");
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  const warning = page.getByTestId("evolution-lab").getByRole("alert");
  await expect(warning).toContainText("Persistence warning");
  await expect(warning).toContainText("Training remains available for this session");

  await page.getByRole("tab", { name: "Train" }).click();
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
});
