import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("renders without evaluating browser-only APIs", () => {
    expect(() => renderToString(<HomePage />)).not.toThrow();
  });
});
