/**
 * The agent's view of a page: CDP's accessibility tree cut down to what can be
 * acted on, plus the headings and landmarks that say where it is. Each
 * actionable element gets a ref (`e` + its backendDOMNodeId), which survives
 * re-renders that keep the same DOM node. See docs/agent-interface.md.
 */

/** The parts of a CDP `Accessibility.AXNode` this reads. */
export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
]);
/** Shown for orientation, only when they contain something actionable (headings always). */
const LANDMARKS = new Set([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "form",
  "search",
  "complementary",
  "region",
  "dialog",
  "alertdialog",
]);
/** Validation and toast messages: an agent needs their text. */
const LIVE = new Set(["alert", "status"]);
const HAS_VALUE = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);
/** Not `focused`: it moves on every click and turns each diff into noise. */
const STATES = ["disabled", "checked", "selected", "required", "invalid", "pressed"];

/** Lines past this are cut, with a pointer to `within`. */
const MAX_LINES = 300;
const MAX_NAME = 80;

const str = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_NAME ? `${one.slice(0, MAX_NAME)}…` : one;
}

function describe(n: AXNode, role: string, text: string): string {
  const parts = [role];
  if (text) parts.push(`"${clip(text)}"`);
  if (INTERACTIVE.has(role) && n.backendDOMNodeId != null) parts.push(`[e${n.backendDOMNodeId}]`);
  if (HAS_VALUE.has(role)) parts.push(`value="${clip(str(n.value?.value))}"`);
  for (const p of n.properties ?? []) {
    const v = p.value.value;
    if (STATES.includes(p.name) && v !== false && v !== "false" && v != null) {
      parts.push(v === true || v === "true" ? p.name : `${p.name}=${str(v)}`);
    } else if (p.name === "expanded") {
      parts.push(v ? "expanded" : "collapsed");
    } else if (p.name === "level" && role === "heading") {
      parts[0] = `h${str(v)}`;
    }
  }
  return parts.join(" ");
}

/** `full` keeps every named node (static text included); `within` roots the walk at one element. */
export function formatSnapshot(
  nodes: AXNode[],
  { full = false, within }: { full?: boolean; within?: number } = {},
): string {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = within == null ? nodes[0] : nodes.find((n) => n.backendDOMNodeId === within);
  if (!root) return within == null ? "(empty page)" : `No element e${within} on the page.`;

  const textOf = (n: AXNode): string =>
    str(n.name?.value) ||
    (n.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is AXNode => !!c)
      .map(textOf)
      .join(" ");

  const walk = (n: AXNode, depth: number): string[] => {
    const role = str(n.role?.value);
    const name = str(n.name?.value);
    const kids = (d: number) =>
      (n.childIds ?? []).flatMap((id) => {
        const c = byId.get(id);
        return c ? walk(c, d) : [];
      });
    // ListMarker is a list's bullet or number: pure noise in a diff.
    if (n.ignored || role === "InlineTextBox" || role === "ListMarker") return kids(depth);

    const pad = "  ".repeat(depth);
    if (INTERACTIVE.has(role)) {
      // A button's or link's text is its name; walking in would repeat it.
      const inner = role === "button" || role === "link" ? [] : kids(depth + 1);
      return [pad + describe(n, role, name), ...inner];
    }
    if (LIVE.has(role)) {
      const text = name || textOf(n);
      return text ? [pad + describe(n, role, text)] : [];
    }
    if (role === "heading") return [pad + describe(n, role, name || textOf(n))];
    if (LANDMARKS.has(role)) {
      const inner = kids(depth + 1);
      return inner.length || full ? [pad + describe(n, role, name), ...inner] : [];
    }
    if (full && name && role !== "RootWebArea") {
      // Static text repeats its parent's name more often than not.
      return [
        pad + (role === "StaticText" ? `"${clip(name)}"` : describe(n, role, name)),
        ...kids(depth + 1),
      ];
    }
    return kids(depth);
  };

  const lines = walk(root, 0);
  if (!lines.length) return "(nothing actionable on the page)";
  if (lines.length <= MAX_LINES) return lines.join("\n");
  return [
    ...lines.slice(0, MAX_LINES),
    `… ${lines.length - MAX_LINES} more lines. Pass within=<ref of a landmark> to see one part.`,
  ].join("\n");
}

/**
 * What changed between two snapshots, as `-`/`+` lines (indentation dropped).
 * A multiset diff, not an ordered one: an agent needs what appeared and what
 * went away, not where. Empty when nothing changed.
 */
export function diffSnapshot(prev: string, next: string): string[] {
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = prev.split("\n").map((l) => l.trim());
  const b = next.split("\n").map((l) => l.trim());
  const left = count(b);
  const removed: string[] = [];
  for (const l of a) {
    const n = left.get(l) ?? 0;
    if (n) left.set(l, n - 1);
    else removed.push(`- ${l}`);
  }
  const right = count(a);
  const added: string[] = [];
  for (const l of b) {
    const n = right.get(l) ?? 0;
    if (n) right.set(l, n - 1);
    else added.push(`+ ${l}`);
  }
  return [...removed, ...added];
}
