import { describe, expect, it } from "vitest";
import {
  addStep,
  errorText,
  fallbackTarget,
  formatRecording,
  isSecretNode,
  type RawEvent,
  RECORDER_SCRIPT,
  type Recording,
  type Step,
  type Target,
  toStep,
} from "./agentRecord";

const btn = (name: string, ref: number | null = 41): Target => ({ role: "button", name, ref });
const box = (name: string, ref: number | null = 52): Target => ({ role: "textbox", name, ref });
const raw = (r: Partial<RawEvent>): RawEvent => ({
  seq: 1,
  t: 0,
  kind: "click",
  tag: "button",
  label: "",
  ...r,
});

const rec = (steps: Step[], happenings: Recording["happenings"] = []): Recording => ({
  tabId: "abcdef12-3456",
  workspaceId: "ws1",
  url: "http://localhost:5173/cart",
  title: "Shop",
  startedAt: 0,
  stoppedAt: 42_000,
  steps,
  happenings,
});

describe("password rule", () => {
  it("spots password and secret fields by attribute", () => {
    expect(isSecretNode(["type", "password", "id", "pw"])).toBe(true);
    expect(isSecretNode(["TYPE", "Password"])).toBe(true);
    expect(isSecretNode(["autocomplete", "current-password"])).toBe(true);
    expect(isSecretNode(["autocomplete", "one-time-code"])).toBe(true);
    expect(isSecretNode(["type", "text", "name", "password-hint"])).toBe(false);
    expect(isSecretNode(undefined)).toBe(false);
  });

  it("drops a value the page sent for a password field", () => {
    const s = toStep(raw({ kind: "type", value: "hunter2" }), box("Password"), [
      "type",
      "password",
    ]);
    expect(s.secret).toBe(true);
    expect(s.value).toBeUndefined();
    const flagged = toStep(raw({ kind: "type", value: "hunter2", sensitive: true }), box("Pin"));
    expect(flagged.value).toBeUndefined();
    expect(formatRecording(rec([s]))).toContain(
      'type textbox "Password" [e52] (password, not recorded)',
    );
    expect(formatRecording(rec([s]))).not.toContain("hunter2");
  });

  it("carries the element's test id onto its target", () => {
    expect(toStep(raw({ testid: "add-btn" }), btn("Add")).target).toMatchObject({
      name: "Add",
      testid: "add-btn",
    });
    expect(toStep(raw({}), btn("Add")).target?.testid).toBeUndefined();
  });

  it("keeps the value of an ordinary field", () => {
    expect(
      toStep(raw({ kind: "type", value: "a@b.co" }), box("Email"), ["type", "email"]).value,
    ).toBe("a@b.co");
  });
});

describe("addStep", () => {
  it("collapses typing into one field to its final value, keeping the first time", () => {
    const steps: Step[] = [];
    addStep(steps, { t: 1, action: "click", target: box("Email") });
    addStep(steps, { t: 2, action: "type", target: box("Email"), value: "a" });
    addStep(steps, { t: 3, action: "type", target: box("Email"), value: "ab" });
    addStep(steps, { t: 4, action: "press", target: box("Email"), key: "Backspace" });
    addStep(steps, { t: 5, action: "type", target: box("Email"), value: "a@b.co" });
    expect(steps).toEqual([{ t: 1, action: "type", target: box("Email"), value: "a@b.co" }]);
  });

  it("keeps typing into different fields, and the same field again later, apart", () => {
    const steps: Step[] = [];
    addStep(steps, { t: 1, action: "type", target: box("Email"), value: "a" });
    addStep(steps, { t: 2, action: "type", target: box("Name", 53), value: "Ann" });
    addStep(steps, { t: 3, action: "type", target: box("Email"), value: "a@b.co" });
    expect(steps.map((s) => s.value)).toEqual(["a", "Ann", "a@b.co"]);
  });

  it("matches fields by role and name when there is no ref", () => {
    const steps: Step[] = [];
    addStep(steps, { t: 1, action: "type", target: box("Email", null), value: "a" });
    addStep(steps, { t: 2, action: "type", target: box("Email", null), value: "ab" });
    expect(steps).toHaveLength(1);
  });
});

describe("formatRecording", () => {
  it("numbers the steps and puts what each caused after an arrow", () => {
    const out = formatRecording(
      rec(
        [
          { t: 1000, action: "type", target: box("Email"), value: "a@b.co" },
          {
            t: 2000,
            action: "select",
            target: { role: "combobox", name: "Country", ref: 60 },
            value: "India",
          },
          { t: 3000, action: "click", target: btn("Pay") },
          { t: 4000, action: "press", target: null, key: "Escape" },
        ],
        [
          {
            t: 3100,
            kind: "failed",
            text: "POST /api/pay 500",
            url: "http://localhost:5173/api/pay",
          },
          {
            t: 3050,
            kind: "failed",
            text: "/api/pay 500",
            url: "http://localhost:5173/api/pay",
            console: true,
          },
          { t: 3200, kind: "error", text: "TypeError: x is undefined" },
        ],
      ),
    );
    expect(out.split("\n")).toEqual([
      'Recording of http://localhost:5173/cart "Shop" [abcdef12], 42s, 4 steps:',
      '1. type textbox "Email" [e52] "a@b.co"',
      '2. select combobox "Country" [e60] "India"',
      '3. click button "Pay" [e41] → POST /api/pay 500, TypeError: x is undefined',
      "4. press Escape",
      "Refs are from recording time; take a snapshot before acting on them.",
    ]);
  });

  it("shows a navigation soon after a step as its result, and a later one as a step", () => {
    const out = formatRecording(
      rec(
        [{ t: 1000, action: "click", target: { role: "link", name: "Checkout", ref: 9 } }],
        [
          { t: 1500, kind: "nav", text: "http://localhost:5173/checkout" },
          { t: 9000, kind: "nav", text: "http://localhost:5173/admin" },
          { t: 9500, kind: "error", text: "Forbidden" },
        ],
      ),
    );
    expect(out).toContain('1. click link "Checkout" [e9] → /checkout');
    expect(out).toContain("2. open /admin → Forbidden");
  });

  it("lists what happened before the first step, and says when nothing was recorded", () => {
    expect(formatRecording(rec([], [{ t: 10, kind: "error", text: "boom" }]))).toBe(
      'Recording of http://localhost:5173/cart "Shop" [abcdef12], 42s, 0 steps:\n0. (before the first step) → boom\n(no steps recorded)',
    );
    expect(formatRecording({ ...rec([]), stoppedAt: null }, 5000)).toContain("5s, still recording");
  });

  it("caps what one step caused", () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) => ({ t: 2, kind: "error" as const, text: `E${n}` }));
    expect(formatRecording(rec([{ t: 1, action: "click", target: btn("Go") }], many))).toContain(
      "→ E1, E2, E3, E4, +2 more",
    );
  });

  it("trims exception text and falls back to the page's words for an element", () => {
    expect(errorText("Uncaught TypeError: a is null\n    at x.js:1")).toBe("TypeError: a is null");
    expect(fallbackTarget(raw({ tag: "input:email", label: "Email" }))).toEqual({
      role: "textbox",
      name: "Email",
      ref: null,
    });
    expect(fallbackTarget(raw({ tag: "a", label: "Home" }))?.role).toBe("link");
    expect(fallbackTarget(raw({ tag: "" }))).toBeNull();
  });
});

// ─── The in-page listener, against a fake page ──────────────────────

interface FakeEl {
  nodeType: 1;
  tagName: string;
  type?: string;
  value?: string;
  attrs: Record<string, string>;
  labels?: FakeEl[];
  isContentEditable?: boolean;
  textContent?: string;
  getAttribute(n: string): string | null;
  closest(sel: string): FakeEl | null;
}

function el(tag: string, attrs: Record<string, string> = {}, extra: Partial<FakeEl> = {}): FakeEl {
  const e: FakeEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    type: attrs.type ?? (tag === "input" ? "text" : undefined),
    getAttribute: (n) => attrs[n] ?? null,
    closest(sel) {
      return sel.split(",").includes(tag) ? e : null;
    },
    ...extra,
  };
  return e;
}

function fakePage() {
  const handlers: Record<string, (e: object) => void> = {};
  const win: Record<PropertyKey, unknown> = {};
  win.top = win;
  const doc = {
    body: {},
    documentElement: {},
    addEventListener: (k: string, fn: (e: object) => void) => {
      handlers[k] = fn;
    },
    removeEventListener: (k: string) => {
      delete handlers[k];
    },
  };
  new Function("window", "document", RECORDER_SCRIPT)(win, doc);
  const api = win[Symbol.for("zynlex.recorder")] as {
    drain(): RawEvent[];
    el(s: number): unknown;
    stop(): void;
  };
  const fire = (kind: string, target: FakeEl, e: object = {}) =>
    handlers[kind]?.({ isTrusted: true, target, composedPath: () => [target], detail: 1, ...e });
  return { api, fire, handlers, win };
}

describe("RECORDER_SCRIPT", () => {
  it("buffers trusted typing with the value, and never a password's value", () => {
    const { api, fire } = fakePage();
    const email = el("input", { type: "email", "aria-label": "Email" }, { value: "a@b.co" });
    const pw = el("input", { type: "password", placeholder: "Password" }, { value: "hunter2" });
    fire("input", email);
    fire("input", pw);
    fire("input", email, { isTrusted: false });
    const out = api.drain();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      kind: "type",
      value: "a@b.co",
      tag: "input:email",
      label: "Email",
    });
    expect(out[1]).toMatchObject({ kind: "type", sensitive: true, label: "Password" });
    expect(out[1].value).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(api.el(out[0].seq)).toBe(email);
    expect(api.drain()).toEqual([]);
  });

  it("keeps a password field secret after a show-password toggle makes it text", () => {
    const { api, fire } = fakePage();
    const pw = el("input", { type: "password" }, { value: "x" });
    fire("focusin", pw);
    pw.type = "text";
    pw.attrs.type = "text";
    pw.value = "hunter2";
    fire("input", pw);
    expect(api.drain()[0]).toMatchObject({ sensitive: true });
  });

  it("records clicks, choices and keys, skipping the click an Enter causes", () => {
    const { api, fire } = fakePage();
    const pay = el("button", { "data-testid": "pay" }, { textContent: " Pay " });
    const field = el("input", { "aria-label": "Card" }, { value: "" });
    const select = el("select", {});
    Object.assign(select, { selectedOptions: [{ label: "India " }] });
    fire("click", pay);
    fire("change", select);
    fire("keydown", field, { key: "Enter" });
    fire("click", pay, { detail: 0 });
    fire("keydown", field, { key: "Backspace" });
    fire("keydown", field, { key: "a" });
    fire("keydown", field, { key: "Enter", ctrlKey: true });
    const out = api.drain();
    expect(out.map((e) => [e.kind, e.value ?? e.key ?? e.label])).toEqual([
      ["click", "Pay"],
      ["select", "India"],
      ["press", "Enter"],
    ]);
    expect(out[0].testid).toBe("pay");
    expect(out[1].testid).toBeUndefined();
  });

  it("listens once per page and stops cleanly", () => {
    const { api, handlers, win } = fakePage();
    expect(Object.keys(handlers).sort()).toEqual([
      "change",
      "click",
      "focusin",
      "input",
      "keydown",
    ]);
    api.stop();
    expect(Object.keys(handlers)).toEqual([]);
    expect(win[Symbol.for("zynlex.recorder")]).toBeUndefined();
  });
});
