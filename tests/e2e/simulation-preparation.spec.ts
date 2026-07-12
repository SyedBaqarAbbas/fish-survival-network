import { expect, test } from "./fixtures";

test("prepares a trained simulation with ETA before explicit replay", async ({
  page,
}) => {
  test.setTimeout(35_000);

  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.getByRole("tab", { name: "Train" }).click();
  await page.getByRole("button", { name: "Start training" }).click();

  const preparation = page.getByRole("complementary", {
    name: "Simulation preparation",
  });
  await expect
    .poll(async () => {
      const state = await preparation.getAttribute("data-state");
      const text = await preparation.textContent();
      const progressVisible = await preparation
        .getByRole("progressbar", { name: "Simulation creation progress" })
        .isVisible()
        .catch(() => false);
      return `${state}:${progressVisible}:${text}`;
    })
    .toMatch(
      /^preparing:true:.*ETA (?:Estimating|About (?:< 1 sec|\d+ sec|\d+ min(?: \d+ sec)?))/,
    );

  await expect(preparation).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Bundled replay" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await preparation.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);

  await preparation.getByRole("button", { name: "Replay now" }).click();
  await expect(page.getByRole("tab", { name: "Replay" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Local replay" })).toBeVisible();
  await expect(preparation).toBeHidden();
});
