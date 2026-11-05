/**
 * "Show the agent what I did" (agent-roadmap M2): the developer's own clicks,
 * typing, choices and key presses in a tab, as `act`-shaped steps, each with
 * the errors, failed requests and navigation it caused. Pure: the recorder
 * (recorder.ts) feeds it, the `recording` agent tool prints it.
 *
 * Capture respects the security model (docs/architecture.md): the page never
 * sends anything. RECORDER_SCRIPT buffers events inside the page and the app
 * drains the buffer with its own `Runtime.evaluate` calls. Password fields
 * never leave the page with a value, and are dropped again here.
 */

type StepAction = "click" | "type" | "select" | "press" | "upload" | "open";

/** One event as the in-page listener buffered it (see RECORDER_SCRIPT). */
export interface RawEvent {
  seq: number;
  t: number;
  kind: Exclude<StepAction, "open">;
  /** type: the field's value now; select: the chosen option's label; upload: file names. */
  value?: string;
  /** press: the key. */
  key?: string;
  /** The page saw a password field (or a show-password toggle of one); `value` was not sent. */
  sensitive?: boolean;
  /** Fallbacks for when CDP can't describe the element: tag name, `input:<type>` for inputs. */
  tag: string;
  label: string;
}

/** The element a step acted on, in the snapshot's words. */
export interface Target {
  role: string;
  name: string;
  /** backendDOMNodeId, printed as e<ref>; null when it couldn't be resolved. */
  ref: number | null;
}

const TAG_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
  summary: "button",
  "input:checkbox": "checkbox",
  "input:radio": "radio",
  "input:submit": "button",
  "input:button": "button",
  "input:reset": "button",
  "input:search": "searchbox",
  "input:range": "slider",
  "input:number": "spinbutton",
};

/** The target from what the page script saw, for an element CDP couldn't describe. */
export function fallbackTarget(raw: RawEvent): Target | null {
  if (!raw.tag) return null;
  const role = TAG_ROLES[raw.tag] ?? (raw.tag.startsWith("input:") ? "textbox" : raw.tag);
  return { role, name: raw.label, ref: null };
}

export interface Step {
  t: number;
  action: StepAction;
  target: Target | null;
  key?: string;
  value?: string;
  /** A password: the value is never kept. */
  secret?: boolean;
  /** open: the URL. */
  url?: string;
}

/** Something a step caused, stamped when the app received it. */
export interface Happening {
  t: number;
  kind: "error" | "failed" | "nav";
  /** nav: the full URL; otherwise the line as printed. */
  text: string;
  /** failed: the request URL, so the console's line for it can give way to the network row's. */
  url?: string;
  /** failed: from the console (no method), not a network row. */
  console?: boolean;
}

export interface Recording {
  tabId: string;
  url: string;
  title: string;
  startedAt: number;
  /** null while still recording. */
  stoppedAt: number | null;
  steps: Step[];
  happenings: Happening[];
}

/** A navigation more than this long after the last step is a step of its own (the address bar). */
const NAV_WINDOW = 3000;
const MAX_VALUE = 80;
const MAX_CAUSED = 4;
const MAX_STEPS = 200;

/** Key presses worth a step. Editing keys inside a text field are part of its final value. */
const RECORDED_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
];
const EDITING_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete"];

/**
 * True when a node's attributes (CDP's flat [name, value, …] list) mark a
 * password or a payment/one-time secret: the value is dropped whatever the
 * page script said.
 */
export function isSecretNode(attributes: string[] | undefined): boolean {
  if (!attributes) return false;
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    const name = attributes[i].toLowerCase();
    const v = attributes[i + 1].toLowerCase();
    if (name === "type" && v === "password") return true;
    if (name === "autocomplete" && /password|one-time-code|cc-number|cc-csc/.test(v)) return true;
  }
  return false;
}

/** A buffered event as a step. Values of secret fields are dropped here too. */
export function toStep(raw: RawEvent, target: Target | null, attributes?: string[]): Step {
  const secret = raw.kind === "type" && (raw.sensitive === true || isSecretNode(attributes));
  const step: Step = { t: raw.t, action: raw.kind, target };
  if (raw.key) step.key = raw.key;
  if (secret) step.secret = true;
  else if (raw.value != null) step.value = raw.value;
  return step;
}

const sameTarget = (a: Target | null, b: Target | null) =>
  !!a &&
  !!b &&
  (a.ref != null && b.ref != null ? a.ref === b.ref : a.role === b.role && a.name === b.name);

/**
 * Appends a step, collapsing typing: keystrokes into the same field in a row
 * become one `type` with the final value (and its first time, so what the
 * first keystroke caused stays with it), and the click that focused the field
 * is folded into it. Returns the list it was given, changed in place.
 */
export function addStep(steps: Step[], step: Step): Step[] {
  const last = steps[steps.length - 1];
  if (step.action === "type" && last && sameTarget(last.target, step.target)) {
    if (last.action === "type") {
      steps[steps.length - 1] = { ...step, t: last.t };
      return steps;
    }
    if (last.action === "click") {
      steps[steps.length - 1] = { ...step, t: last.t };
      return steps;
    }
  }
  // A press of an editing key in a field being typed into is part of the typing.
  if (
    step.action === "press" &&
    last?.action === "type" &&
    EDITING_KEYS.includes(step.key ?? "") &&
    sameTarget(last.target, step.target)
  ) {
    return steps;
  }
  if (steps.length < MAX_STEPS) steps.push(step);
  return steps;
}

/** `role "name" [e12]`, the way a snapshot line starts. */
function describeTarget(t: Target | null): string {
  if (!t) return "the page";
  const parts = [t.role || "element"];
  if (t.name) parts.push(JSON.stringify(clip(t.name, 60)));
  if (t.ref != null) parts.push(`[e${t.ref}]`);
  return parts.join(" ");
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** The URL relative to the recorded page's origin, so lines stay short. */
export function shortUrl(url: string, origin: string): string {
  if (!origin || !url.startsWith(origin)) return url;
  return url.slice(origin.length) || "/";
}

/** An exception's first line, without "Uncaught ". */
export function errorText(text: string): string {
  return clip(text.split("\n")[0].replace(/^Uncaught\s+/, ""), 120);
}

function stepLine(s: Step, origin: string): string {
  const on = describeTarget(s.target);
  switch (s.action) {
    case "type":
      return s.secret
        ? `type ${on} (password, not recorded)`
        : `type ${on} ${JSON.stringify(clip(s.value ?? "", MAX_VALUE))}`;
    case "select":
      return `select ${on} ${JSON.stringify(clip(s.value ?? "", MAX_VALUE))}`;
    case "press":
      return s.target ? `press ${s.key} in ${on}` : `press ${s.key}`;
    case "upload":
      return `upload ${on} ${s.value ?? ""}`.trimEnd();
    case "open":
      return `open ${shortUrl(s.url ?? "", origin)}`;
    default:
      return `click ${on}`;
  }
}

/**
 * Turns navigations nobody's step explains into `open` steps, then gives each
 * happening to the last step before it. What came before the first step is
 * returned apart.
 */
function attribute(rec: Recording): { steps: Step[]; caused: Happening[][]; before: Happening[] } {
  const steps = [...rec.steps];
  const rest: Happening[] = [];
  for (const h of [...rec.happenings].sort((a, b) => a.t - b.t)) {
    if (h.kind === "nav") {
      const prev = steps.filter((s) => s.t <= h.t).pop();
      if (!prev || h.t - prev.t > NAV_WINDOW) {
        steps.push({ t: h.t, action: "open", target: null, url: h.text });
        steps.sort((a, b) => a.t - b.t);
        continue;
      }
    }
    rest.push(h);
  }
  const caused: Happening[][] = steps.map(() => []);
  const before: Happening[] = [];
  for (const h of rest) {
    let i = -1;
    for (let j = 0; j < steps.length && steps[j].t <= h.t; j++) i = j;
    (i < 0 ? before : caused[i]).push(h);
  }
  return { steps, caused, before };
}

function causedText(list: Happening[], origin: string): string {
  const order = { nav: 0, failed: 1, error: 2 };
  const rows = new Set(list.filter((h) => h.kind === "failed" && !h.console).map((h) => h.url));
  const texts = [
    ...new Set(
      list
        .filter((h) => !(h.console && rows.has(h.url)))
        .sort((a, b) => order[a.kind] - order[b.kind])
        .map((h) => (h.kind === "nav" ? shortUrl(h.text, origin) : h.text)),
    ),
  ];
  const more = texts.length - MAX_CAUSED;
  return texts.slice(0, MAX_CAUSED).join(", ") + (more > 0 ? `, +${more} more` : "");
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/** The recording as the agent reads it: a header, then one numbered line per step. */
export function formatRecording(rec: Recording, now = Date.now()): string {
  const origin = originOf(rec.url);
  const secs = Math.round(((rec.stoppedAt ?? now) - rec.startedAt) / 1000);
  const { steps, caused, before } = attribute(rec);
  const state = rec.stoppedAt == null ? ", still recording" : "";
  const head = `Recording of ${rec.url} "${rec.title}" [${rec.tabId.slice(0, 8)}], ${secs}s${state}, ${steps.length} step${steps.length === 1 ? "" : "s"}:`;
  const lines = [head];
  if (before.length) lines.push(`0. (before the first step) → ${causedText(before, origin)}`);
  steps.forEach((s, i) => {
    const c = caused[i].length ? ` → ${causedText(caused[i], origin)}` : "";
    lines.push(`${i + 1}. ${stepLine(s, origin)}${c}`);
  });
  if (!steps.length) lines.push("(no steps recorded)");
  else lines.push("Refs are from recording time; take a snapshot before acting on them.");
  return lines.join("\n");
}

/**
 * The in-page listener. Runs in the page's main world, top document only, and
 * buffers trusted user events; it calls nothing outside the page. The app
 * drains it (`drain()`, then `el(seq)` for each element to resolve its ref)
 * and stops it (`stop()`). A password field's value is never put in the
 * buffer. The page can read or forge what's buffered: a recording is page
 * data, like console text.
 */
export const RECORDER_SCRIPT = `(() => {
  const K = Symbol.for("zynlex.recorder");
  if (window !== window.top || window[K]) return;
  const buf = [], els = new Map(), secret = new WeakSet();
  let seq = 0, lastEnter = 0, lastClick = null;
  const KEYS = ${JSON.stringify(RECORDED_KEYS)}, EDITING = ${JSON.stringify(EDITING_KEYS)};
  const SKIP_INPUT = /^(checkbox|radio|file|range|color|submit|button|reset|image|hidden)$/;
  const isSecret = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (el.type === "password" || /password|one-time-code|cc-number|cc-csc/.test(ac)) secret.add(el);
    return secret.has(el);
  };
  const label = (el) => {
    const t = el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].textContent)
      || el.getAttribute("placeholder") || el.getAttribute("title") || (el.isContentEditable ? "" : el.textContent) || "";
    return t.trim().replace(/\\s+/g, " ").slice(0, 60);
  };
  const push = (kind, el, extra) => {
    if (buf.length >= 500) return;
    const s = ++seq;
    els.set(s, el);
    const tag = el.tagName.toLowerCase() + (el.tagName === "INPUT" ? ":" + el.type : "");
    buf.push(Object.assign({ seq: s, t: Date.now(), kind, tag, label: label(el) }, extra));
  };
  const target = (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    return t && t.nodeType === 1 ? t : t && t.parentElement;
  };
  const CLICKABLE = "a,button,input,select,textarea,label,summary,option,[role],[onclick],[tabindex],[contenteditable]";
  const field = (el) => el.closest("input,textarea,select,[contenteditable]");
  const on = {
    click(e) {
      const t = target(e);
      // Enter on a field or button clicks it too; the press is already a step.
      if (!e.isTrusted || !t || (e.detail === 0 && Date.now() - lastEnter < 100)) return;
      const el = t.closest(CLICKABLE) || t;
      if (el.tagName === "SELECT" || el.tagName === "OPTION") return;
      // Clicking a label clicks its control as well: one step.
      const viaLabel = lastClick && Date.now() - lastClick.t < 100 && el.labels && Array.from(el.labels).includes(lastClick.el);
      lastClick = { el, t: Date.now() };
      if (!viaLabel) push("click", el);
    },
    input(e) {
      const t = target(e);
      const el = t && field(t);
      if (!e.isTrusted || !el || el.tagName === "SELECT" || SKIP_INPUT.test(el.type || "")) return;
      if (isSecret(el)) push("type", el, { sensitive: true });
      else push("type", el, { value: el.isContentEditable ? el.innerText : String(el.value) });
    },
    change(e) {
      const t = target(e);
      if (!e.isTrusted || !t) return;
      if (t.tagName === "SELECT") {
        push("select", t, { value: Array.from(t.selectedOptions).map((o) => o.label.trim()).join(", ") });
      } else if (t.tagName === "INPUT" && t.type === "file") {
        push("upload", t, { value: Array.from(t.files || []).map((f) => f.name).join(", ") });
      }
    },
    keydown(e) {
      const t = target(e);
      if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || !KEYS.includes(e.key)) return;
      const el = t && t !== document.body && t !== document.documentElement ? t : null;
      if (e.key === "Enter") lastEnter = Date.now();
      // Editing keys inside a text field are part of its final value.
      const text = el && field(el) && el.tagName !== "SELECT";
      if (text && EDITING.includes(e.key)) return;
      if (el) isSecret(el);
      if (el) push("press", el, { key: e.key });
      else { const s = ++seq; buf.push({ seq: s, t: Date.now(), kind: "press", key: e.key, tag: "", label: "" }); }
    },
    focusin(e) { const t = target(e); if (t) isSecret(t); },
  };
  for (const k in on) document.addEventListener(k, on[k], true);
  Object.defineProperty(window, K, { configurable: true, value: {
    drain() { return buf.splice(0, buf.length); },
    el(s) { const el = els.get(s); els.delete(s); return el; },
    stop() { for (const k in on) document.removeEventListener(k, on[k], true); delete window[K]; },
  } });
})()`;
