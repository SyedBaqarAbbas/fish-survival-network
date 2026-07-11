import { expect, test } from "@playwright/test";

test("renders the lab and starts the training worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

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
      name: "Eleven input, eight hidden, and two output neuron topology",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
