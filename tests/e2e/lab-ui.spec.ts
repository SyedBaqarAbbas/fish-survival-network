import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const viewports = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function openReadyLab(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("worker-status")).toHaveAttribute(
    "data-state",
    "ready",
  );
  const canvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("neural-graph")).toHaveAttribute(
    "data-has-activation",
    "true",
  );
  return canvas;
}

async function stabilizeReplay(page: Page) {
  const canvas = page.getByRole("img", {
    exact: true,
    name: "Fish survival replay",
  });
  await page.getByRole("button", { name: "Pause replay" }).click();
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();
  const sequenceBefore = Number(await canvas.getAttribute("data-sequence"));
  await page.getByRole("button", { name: "Restart replay" }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-sequence")))
    .toBeGreaterThan(sequenceBefore);
}

async function inspectLayout(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    };
    const clippedByAncestor = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (
          ["hidden", "clip"].includes(style.overflowX) &&
          (bounds.left < ancestorBounds.left - 0.5 ||
            bounds.right > ancestorBounds.right + 0.5)
        ) {
          return true;
        }
        if (
          ["hidden", "clip"].includes(style.overflowY) &&
          (bounds.top < ancestorBounds.top - 0.5 ||
            bounds.bottom > ancestorBounds.bottom + 0.5)
        ) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };

    const controls = [
      ...document.querySelectorAll<HTMLElement>("button, input, select"),
    ].filter(visible);
    const clippedControls = controls.filter((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left < -0.5 ||
        bounds.right > window.innerWidth + 0.5 ||
        clippedByAncestor(element)
      );
    }).length;
    const clippedControlText = controls.filter(
      (element) =>
        element.clientWidth > 0 &&
        element.clientHeight > 0 &&
        (element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1),
    ).length;

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

    const graph = document.querySelector<SVGSVGElement>(
      '[data-testid="neural-graph"]',
    );
    const graphBounds = graph?.getBoundingClientRect();
    const graphLabels = graph
      ? [...graph.querySelectorAll<SVGTextElement>("text")]
      : [];
    const unreadableGraphLabels = graphLabels.filter((label) => {
      if (!graphBounds) return true;
      const bounds = label.getBoundingClientRect();
      return (
        bounds.height < 6 ||
        bounds.left < graphBounds.left - 1 ||
        bounds.right > graphBounds.right + 1 ||
        bounds.top < graphBounds.top - 1 ||
        bounds.bottom > graphBounds.bottom + 1
      );
    }).length;

    return {
      clippedControls,
      clippedControlText,
      graphEdges: graph?.querySelectorAll("line").length ?? 0,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth,
      ),
      overlaps,
      unreadableGraphLabels,
    };
  });
}

for (const viewport of viewports) {
  test(`renders an unclipped ${viewport.name} release viewport`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReadyLab(page);
    await stabilizeReplay(page);
    await page.locator("nextjs-portal").evaluateAll((portals) => {
      for (const portal of portals) {
        (portal as HTMLElement).style.setProperty("display", "none", "important");
      }
    });

    expect(await inspectLayout(page), viewport.name).toEqual({
      clippedControls: 0,
      clippedControlText: 0,
      graphEdges: 104,
      horizontalOverflow: 0,
      overlaps: 0,
      unreadableGraphLabels: 0,
    });

    await expect(page).toHaveScreenshot(`lab-${viewport.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}

test("supports keyboard controls, focus trapping, and reduced effects", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = await openReadyLab(page);

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

  const openSettings = page.getByRole("button", { name: "Open settings" });
  await openSettings.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Settings" });
  const closeSettings = page.getByRole("button", { name: "Close settings" });
  await expect(drawer).toBeVisible();
  await expect(closeSettings).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Apply" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeSettings).toBeFocused();

  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds).not.toBeNull();
  expect(drawerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBounds!.width).toBeLessThanOrEqual(390);
  expect(drawerBounds!.y + drawerBounds!.height).toBeLessThanOrEqual(844.5);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(openSettings).toBeFocused();

  await openSettings.click();
  await page.getByRole("switch", { name: "Reduced effects" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  const graph = page.getByTestId("neural-graph");
  await expect(page.getByTestId("evolution-lab")).toHaveAttribute(
    "data-reduced-effects",
    "true",
  );
  await expect(graph).toHaveAttribute("data-reduced-effects", "true");
  await expect(graph.locator('[data-glow="true"]')).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-effects-enabled", "false");
  expect(
    await graph.locator("circle").first().evaluate((element) => ({
      filter: getComputedStyle(element).filter,
      transitionDuration: getComputedStyle(element).transitionDuration,
    })),
  ).toEqual({ filter: "none", transitionDuration: "0s" });
});
