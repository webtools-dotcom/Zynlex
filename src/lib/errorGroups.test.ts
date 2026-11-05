import { beforeEach, describe, expect, it } from "vitest";
import type { NetworkLogEntry } from "@/stores/network";
import {
  clock,
  forgetReported,
  forgetTab,
  groupKey,
  normalizeMessage,
  notePageLoad,
  problemLine,
  recordEntry,
  report,
  statusOf,
  tabProblems,
} from "./errorGroups";

const T = "tab-1";
const ORIGIN = "http://localhost:5173";

const err = (text: string, line = 42, url = `${ORIGIN}/src/app.js`, ts?: number) =>
  recordEntry({ tabId: T, level: "error", source: "exception", text, url, line }, ts);
const fail = (url: string, status = 500, ts?: number) =>
  recordEntry(
    {
      tabId: T,
      level: "error",
      source: "network",
      text: `Failed to load resource: the server responded with a status of ${status} ()`,
      url,
      line: null,
    },
    ts,
  );
const row = (id: string, url: string, statusCode = 500, method = "GET"): NetworkLogEntry => ({
  id,
  tabId: T,
  method,
  url,
  statusCode,
  reasonPhrase: "",
  resourceType: "fetch",
  durationMs: 5,
  contentLength: 0,
  referrer: "",
  headers: [],
  body: "",
  bodyTruncated: false,
  bodyEvicted: false,
});

const problems = (rows: NetworkLogEntry[] = []) => tabProblems(T, rows, ORIGIN);

beforeEach(() => forgetTab(T));

describe("normalizeMessage", () => {
  it("drops numbers, ids and query strings, keeps the words", () => {
    expect(normalizeMessage("Cannot read properties of undefined (reading 'x') at line 42")).toBe(
      "Cannot read properties of undefined (reading 'x') at line <n>",
    );
    expect(normalizeMessage("user 7f3e9a2b1c not found")).toBe("user <id> not found");
    expect(normalizeMessage("order 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed")).toBe(
      "order <id> failed",
    );
    expect(normalizeMessage("at http://localhost:5173/src/app.js?t=1712345:42:7")).toBe(
      "at http://localhost:<n>/src/app.js:<n>:<n>",
    );
    // Digits inside identifiers are part of the name.
    expect(normalizeMessage("h1 utf8 e12 is undefined")).toBe("h1 utf8 e12 is undefined");
    // A plain word made of hex letters isn't an id.
    expect(normalizeMessage("deadbeefcafe")).toBe("deadbeefcafe");
  });

  it("gives the same key to the same error with different numbers and cache busters", () => {
    const e = (text: string, url: string, line = 3) =>
      groupKey({ level: "error", source: "exception", text, url, line });
    expect(e("Item 12 missing", "http://x/app.js?v=1")).toBe(
      e("Item 99 missing", "http://x/app.js?v=2"),
    );
    expect(e("Item 12 missing", "http://x/app.js")).not.toBe(
      e("Item 12 missing", "http://x/app.js", 4),
    );
    expect(e("Item 12 missing", "http://x/app.js")).not.toBe(e("Item 12 gone", "http://x/app.js"));
  });

  it("reads the status out of Chromium's failed-request text", () => {
    expect(
      statusOf("Failed to load resource: the server responded with a status of 404 (Not Found)"),
    ).toBe("404");
    expect(statusOf("Failed to load resource: net::ERR_CONNECTION_REFUSED")).toBe(
      "net::ERR_CONNECTION_REFUSED",
    );
    expect(statusOf("something else")).toBe("");
  });
});

describe("grouping", () => {
  it("collapses identical errors with count, first-seen time and page loads", () => {
    const t0 = new Date(2020, 0, 6, 14, 2).getTime();
    err("TypeError: x is undefined", 42, `${ORIGIN}/src/app.js?t=1`, t0);
    notePageLoad(T);
    err("TypeError: x is undefined", 42, `${ORIGIN}/src/app.js?t=2`);
    err("TypeError: x is undefined", 42, `${ORIGIN}/src/app.js?t=2`);
    notePageLoad(T);
    err("TypeError: x is undefined", 42, `${ORIGIN}/src/app.js?t=3`);
    err("TypeError: other", 7);
    const [p, other] = problems();
    expect(problemLine(p, false)).toBe(
      `  TypeError: x is undefined at /src/app.js:42 (×4 since ${clock(t0)}, across 3 page loads)`,
    );
    expect(clock(t0)).toBe("14:02");
    expect(problemLine(other, false)).toBe("  TypeError: other at /src/app.js:7");
  });

  it("indents a stack under the first line and skips a location it already names", () => {
    err(`TypeError: boom\n    at f (${ORIGIN}/src/app.js:42:5)`);
    expect(problemLine(problems()[0], false)).toBe(
      `  TypeError: boom\n        at f (${ORIGIN}/src/app.js:42:5)`,
    );
  });

  it("groups failed requests by path and status, not by query", () => {
    fail(`${ORIGIN}/api/user?id=1`);
    fail(`${ORIGIN}/api/user?id=2`);
    fail(`${ORIGIN}/api/user?id=3`, 404);
    fail("http://localhost:8080/api/user");
    const lines = problems().map((p) => problemLine(p, false));
    expect(lines).toEqual([
      expect.stringMatching(/^ {2}500 \/api\/user\?id=1 \(×2 since \d\d:\d\d\)$/),
      "  404 /api/user?id=3",
      "  500 http://localhost:8080/api/user",
    ]);
  });

  it("merges network rows into the console's failures and splits them by method", () => {
    fail(`${ORIGIN}/api/cart`);
    fail(`${ORIGIN}/api/cart`);
    const ps = problems([
      row("net-3", `${ORIGIN}/api/cart`),
      row("net-4", `${ORIGIN}/api/cart`, 500, "POST"),
      row("net-5", `${ORIGIN}/favicon.ico`, 404),
    ]);
    expect(ps.map((p) => p.head)).toEqual(["net-3 GET 500 /api/cart", "net-4 POST 500 /api/cart"]);
    // Both logs saw the same requests: the larger count, not the sum.
    expect(ps[0].count).toBe(2);
    expect(ps[1].count).toBe(1);
  });

  it("caps a tab at 300 groups, dropping the least recently seen", () => {
    err("keep me", 1);
    for (let i = 0; i < 300; i++)
      err(`distinct ${"ab".repeat(i % 7)}${String.fromCharCode(97 + (i % 26))}`, i + 2);
    err("keep me", 1);
    const heads = problems().map((p) => p.head);
    expect(heads).toHaveLength(300);
    expect(heads).toContain("keep me at /src/app.js:1");
  });
});

describe("report", () => {
  it("repeats an already-shown group only when it grew, and then as +N", () => {
    err("TypeError: x is undefined");
    expect(report(problems(), true, null)).toEqual([
      "1 errors:",
      "  TypeError: x is undefined at /src/app.js:42",
    ]);
    expect(report(problems(), true, null)).toEqual([]);
    err("TypeError: x is undefined");
    err("TypeError: x is undefined");
    err("TypeError: x is undefined");
    expect(report(problems(), true, null)).toEqual([
      "1 errors:",
      "  TypeError: x is undefined at /src/app.js:42 (+3)",
    ]);
    // The full listing still shows the whole count.
    expect(report(problems(), false, null)).toEqual([
      "1 errors:",
      expect.stringMatching(/^ {2}TypeError: x is undefined at \/src\/app\.js:42 \(×4 since/),
    ]);
  });

  it("puts what was logged before the agent connected under its own header, once", () => {
    err("TypeError: early", 42, `${ORIGIN}/src/app.js`, 1000);
    fail(`${ORIGIN}/api/me`, 401, 1500);
    err("TypeError: late", 43, `${ORIGIN}/src/app.js`, 3000);
    expect(report(problems(), true, 2000)).toEqual([
      "Before you connected:",
      "1 errors:",
      "  TypeError: early at /src/app.js:42",
      "1 failed requests:",
      "  401 /api/me",
      "Since you connected:",
      "1 errors:",
      "  TypeError: late at /src/app.js:43",
    ]);
    err("TypeError: early", 42, `${ORIGIN}/src/app.js`, 4000);
    expect(report(problems(), true, 2000)).toEqual([
      "1 errors:",
      "  TypeError: early at /src/app.js:42 (+1)",
    ]);
  });

  it("lists older page loads in a full listing only until they're shown", () => {
    err("TypeError: old page");
    notePageLoad(T);
    err("TypeError: this page");
    expect(report(problems(), false, null)).toHaveLength(3);
    // Shown once; the old page's error isn't on the current page any more.
    expect(report(problems(), false, null)).toEqual([
      "1 errors:",
      "  TypeError: this page at /src/app.js:42",
    ]);
  });

  it("starts over for the next agent", () => {
    err("TypeError: x");
    report(problems(), true, null);
    forgetReported();
    expect(report(problems(), true, null)).toEqual([
      "1 errors:",
      "  TypeError: x at /src/app.js:42",
    ]);
  });

  it("doesn't repeat a failure whose network row lands after its console line was shown", () => {
    fail(`${ORIGIN}/api/cart`);
    expect(report(problems(), true, null)).toEqual(["1 failed requests:", "  500 /api/cart"]);
    expect(report(problems([row("net-9", `${ORIGIN}/api/cart`)]), true, null)).toEqual([]);
  });

  it("ignores warnings and logs", () => {
    recordEntry({ tabId: T, level: "warning", source: "console", text: "w", url: "", line: null });
    recordEntry({ tabId: T, level: "log", source: "console", text: "l", url: "", line: null });
    expect(problems()).toEqual([]);
  });
});
