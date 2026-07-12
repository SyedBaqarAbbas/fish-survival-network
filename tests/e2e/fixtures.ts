import {
  expect,
  test as base,
  type ConsoleMessage,
  type TestInfo,
} from "@playwright/test";

interface BrowserErrorAuditFixtures {
  browserErrorAudit: void;
}

function formatConsoleError(message: ConsoleMessage) {
  const location = message.location();
  const source = location.url
    ? ` (${location.url}${location.lineNumber ? `:${location.lineNumber}` : ""})`
    : "";
  return `console.error: ${message.text()}${source}`;
}

async function attachDiagnostics(testInfo: TestInfo, errors: readonly string[]) {
  if (errors.length === 0) return;
  await testInfo.attach("browser-errors", {
    body: Buffer.from(errors.join("\n\n")),
    contentType: "text/plain",
  });
}

export const test = base.extend<BrowserErrorAuditFixtures>({
  browserErrorAudit: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === "error") errors.push(formatConsoleError(message));
      };
      const onPageError = (error: Error) => {
        errors.push(`pageerror: ${error.stack ?? error.message}`);
      };

      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      await use();
      page.off("console", onConsole);
      page.off("pageerror", onPageError);

      await attachDiagnostics(testInfo, errors);
      expect(errors, "Unexpected browser errors were reported.").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
