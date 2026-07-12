import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test("keeps the interactive lab accessible and unclipped at supported viewports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByTestId("worker-status")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(
      page.getByRole("img", { name: "Fish survival replay" }),
    ).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("neural-graph")).toHaveAttribute(
      "data-has-activation",
      "true",
    );

    const layout = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>(
        "button, input, select",
      )].filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      });
      const clippedControls = controls.filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < 0 || bounds.right > window.innerWidth;
      }).length;
      const regions = [
        document.querySelector('[role="tablist"]'),
        document.querySelector('[aria-labelledby="network-heading"]'),
        document.querySelector('[aria-labelledby="tank-heading"]'),
        document.querySelector('[aria-label="Replay metrics"]'),
        document.querySelector('[aria-label$="controls"]'),
        document.querySelector('[aria-labelledby="history-heading"]'),
      ].filter((element): element is Element => element !== null);
      const overlaps = regions.slice(1).filter((element, index) => {
        const previous = regions[index].getBoundingClientRect();
        const current = element.getBoundingClientRect();
        return current.top + 0.5 < previous.bottom;
      }).length;
      return {
        clippedControls,
        graphEdges:
          document.querySelector('[data-testid="neural-graph"]')
            ?.querySelectorAll("line").length ?? 0,
        horizontalOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
        overlaps,
      };
    });

    expect(layout, viewport.name).toEqual({
      clippedControls: 0,
      graphEdges: 104,
      horizontalOverflow: 0,
      overlaps: 0,
    });
  }

  await page.getByRole("button", { name: "Pause replay" }).click();
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();
  await page.getByRole("button", { name: "2x" }).click();
  await expect(page.getByRole("button", { name: "2x" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Restart replay" }).click();

  const replayTab = page.getByRole("tab", { name: "Replay" });
  await replayTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Train" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Start training" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await expect(drawer).toBeVisible();
  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds).not.toBeNull();
  expect(drawerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBounds!.width).toBeLessThanOrEqual(390);
  expect(drawerBounds!.y + drawerBounds!.height).toBeLessThanOrEqual(844.5);
  await page.getByRole("switch", { name: "Reduced effects" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("evolution-lab")).toHaveAttribute(
    "data-reduced-effects",
    "true",
  );

  expect(errors).toEqual([]);
});
