import { expect, test } from "./fixtures";

test("renders the lab and starts the training worker", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Fish Survival Network" }),
  ).toBeVisible();
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(
    page.getByRole("img", {
      name: /Live neural policy for genome/,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("neural-graph").locator("line")).toHaveCount(104);
});
