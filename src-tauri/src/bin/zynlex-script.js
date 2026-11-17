// The `script` tool's runtime: a Playwright-style `page` the agent's script
// drives, run by QuickJS inside zynlex-mcp. Every page call becomes one `page`
// call to ZYNLEX (src/lib/agent.ts pageTool), where it uses the same real
// input, settling and dialog handling as `act`. The host gives four
// functions: __host(tool, argsJson) -> '{"ok":bool,"text":string}',
// __sleep(ms), __tab (the tab id or ""), and nothing else: no files, no network.
// Selectors are resolved in the page by src/lib/agentQuery.ts.
"use strict";
const __logs = [];
const __notes = [];
const __handlers = [];
// Whether the script touched a page: only then does the reply end with its errors.
let __used = false;
const FIND_WAIT = 10000;

const __call = (tool, args) => {
  const r = JSON.parse(__host(tool, JSON.stringify(args)));
  if (!r.ok) throw new Error(r.text);
  return r.text;
};
const __withTab = (args) => (__tab ? Object.assign({ tab: __tab }, args) : args);
const __op = (op, args) => {
  __used = true;
  const text = __call("page", __withTab(Object.assign({}, args, { op })));
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error(text);
  }
  if (r.note) __notes.push(r.note);
  if (r.flags) __notes.push(r.flags);
  return r;
};
const __show = (v) => {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
const __q = (s) => JSON.stringify(s);
// ponytail: a RegExp becomes a case-insensitive substring of its source; the
// engine has no regex matching. Covers /Save/i, not /^Save$|^Submit$/.
const __text = (t, exact) =>
  t instanceof RegExp ? t.source.replace(/^\^|\$$/g, "") : exact ? __q(String(t)) : String(t);

/** Answers dialogs an action opened: page.on("dialog") handlers, else dismiss (Playwright's default). */
async function __dialogs(r) {
  let guard = 0;
  while (r && r.dialog && guard++ < 5) {
    const d = r.dialog;
    let answer = null;
    const dlg = {
      type: () => d.type,
      message: () => d.message,
      defaultValue: () => "",
      accept: async (text) => {
        answer = { accept: true, text };
      },
      dismiss: async () => {
        answer = { accept: false };
      },
    };
    for (const h of __handlers.slice()) {
      if (h.once) __handlers.splice(__handlers.indexOf(h), 1);
      await h.fn(dlg);
      if (answer) break;
    }
    if (!answer) {
      answer = { accept: false };
      __notes.push(`Dismissed ${d.type} "${d.message}" (no page.on("dialog") handler).`);
    }
    r = __op("dialog", answer);
  }
}

async function __act(action, loc, text) {
  const r = __op("act", { action, selector: loc ? loc._sel : null, nth: loc ? loc._nth : null, text });
  await __dialogs(r);
}

/** Runs fn(el, arg) on the locator's element in the page; waits for it to exist unless `noWait`. */
async function __read(loc, fn, arg, noWait) {
  const expr = `(() => {
    const els = __zq(${__q(loc._sel)});
    const nth = ${loc._nth == null ? "null" : loc._nth};
    if (nth == null && els.length > 1) throw new Error("strict mode violation: " + ${__q(loc._sel)} + " matches " + els.length + " elements. Use .first(), .nth(i) or a narrower selector.");
    const el = els.at(nth ?? 0);
    if (!el) throw new Error("No element matches " + ${__q(loc._sel)});
    return (${fn})(el, ${__q(arg ?? null)});
  })()`;
  const until = Date.now() + FIND_WAIT;
  for (;;) {
    try {
      return __op("eval", { expression: expr }).value;
    } catch (e) {
      if (noWait || !/No element matches/.test(e.message) || Date.now() > until) throw e;
      __sleep(100);
    }
  }
}
const __all = (sel, fn, arg) =>
  __op("eval", { expression: `(${fn})(__zq(${__q(sel)}), ${__q(arg ?? null)})` }).value;

class Locator {
  constructor(sel, nth = null) {
    this._sel = sel;
    this._nth = nth;
  }
  _sub(sel) {
    // An index applies before going deeper.
    const base = this._nth == null ? this._sel : `${this._sel} >> nth=${this._nth}`;
    return new Locator(`${base} >> ${sel instanceof Locator ? sel._sel : sel}`);
  }
  locator(sel) {
    return this._sub(sel);
  }
  getByRole(role, o = {}) {
    return this._sub(__byRole(role, o));
  }
  getByText(t, o = {}) {
    return this._sub(`text=${__text(t, o.exact)}`);
  }
  getByLabel(t, o = {}) {
    return this._sub(`label=${__text(t, o.exact)}`);
  }
  getByPlaceholder(t, o = {}) {
    return this._sub(__attr("placeholder", t, o.exact));
  }
  getByTestId(t) {
    return this._sub(__attr("data-testid", t, true));
  }
  getByTitle(t, o = {}) {
    return this._sub(__attr("title", t, o.exact));
  }
  getByAltText(t, o = {}) {
    return this._sub(__attr("alt", t, o.exact));
  }
  filter(o = {}) {
    let sel = this._nth == null ? this._sel : `${this._sel} >> nth=${this._nth}`;
    if (o.hasText != null) sel += ` >> has-text=${__text(o.hasText)}`;
    return new Locator(sel);
  }
  first() {
    return new Locator(this._sel, 0);
  }
  last() {
    return new Locator(this._sel, -1);
  }
  nth(i) {
    return new Locator(this._sel, i);
  }
  async click(o = {}) {
    await __act("click", this);
    if (o.clickCount === 2) await __act("click", this);
  }
  async dblclick() {
    await __act("click", this);
    await __act("click", this);
  }
  async tap() {
    await __act("click", this);
  }
  async hover() {
    await __act("hover", this);
  }
  async fill(v) {
    await __act("type", this, String(v));
  }
  async clear() {
    await __act("type", this, "");
  }
  async type(v) {
    await __act("insert", this, String(v));
  }
  async pressSequentially(v) {
    await __act("insert", this, String(v));
  }
  async press(key) {
    await __act("press", this, key);
  }
  async check() {
    if (!(await this.isChecked())) await __act("click", this);
  }
  async uncheck() {
    if (await this.isChecked()) await __act("click", this);
  }
  async setChecked(v) {
    if ((await this.isChecked()) !== !!v) await __act("click", this);
  }
  async selectOption(v) {
    const one = Array.isArray(v) ? v[0] : v;
    const val = one && typeof one === "object" ? (one.label ?? one.value) : one;
    await __act("select", this, String(val));
    return [String(val)];
  }
  async focus() {
    await __read(this, "(el) => { el.focus(); }");
  }
  async scrollIntoViewIfNeeded() {
    await __read(this, "(el) => { el.scrollIntoView({ block: 'center' }); }");
  }
  async textContent() {
    return __read(this, "(el) => el.textContent");
  }
  async innerText() {
    return __read(this, "(el) => el.innerText");
  }
  async innerHTML() {
    return __read(this, "(el) => el.innerHTML");
  }
  async inputValue() {
    return __read(this, "(el) => el.value");
  }
  async getAttribute(name) {
    return __read(this, "(el, n) => el.getAttribute(n)", name);
  }
  async isVisible() {
    return this._count() > 0 && __read(this, __VISIBLE, null, true);
  }
  async isHidden() {
    return !(await this.isVisible());
  }
  async isChecked() {
    return __read(this, "(el) => !!(el.checked ?? el.getAttribute('aria-checked') === 'true')");
  }
  async isEnabled() {
    return __read(this, "(el) => !el.disabled");
  }
  async isDisabled() {
    return __read(this, "(el) => !!el.disabled");
  }
  async evaluate(fn, arg) {
    return __read(this, String(fn), arg);
  }
  async evaluateAll(fn, arg) {
    return __all(this._sel, String(fn), arg);
  }
  _count() {
    return this._nth == null
      ? __all(this._sel, "(els) => els.length")
      : __all(this._sel, "(els, i) => (els.at(i) ? 1 : 0)", this._nth);
  }
  async count() {
    return this._count();
  }
  async all() {
    const n = this._count();
    return Array.from({ length: n }, (_, i) => new Locator(this._sel, i));
  }
  async allTextContents() {
    return __all(this._sel, "(els) => els.map((e) => e.textContent)");
  }
  async allInnerTexts() {
    return __all(this._sel, "(els) => els.map((e) => e.innerText)");
  }
  async waitFor(o = {}) {
    const state = o.state ?? "visible";
    const until = Date.now() + (o.timeout ?? FIND_WAIT);
    for (;;) {
      const n = this._count();
      const visible = n > 0 && __read(this, __VISIBLE, null, true);
      const ok =
        state === "attached" ? n > 0 : state === "detached" ? n === 0 : state === "hidden" ? !visible : visible;
      if (ok) return;
      if (Date.now() > until) throw new Error(`Timed out waiting for ${__q(this._sel)} to be ${state}.`);
      __sleep(100);
    }
  }
}
const __VISIBLE =
  "(el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }";
const __attr = (name, t, exact) =>
  exact ? `[${name}=${__q(String(t))}]` : `[${name}*=${__q(__text(t))} i]`;
const __byRole = (role, o) =>
  o.name == null ? `role=${role}` : `role=${role}[name=${__text(o.name, o.exact)}]`;
const __loc = (sel) => (sel instanceof Locator ? sel : new Locator(sel));

async function __poll(test, timeout, what) {
  const until = Date.now() + (timeout ?? FIND_WAIT);
  for (;;) {
    const v = test();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    __sleep(100);
  }
}
const __fnExpr = (fn, arg) =>
  typeof fn === "function" ? `(${String(fn)})(${__q(arg ?? null)})` : String(fn);

const page = {
  async goto(url) {
    const r = __op("goto", { url });
    await __dialogs(r);
    return { ok: () => true, status: () => 200, url: () => r.url };
  },
  async reload() {
    await __dialogs(__op("reload"));
  },
  async goBack() {
    await __act("back", null);
  },
  async goForward() {
    await __act("forward", null);
  },
  url() {
    return __op("state").url;
  },
  async title() {
    return __op("state").title;
  },
  async content() {
    return __op("eval", { expression: "document.documentElement.outerHTML" }).value;
  },
  async evaluate(fn, arg) {
    return __op("eval", { expression: __fnExpr(fn, arg) }).value;
  },
  async $eval(sel, fn, arg) {
    return __read(__loc(sel), String(fn), arg);
  },
  async $$eval(sel, fn, arg) {
    return __all(sel, String(fn), arg);
  },
  async $(sel) {
    return __loc(sel)._count() ? new Locator(sel, 0) : null;
  },
  async $$(sel) {
    return __loc(sel).all();
  },
  locator: (sel) => __loc(sel),
  getByRole: (role, o = {}) => new Locator(__byRole(role, o)),
  getByText: (t, o = {}) => new Locator(`text=${__text(t, o.exact)}`),
  getByLabel: (t, o = {}) => new Locator(`label=${__text(t, o.exact)}`),
  getByPlaceholder: (t, o = {}) => new Locator(__attr("placeholder", t, o.exact)),
  getByTestId: (t) => new Locator(__attr("data-testid", t, true)),
  getByTitle: (t, o = {}) => new Locator(__attr("title", t, o.exact)),
  getByAltText: (t, o = {}) => new Locator(__attr("alt", t, o.exact)),
  click: (sel, o) => __loc(sel).click(o),
  dblclick: (sel) => __loc(sel).dblclick(),
  tap: (sel) => __loc(sel).tap(),
  hover: (sel) => __loc(sel).hover(),
  fill: (sel, v) => __loc(sel).fill(v),
  type: (sel, v) => __loc(sel).type(v),
  press: (sel, key) => __loc(sel).press(key),
  check: (sel) => __loc(sel).check(),
  uncheck: (sel) => __loc(sel).uncheck(),
  selectOption: (sel, v) => __loc(sel).selectOption(v),
  focus: (sel) => __loc(sel).focus(),
  textContent: (sel) => __loc(sel).textContent(),
  innerText: (sel) => __loc(sel).innerText(),
  innerHTML: (sel) => __loc(sel).innerHTML(),
  inputValue: (sel) => __loc(sel).inputValue(),
  getAttribute: (sel, n) => __loc(sel).getAttribute(n),
  isVisible: (sel) => __loc(sel).isVisible(),
  isHidden: (sel) => __loc(sel).isHidden(),
  isChecked: (sel) => __loc(sel).isChecked(),
  isEnabled: (sel) => __loc(sel).isEnabled(),
  isDisabled: (sel) => __loc(sel).isDisabled(),
  async waitForSelector(sel, o = {}) {
    await __loc(sel).waitFor({ state: o.state ?? "visible", timeout: o.timeout });
    return o.state === "hidden" || o.state === "detached" ? null : new Locator(sel, 0);
  },
  async waitForTimeout(ms) {
    __sleep(Math.min(Number(ms) || 0, 15000));
  },
  async waitForLoadState() {
    await __dialogs(__op("settle"));
  },
  async waitForURL(want, o = {}) {
    const test =
      want instanceof RegExp
        ? (u) => want.test(u)
        : typeof want === "function"
          ? (u) => want(new URL(u))
          : (u) => u.includes(String(want).replace(/\*\*/g, ""));
    await __poll(() => test(page.url()), o.timeout, `the URL to match ${String(want)}`);
  },
  async waitForFunction(fn, arg, o = {}) {
    return __poll(() => __op("eval", { expression: __fnExpr(fn, arg) }).value, o.timeout, "the function");
  },
  keyboard: {
    press: (key) => __act("press", null, key),
    type: (text) => __act("insert", null, String(text)),
    insertText: (text) => __act("insert", null, String(text)),
  },
  on(event, fn) {
    if (event === "dialog") __handlers.push({ fn, once: false });
    return page;
  },
  once(event, fn) {
    if (event === "dialog") __handlers.push({ fn, once: true });
    return page;
  },
  off(event, fn) {
    const i = __handlers.findIndex((h) => h.fn === fn);
    if (i >= 0) __handlers.splice(i, 1);
    return page;
  },
  removeListener(event, fn) {
    return page.off(event, fn);
  },
  async screenshot(o = {}) {
    return __call("screenshot", __withTab({ full: !!o.fullPage }));
  },
  async setViewportSize(s) {
    __call("viewport", __withTab({ width: s.width, height: s.height }));
  },
  async bringToFront() {},
  async close() {},
};

// No event loop here: a timer sleeps, then runs its callback as a microtask,
// which is all `await new Promise((r) => setTimeout(r, 500))` needs.
globalThis.setTimeout = (fn, ms) => {
  __sleep(Math.min(Number(ms) || 0, 15000));
  Promise.resolve().then(() => fn());
  return 0;
};
globalThis.clearTimeout = () => {};

/** zynlex.<tool>(args): any other ZYNLEX tool, returning its reply text. */
const zynlex = new Proxy(
  {},
  { get: (_, name) => async (args = {}) => __call(String(name), __withTab(args)) },
);

const console = {
  log: (...a) => {
    __logs.push(a.map(__show).join(" "));
  },
};
console.info = console.warn = console.error = console.debug = console.log;

/** The reply: what the script returned, its log, dialogs it dismissed, then the page's new errors. */
function __report(err, value) {
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more chars cut)` : s);
  const out = [];
  // QuickJS's stack is the trace alone, without the message. Only the
  // agent's own line matters: its code starts on line 2 of the wrapper.
  if (err) {
    const what = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const m = /at <anonymous> \(eval_script:(\d+):\d+\)/.exec(String(err && err.stack));
    out.push(`Script failed${m ? ` at line ${Number(m[1]) - 1}` : ""}: ${what}`);
  }
  else out.push(value === undefined ? "Done (nothing returned)." : cut(__show(value), 4000));
  if (__logs.length) out.push("Log:", cut(__logs.join("\n"), 2000));
  out.push(...__notes);
  if (__used) {
    try {
      const lines = __op("problems").lines;
      out.push(...(lines.length ? lines : ["No new errors or failed requests."]));
    } catch (e) {
      out.push(`(Couldn't read the page's errors: ${e.message})`);
    }
  }
  return JSON.stringify({ ok: !err, text: out.join("\n") });
}
