import { beforeEach, describe, expect, it } from "vitest";
import {
  actDid,
  firstLine,
  MAX_CALLS,
  outcomeOf,
  summarizeCall,
  useAgentActivityStore,
} from "./agentActivity";

const call = (n: number, tabId: string | null = "t1") => ({
  at: n,
  tool: "act",
  tabId,
  tabLabel: "[t1] http://localhost:5173/",
  summary: `action=click ref=e${n}`,
  what: "",
  outcome: "",
  why: "",
  error: null,
  ms: 3,
  note: null,
});

beforeEach(() => useAgentActivityStore.getState().clear());

describe("agent activity store", () => {
  it("keeps the newest calls first, at most MAX_CALLS", () => {
    const { record } = useAgentActivityStore.getState();
    for (let i = 1; i <= MAX_CALLS + 5; i++) record(call(i), false);
    const { calls } = useAgentActivityStore.getState();
    expect(calls).toHaveLength(MAX_CALLS);
    expect(calls[0].at).toBe(MAX_CALLS + 5);
    expect(calls[MAX_CALLS - 1].at).toBe(6);
    expect(new Set(calls.map((c) => c.id)).size).toBe(MAX_CALLS);
  });

  it("marks a tab only when the call acted on it", () => {
    const { record } = useAgentActivityStore.getState();
    record(call(1, "read"), false);
    record(call(2, "acted"), true);
    record(call(3, null), true);
    expect(useAgentActivityStore.getState().touched).toEqual({ acted: 2 });
    record(call(7, "acted"), true);
    expect(useAgentActivityStore.getState().touched.acted).toBe(7);
  });

  it("clears the list and the markers", () => {
    useAgentActivityStore.getState().record(call(1), true);
    useAgentActivityStore.getState().clear();
    expect(useAgentActivityStore.getState()).toMatchObject({ calls: [], touched: {} });
  });
});

describe("summarizeCall", () => {
  it("puts the arguments on one line, leaving out tab and empty values", () => {
    expect(summarizeCall({ action: "click", ref: "e12", tab: "aaaa", text: "" })).toBe(
      "action=click ref=e12",
    );
    expect(summarizeCall({ action: "type", ref: "e4", text: "hello world" })).toBe(
      'action=type ref=e4 text="hello world"',
    );
    expect(summarizeCall({ reload: true, timeout: 5 })).toBe("reload=true timeout=5");
    // `why` has its own line in the panel.
    expect(summarizeCall({ action: "click", ref: "e2", why: "open the menu" })).toBe(
      "action=click ref=e2",
    );
  });

  it("stays short and on one line", () => {
    const out = summarizeCall({ code: `document.title\n${"x".repeat(200)}`, more: "y".repeat(80) });
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(90);
  });

  it("takes an error's first line", () => {
    expect(firstLine('No localhost tab "zz". Call tabs.\nmore')).toBe(
      'No localhost tab "zz". Call tabs.',
    );
  });
});

const lines = (...l: string[]) => l.join("\n");

describe("actDid and outcomeOf", () => {
  const reply = lines(
    'Developer flagged e9 button "Pay": broken',
    'Typed "a@b.co" into textbox "Email" [e52]',
    'Clicked button "Export" [e12]',
    "Page changes:",
    '- button "Export" [e12]',
    '+ button "Exporting…" [e12] disabled',
    '+ status "Exported 6 orders"',
    "1 errors:",
    "  TypeError: x is undefined (http://localhost:5173/app.js:3)",
    "2 failed requests:",
    "  net-1 POST 500 12ms fetch http://localhost:5173/api/a",
    "  net-2 POST 500 12ms fetch http://localhost:5173/api/b",
  );

  it("names what an act did by role and name, without refs or the developer's flags", () => {
    expect(actDid(reply)).toBe('Typed "a@b.co" into textbox "Email" · Clicked button "Export"');
    // Page lines can't pass for one: they start with a role or are indented.
    expect(actDid(lines("Page:", '  button "Clicked me" [e3]'))).toBe("");
  });

  it("sums up what it caused: the most telling change, how many more, new problems", () => {
    expect(outcomeOf(reply)).toBe(
      '+ status "Exported 6 orders" (+2 more) · 1 new error · 2 failed requests',
    );
  });

  it("says when nothing changed, the page navigated, a tab or dialog opened", () => {
    expect(
      outcomeOf(
        lines('Clicked link "x" [e1]', "Page unchanged.", "No new errors or failed requests."),
      ),
    ).toBe("page unchanged · no new errors");
    expect(
      outcomeOf(
        lines(
          'Clicked link "Terms" [e9]',
          "Navigated to http://localhost:5173/terms",
          'Opened new tab [3f2a91c0] http://localhost:5173/terms, now the default tab; pass tab="a" to stay on this one.',
          "Page:",
          'heading "Terms"',
          "No new errors or failed requests.",
        ),
      ),
    ).toBe("→ http://localhost:5173/terms · opened a tab · no new errors");
    expect(
      outcomeOf(
        lines('Clicked button "Delete" [e4]', 'A confirm dialog is open: "Sure?". The page'),
      ),
    ).toBe("confirm dialog open");
    expect(outcomeOf(lines('Clicked button "Big" [e4]', "Page:", "main"))).toBe("page redrawn");
    // check reload: a whole page is no "redraw", just the problems.
    expect(
      outcomeOf(lines("After reload:", "No new errors or failed requests.", "Page:", "main")),
    ).toBe("no new errors");
  });
});
