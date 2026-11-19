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
// What the script did to the page, and the newest write before its first page
// call: a failure reply lists both, so a rerun knows what already took effect.
const __done = [];
let __writesFrom = null;
let __sized = false;
const __did = (s) => {
  const last = __done[__done.length - 1];
  if (last && last.s === s) last.n++;
  else __done.push({ s, n: 1 });
};
const FIND_WAIT = 10000;

const __call = (tool, args) => {
  const r = JSON.parse(__host(tool, JSON.stringify(args)));
  if (!r.ok) throw new Error(r.text);
  return r.text;
};
const __withTab = (args) => (__tab ? Object.assign({ tab: __tab }, args) : args);
// setViewportSize() before the script's first goto waits for it: goto may open
// a tab of its own, and the size belongs on that tab, not the one before.
let __went = false;
let __last = null;
let __size = null;
const __applySize = () => {
  const s = __size;
  __size = null;
  if (!s) return;
  __op("size", { width: s.width, height: s.height });
  __sized = true;
};
const __op = (op, args) => {
  if (__writesFrom === null) {
    __writesFrom = -1;
    try {
      __writesFrom = JSON.parse(__call("page", { op: "writes" })).last;
    } catch {}
  }
  if (__size && op !== "goto") __applySize();
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
    __did(`${answer.accept ? "accepted" : "dismissed"} ${d.type} ${__q(String(d.message).slice(0, 40))}`);
  }
}

const __VERBS = { click: "clicked", hover: "hovered", type: "filled", insert: "typed into", select: "selected in" };
/** A locator as a failure reply names it: the selector's last 40 characters, and its index. */
const __target = (loc) => {
  const s = loc._sel.length > 40 ? `…${loc._sel.slice(-39)}` : loc._sel;
  return __q(s) + (loc._nth == null ? "" : `[${loc._nth}]`);
};
/** "clicked "#add"": what was done, never the text typed (it costs tokens and may be a password). */
const __actLabel = (action, loc, text) =>
  action === "press"
    ? `pressed ${text}${loc ? ` in ${__target(loc)}` : ""}`
    : action === "back" || action === "forward"
      ? `went ${action}`
      : loc
        ? `${__VERBS[action] ?? action} ${__target(loc)}`
        : "typed text";

async function __act(action, loc, text, delay) {
  const r = __op("act", { action, selector: loc ? loc._sel : null, nth: loc ? loc._nth : null, text, delay });
  __did(__actLabel(action, loc, text));
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
      if (noWait || !/No element matches/.test(e.message)) throw e;
      if (Date.now() > until) {
        const what = e.message.replace(/^Threw: Error: /, "").split("\n")[0];
        throw new Error(`${what}.${__op("hint").hint}`);
      }
      __sleep(100);
    }
  }
}
const __all = (sel, fn, arg) =>
  __op("eval", { expression: `(${fn})(__zq(${__q(sel)}), ${__q(arg ?? null)})` }).value;

/** A finished request as Playwright's Response (and its request()). */
function __response(e) {
  const request = { url: () => e.url, method: () => e.method };
  return {
    url: () => e.url,
    status: () => e.status,
    ok: () => e.status >= 200 && e.status < 300,
    request: () => request,
    headers: () => __op("body", { id: e.id }).headers,
    async text() {
      return __op("body", { id: e.id }).value;
    },
    async json() {
      return JSON.parse(__op("body", { id: e.id }).value);
    },
  };
}
const __urlTest = (want) =>
  typeof want === "function"
    ? want
    : want instanceof RegExp
      ? (r) => want.test(r.url())
      : (r) => r.url().includes(String(want).replace(/\*\*/g, ""));

/**
 * waitForResponse/waitForRequest: the first finished request after the call
 * that `test` accepts. It yields once before polling, so the action next to it
 * in `Promise.all([page.waitForResponse(...), page.click(...)])` runs first.
 */
async function __waitNet(test, o = {}, what) {
  let since = __op("responses").last;
  await null;
  const until = Date.now() + (o.timeout ?? 30000);
  for (;;) {
    const r = __op("responses", { since });
    for (const e of r.list) {
      if (test(__response(e))) return __response(e);
    }
    since = r.last;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    __sleep(100);
  }
}

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
  contentFrame() {
    const base = this._nth == null ? this._sel : `${this._sel} >> nth=${this._nth}`;
    return __frame(`${base} >> frame >> `);
  }
  frameLocator(sel) {
    return this._sub(sel).contentFrame();
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
  async type(v, o = {}) {
    await __act("insert", this, String(v), o.delay);
  }
  async pressSequentially(v, o = {}) {
    await __act("insert", this, String(v), o.delay);
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
  async boundingBox() {
    if (!this._count()) return null;
    return __read(
      this,
      "(el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }",
    );
  }
  /** No handles here: the locator itself, pinned to its one match. */
  async elementHandle() {
    return this._count() ? new Locator(this._sel, this._nth ?? 0) : null;
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
      if (Date.now() > until) {
        throw new Error(`Timed out waiting for ${__q(this._sel)} to be ${state}.${__op("hint").hint}`);
      }
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

/**
 * The selector methods of a page or a frame: `prefix` scopes every selector
 * ("" for the page, "<iframe selector> >> frame >> " inside a same-origin frame).
 */
function __scope(prefix) {
  const L = (sel) => (sel instanceof Locator ? sel : new Locator(prefix + sel));
  return {
    async $eval(sel, fn, arg) {
      return __read(L(sel), String(fn), arg);
    },
    async $$eval(sel, fn, arg) {
      return __all(prefix + sel, String(fn), arg);
    },
    async $(sel) {
      return L(sel)._count() ? new Locator(prefix + sel, 0) : null;
    },
    async $$(sel) {
      return L(sel).all();
    },
    locator: (sel) => L(sel),
    frameLocator: (sel) => __frame(`${prefix}${sel} >> frame >> `),
    getByRole: (role, o = {}) => L(__byRole(role, o)),
    getByText: (t, o = {}) => L(`text=${__text(t, o.exact)}`),
    getByLabel: (t, o = {}) => L(`label=${__text(t, o.exact)}`),
    getByPlaceholder: (t, o = {}) => L(__attr("placeholder", t, o.exact)),
    getByTestId: (t) => L(__attr("data-testid", t, true)),
    getByTitle: (t, o = {}) => L(__attr("title", t, o.exact)),
    getByAltText: (t, o = {}) => L(__attr("alt", t, o.exact)),
    click: (sel, o) => L(sel).click(o),
    dblclick: (sel) => L(sel).dblclick(),
    tap: (sel) => L(sel).tap(),
    hover: (sel) => L(sel).hover(),
    fill: (sel, v) => L(sel).fill(v),
    type: (sel, v, o) => L(sel).type(v, o),
    press: (sel, key) => L(sel).press(key),
    check: (sel) => L(sel).check(),
    uncheck: (sel) => L(sel).uncheck(),
    selectOption: (sel, v) => L(sel).selectOption(v),
    focus: (sel) => L(sel).focus(),
    textContent: (sel) => L(sel).textContent(),
    innerText: (sel) => L(sel).innerText(),
    innerHTML: (sel) => L(sel).innerHTML(),
    inputValue: (sel) => L(sel).inputValue(),
    getAttribute: (sel, n) => L(sel).getAttribute(n),
    isVisible: (sel) => L(sel).isVisible(),
    isHidden: (sel) => L(sel).isHidden(),
    isChecked: (sel) => L(sel).isChecked(),
    isEnabled: (sel) => L(sel).isEnabled(),
    isDisabled: (sel) => L(sel).isDisabled(),
    async waitForSelector(sel, o = {}) {
      await L(sel).waitFor({ state: o.state ?? "visible", timeout: o.timeout });
      return o.state === "hidden" || o.state === "detached" ? null : new Locator(prefix + sel, 0);
    },
  };
}

/** A same-origin iframe: frameLocator(), locator.contentFrame() and page.frames() entries. */
function __frame(prefix, info = {}) {
  const frame = __scope(prefix);
  // The iframe element itself: the prefix without its trailing " >> frame >> ".
  const el = prefix.slice(0, -" >> frame >> ".length);
  const inFrame = (body) =>
    __op("eval", {
      expression: `(() => { const f = __zq(${__q(el)})[0]; if (!f || !f.contentWindow) throw new Error("No frame matches " + ${__q(el)}); return f.contentWindow.eval(${__q(body)}); })()`,
    }).value;
  return Object.assign(frame, {
    url: () => info.url ?? inFrame("location.href"),
    name: () => info.name ?? "",
    async evaluate(fn, arg) {
      return inFrame(__fnExpr(fn, arg));
    },
    async content() {
      return inFrame("document.documentElement.outerHTML");
    },
  });
}

const page = Object.assign(__scope(""), {
  async goto(url) {
    const r = __op("goto", { url });
    __did(`goto ${String(r.url || url).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || "/"}`);
    __went = true;
    __applySize();
    await __dialogs(r);
    return { ok: () => true, status: () => 200, url: () => r.url };
  },
  async reload() {
    const r = __op("reload");
    __did("reloaded");
    await __dialogs(r);
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
  /** The page, then each same-origin iframe (cross-origin ones are skipped). */
  frames() {
    const list = __op("eval", {
      expression:
        "[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument ? { url: f.contentWindow.location.href, name: f.name } : null; } catch { return null; } })",
    }).value;
    const frames = [];
    list.forEach((f, i) => {
      if (f) frames.push(__frame(`iframe >> nth=${i} >> frame >> `, f));
    });
    return [page, ...frames];
  },
  mainFrame: () => page,
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
  waitForResponse(want, o) {
    const test = __urlTest(want);
    return __waitNet(test, o, `a response matching ${String(want)}`);
  },
  waitForRequest(want, o) {
    const test = __urlTest(want);
    return __waitNet((r) => test(r.request()), o, `a request matching ${String(want)}`).then((r) =>
      r.request(),
    );
  },
  async waitForFunction(fn, arg, o = {}) {
    return __poll(() => __op("eval", { expression: __fnExpr(fn, arg) }).value, o.timeout, "the function");
  },
  keyboard: {
    press: (key) => __act("press", null, key),
    type: (text, o = {}) => __act("insert", null, String(text), o.delay),
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
    __size = { width: s.width, height: s.height };
    __last = __size;
    if (__went) __applySize();
  },
  viewportSize: () => __last,
  context: () => ({
    async cookies() {
      return __op("cookies").value;
    },
  }),
  async bringToFront() {},
  async close() {},
});

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
    out.push(...__trail());
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
  // A size the script set comes off when it ends, so the next run (or the
  // developer) doesn't find the tab still at phone size.
  if (__sized) {
    try {
      __call("page", __withTab({ op: "unsize" }));
    } catch {}
  }
  return JSON.stringify({ ok: !err, text: out.join("\n") });
}

/** "a, b ×2, c": repeats folded, at most `max` kept, the rest counted (`more` names where they were). */
function __fold(items, max, more) {
  const runs = [];
  for (const s of items) {
    const last = runs[runs.length - 1];
    if (last && last.s === s.s) last.n += s.n;
    else runs.push({ s: s.s, n: s.n });
  }
  const shown = more === "earlier" ? runs.slice(-max) : runs.slice(0, max);
  const list = shown.map((r) => (r.n > 1 ? `${r.s} ×${r.n}` : r.s)).join(", ");
  const rest = runs.length - shown.length;
  if (!rest) return list;
  return more === "earlier" ? `(${rest} earlier) ${list}` : `${list} (+${rest} more)`;
}

/**
 * A failed script's trail: the page actions that ran before it failed, and the
 * requests that can change a server (POST, PUT, DELETE...) it sent, which a
 * rerun sends again. Nothing on a success: that reply stays as it was.
 */
function __trail() {
  const lines = [];
  if (__done.length) lines.push(`Done before it failed: ${__fold(__done, 8, "earlier")}.`);
  else if (__used) lines.push("Nothing was done on the page before it failed.");
  if (typeof __writesFrom === "number" && __writesFrom >= 0) {
    try {
      const list = JSON.parse(__call("page", { op: "writes", since: __writesFrom })).list;
      if (list.length) {
        const path = (u) => String(u).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || "/";
        const items = list.map((w) => ({
          s: `${w.method} ${path(w.url)} ${w.status}${w.mocked ? " (mocked)" : ""}`,
          n: 1,
        }));
        lines.push(`Sent before it failed: ${__fold(items, 5, "more")}; a rerun sends these again.`);
      }
    } catch {}
  }
  return lines;
}
