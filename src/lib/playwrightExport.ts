/**
 * A recording (agentRecord.ts) as a Playwright test: the developer's steps
 * with Playwright's own locators, the workspace's active mocks and header
 * rules as `page.route` calls, and a check that the page threw nothing. What
 * ZYNLEX saw each step cause goes in as comments, not assertions: a recording
 * usually shows the bug, so the agent writes the `expect` for the fixed
 * behaviour. Pure; the `recording` tool feeds it.
 */
import { attribute, causedText, type Recording, type Target } from "@/lib/agentRecord";
import type { HeaderRule } from "@/stores/headers";
import type { MockRule } from "@/stores/mocks";

/** ARIA roles worth a getByRole; anything else falls back to its text. */
const ROLES = new Set([
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
  "gridcell",
  "cell",
  "row",
  "heading",
  "img",
]);

/** Header names whose values are credentials: read from the environment, never written to the file. */
const SECRET_HEADER = /authorization|cookie|token|secret|key|session|auth/i;

const q = (s: string) => JSON.stringify(s);

/**
 * Playwright's locator for a recorded element, or null when ZYNLEX had nothing
 * stable to go on. Test ids win (what Playwright's codegen prefers), then role
 * and name. Names from the accessibility tree are exact; ones the page script
 * read (ref null) may be clipped, so they aren't.
 */
// ponytail: role+name isn't checked for uniqueness; Playwright's strict mode reports duplicates when the test runs.
export function locatorFor(t: Target | null): string | null {
  if (!t) return null;
  if (t.testid) return `page.getByTestId(${q(t.testid)})`;
  const name = t.name.replace(/\s+/g, " ").trim();
  const exact = t.ref != null ? ", exact: true" : "";
  if (name && ROLES.has(t.role))
    return `page.getByRole(${q(t.role)}, { name: ${q(name)}${exact} })`;
  if (name) return `page.getByText(${q(name)}${t.ref != null ? ", { exact: true }" : ""})`;
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A ZYNLEX rule pattern as the regex literal Playwright routes on, with the
 * same meaning as `url_matches` in net.rs: case-insensitive, scheme ignored,
 * a prefix match without `*`, an anchored glob with it. Blank or bare `*`
 * matches everything.
 */
export function routeRegex(pattern: string): string {
  let p = pattern.trim();
  if (!p || /^\*+$/.test(p)) return "/.*/";
  const i = p.indexOf("://");
  if (i >= 0) p = p.slice(i + 3);
  const body = p.split("*").map(escapeRe).join(".*");
  const end = p.includes("*") && !p.endsWith("*") ? "$" : "";
  return `/^(?:[a-z][a-z0-9+.-]*:\\/\\/)?${body}${end}/i`;
}

function mockLines(m: MockRule): string[] {
  const out = [`  await page.route(${routeRegex(m.pattern)}, async (route) => {`];
  if (m.method)
    out.push(
      `    if (route.request().method() !== ${q(m.method.toUpperCase())}) return route.fallback();`,
    );
  if (m.delayMs > 0) out.push(`    await new Promise((r) => setTimeout(r, ${m.delayMs}));`);
  out.push(
    `    await route.fulfill({ status: ${m.status}, contentType: ${q(m.contentType || "application/json")}, body: ${q(m.body)} });`,
    "  });",
  );
  return out;
}

function headerLines(h: HeaderRule): string[] {
  const name = h.name.toLowerCase();
  const env = `ZYNLEX_HEADER_${h.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const value = SECRET_HEADER.test(h.name) ? `process.env.${env}!` : q(h.value);
  return [
    ...(SECRET_HEADER.test(h.name)
      ? [`  // ${h.name} is a credential: set ${env} to its value.`]
      : []),
    `  await page.route(${routeRegex(h.pattern)}, (route) =>`,
    `    route.fallback({ headers: { ...route.request().headers(), ${q(name)}: ${value} } }),`,
    "  );",
  ];
}

/** One step as a line of test code. */
function stepLine(s: Recording["steps"][number], n: number): string {
  if (s.action === "open") return `  await page.goto(${q(s.url ?? "")});`;
  if (s.action === "press" && !s.target) return `  await page.keyboard.press(${q(s.key ?? "")});`;
  const loc = locatorFor(s.target);
  if (!loc) {
    const what = s.target?.role ? ` (${s.target.role})` : "";
    return `  throw new Error(${q(`Step ${n}: ZYNLEX couldn't name the element${what}; write a locator for it.`)});`;
  }
  switch (s.action) {
    case "type":
      return s.secret
        ? `  await ${loc}.fill(process.env.TEST_PASSWORD!); // a password: ZYNLEX doesn't record it`
        : `  await ${loc}.fill(${q(s.value ?? "")});`;
    case "select":
      // ponytail: one option by label; a multi-select's labels arrive joined with ", ".
      return `  await ${loc}.selectOption({ label: ${q(s.value ?? "")} });`;
    case "press":
      return `  await ${loc}.press(${q(s.key ?? "")});`;
    case "upload": {
      const files = (s.value ?? "").split(", ").filter(Boolean).map(q).join(", ");
      return `  await ${loc}.setInputFiles([${files}]); // the developer's file names; point these at test files`;
    }
    default:
      return `  await ${loc}.click();`;
  }
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/** The recording as a Playwright test file (TypeScript, @playwright/test). */
export function toPlaywrightTest(
  rec: Recording,
  mocks: MockRule[] = [],
  headers: HeaderRule[] = [],
): string {
  const origin = originOf(rec.url);
  const { steps, caused, before } = attribute(rec);
  const title = rec.title.trim() || rec.url;
  const activeMocks = mocks.filter(
    (m) => m.enabled && m.pattern.trim() && !/^\*+$/.test(m.pattern.trim()),
  );
  const activeHeaders = headers.filter((h) => h.enabled && h.name.trim());
  const lines = [
    'import { expect, test } from "@playwright/test";',
    "",
    `// Recorded in ZYNLEX on ${rec.url}.`,
    `test(${q(`recorded: ${title}`)}, async ({ page }) => {`,
    "  const errors: string[] = [];",
    '  page.on("pageerror", (e) => errors.push(e.message));',
  ];
  if (activeMocks.length || activeHeaders.length) {
    lines.push("  // Mocks and header rules that were on in ZYNLEX.");
    // Playwright tries the route added last first; ZYNLEX uses the first match.
    for (const m of [...activeMocks].reverse()) lines.push(...mockLines(m));
    for (const h of activeHeaders) lines.push(...headerLines(h));
  }
  lines.push(`  await page.goto(${q(rec.url)});`);
  if (before.length)
    lines.push(`  // Before the first step ZYNLEX saw: ${causedText(before, origin)}`);
  steps.forEach((s, i) => {
    lines.push(stepLine(s, i + 1));
    if (caused[i].length) lines.push(`  // ZYNLEX saw: ${causedText(caused[i], origin)}`);
  });
  lines.push(
    "",
    "  // TODO: expect what should happen now, e.g.",
    '  // await expect(page.getByText("Order placed")).toBeVisible();',
    '  expect(errors, "uncaught errors in the page").toEqual([]);',
    "});",
    "",
  );
  return lines.join("\n");
}
