import { describe, expect, it } from "vitest";
import { findError, findExpression, parseSelector } from "./agentQuery";

describe("agentQuery", () => {
  it("puts the selector and index into the page expression as data, not code", () => {
    const expr = findExpression('button:has-text("a\\"); alert(1)//")', 2);
    expect(expr).toContain(JSON.stringify('button:has-text("a\\"); alert(1)//")'));
    expect(expr).toContain("const nth = 2;");
    expect(findExpression("#x", null)).toContain("const nth = null;");
  });

  it("explains a strict-mode miss in Playwright's words and a no-match plainly", () => {
    expect(findError("li", 'strict:3: <li> "A", <li> "B: c"')).toBe(
      'strict mode violation: "li" matches 3 elements (<li> "A", <li> "B: c"). Use .first(), .nth(i) or a narrower selector.',
    );
    expect(findError("#gone", "none:0")).toBe('No element matches "#gone" after waiting.');
  });

  it("needs a selector", () => {
    expect(() => parseSelector("  ")).toThrow("Pass a selector.");
    expect(parseSelector(" #a ")).toBe("#a");
  });
});
