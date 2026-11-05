import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { HeaderRule } from "@/stores/headers";
import type { MockRule } from "@/stores/mocks";
import type { Recording, Step } from "./agentRecord";
import { locatorFor, routeRegex, toPlaywrightTest } from "./playwrightExport";

const rec = (steps: Step[], happenings: Recording["happenings"] = []): Recording => ({
  tabId: "abcdef12-3456",
  workspaceId: "ws1",
  url: "http://localhost:5173/",
  title: "Taskboard",
  startedAt: 0,
  stoppedAt: 9000,
  steps,
  happenings,
});

const box = { role: "textbox", name: "New task", ref: 52 };
const add = { role: "button", name: "Add", ref: 41 };

const mock = (r: Partial<MockRule>): MockRule => ({
  id: "m1",
  pattern: "localhost:5173/api/tasks",
  method: "",
  status: 200,
  contentType: "",
  body: "[]",
  delayMs: 0,
  enabled: true,
  ...r,
});

/** True when the file has no TypeScript syntax errors. */
function parses(code: string): boolean {
  const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: {} });
  return (out.diagnostics ?? []).length === 0;
}

const matches = (pattern: string, url: string) =>
  (new Function(`return ${routeRegex(pattern)}`)() as RegExp).test(url);

describe("locators", () => {
  it("prefers the test id, then role and name, then text", () => {
    expect(locatorFor({ ...add, testid: "add-btn" })).toBe('page.getByTestId("add-btn")');
    expect(locatorFor(add)).toBe('page.getByRole("button", { name: "Add", exact: true })');
    expect(locatorFor({ role: "generic", name: "Card 3", ref: 9 })).toBe(
      'page.getByText("Card 3", { exact: true })',
    );
    expect(locatorFor({ role: "generic", name: "", ref: 9 })).toBeNull();
    expect(locatorFor(null)).toBeNull();
  });

  it("doesn't demand an exact match on a name the page script may have clipped", () => {
    expect(locatorFor({ role: "button", name: "Save", ref: null })).toBe(
      'page.getByRole("button", { name: "Save" })',
    );
  });
});

describe("route patterns match like ZYNLEX's mocks (url_matches in net.rs)", () => {
  it.each([
    ["*", "http://localhost:3000/", true],
    ["", "http://localhost:3000/", true],
    ["localhost:3000/*", "http://localhost:3000/api/x", true],
    ["*/api/*", "http://localhost:3000/api/x", true],
    ["HTTP://LOCALHOST*", "http://localhost:3000/", true],
    ["http://localhost:3000/api", "http://localhost:3000/api/x", true],
    ["localhost:5000", "http://localhost:5000/api", true],
    ["localhost:3000/*", "http://example.com/", false],
    ["*/api", "http://localhost:3000/api/x", false],
    ["localhost:5000", "https://evil.com/?next=localhost:5000", false],
    ["*/api", "http://x/api/api", true],
    ["*api.example.com*", "https://staging.api.example.com/v1", true],
    ["localhost:5173/a.b(c)", "http://localhost:5173/a.b(c)?x", true],
    ["localhost:5173/a.b", "http://localhost:5173/aXb", false],
  ])("%s on %s", (pattern, url, want) => {
    expect(matches(pattern, url)).toBe(want);
  });
});

describe("toPlaywrightTest", () => {
  it("replays the steps with Playwright locators and checks for page errors", () => {
    const out = toPlaywrightTest(
      rec(
        [
          { t: 1000, action: "type", target: box, value: 'Buy "milk"' },
          { t: 2000, action: "press", target: box, key: "Enter" },
          { t: 3000, action: "click", target: add },
          { t: 4000, action: "press", target: null, key: "Escape" },
          {
            t: 5000,
            action: "select",
            target: { role: "combobox", name: "Sort", ref: 7 },
            value: "Newest",
          },
        ],
        [{ t: 2100, kind: "error", text: "TypeError: x is undefined" }],
      ),
    );
    expect(out).toContain('await page.goto("http://localhost:5173/");');
    expect(out).toContain(
      'await page.getByRole("textbox", { name: "New task", exact: true }).fill("Buy \\"milk\\"");',
    );
    expect(out).toContain('.press("Enter");\n  // ZYNLEX saw: TypeError: x is undefined');
    expect(out).toContain('await page.keyboard.press("Escape");');
    expect(out).toContain('.selectOption({ label: "Newest" });');
    expect(out).toContain('expect(errors, "uncaught errors in the page").toEqual([]);');
    expect(parses(out)).toBe(true);
  });

  it("never writes a password, and fails loudly on an element it can't name", () => {
    const out = toPlaywrightTest(
      rec([
        {
          t: 1,
          action: "type",
          target: { role: "textbox", name: "Password", ref: 3 },
          secret: true,
        },
        { t: 2, action: "click", target: { role: "generic", name: "", ref: 4 } },
      ]),
    );
    expect(out).toContain(".fill(process.env.TEST_PASSWORD!);");
    expect(out).toContain("throw new Error(\"Step 2: ZYNLEX couldn't name the element (generic)");
    expect(parses(out)).toBe(true);
  });

  it("carries the active mocks, in ZYNLEX's priority, and header rules", () => {
    const headers: HeaderRule[] = [
      { id: "h1", pattern: "localhost:5173/api", name: "X-Tenant", value: "acme", enabled: true },
      {
        id: "h2",
        pattern: "localhost:5173/api",
        name: "Authorization",
        value: "Bearer s3cret",
        enabled: true,
      },
      { id: "h3", pattern: "", name: "X-Off", value: "1", enabled: false },
    ];
    const out = toPlaywrightTest(
      rec([{ t: 1, action: "click", target: add }]),
      [
        mock({ id: "first", status: 500, method: "post", delayMs: 800, body: '{"error":"boom"}' }),
        mock({ id: "second", status: 201 }),
        mock({ id: "off", status: 418, enabled: false }),
        mock({ id: "all", pattern: "*", status: 503 }),
      ],
      headers,
    );
    // Playwright runs the route added last first, so ZYNLEX's first rule goes last.
    expect(out.indexOf("status: 201")).toBeLessThan(out.indexOf("status: 500"));
    expect(out).toContain('if (route.request().method() !== "POST") return route.fallback();');
    expect(out).toContain("setTimeout(r, 800)");
    expect(out).not.toContain("418");
    expect(out).not.toContain("503");
    expect(out).toContain('"x-tenant": "acme"');
    expect(out).not.toContain("s3cret");
    expect(out).toContain('"authorization": process.env.ZYNLEX_HEADER_AUTHORIZATION!');
    expect(out).not.toContain("X-Off");
    expect(out.indexOf("page.route")).toBeLessThan(out.indexOf("page.goto"));
    expect(parses(out)).toBe(true);
  });

  it("turns a navigation no step explains into a goto", () => {
    const out = toPlaywrightTest(
      rec(
        [{ t: 1000, action: "click", target: add }],
        [{ t: 9000, kind: "nav", text: "http://localhost:5173/settings" }],
      ),
    );
    expect(out).toContain('await page.goto("http://localhost:5173/settings");');
  });
});
