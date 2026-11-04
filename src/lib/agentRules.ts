/**
 * The agent's `mock` tool (docs/agent-interface.md): canned responses and
 * request-header rules, added through the same stores the Mocks and Headers
 * panels use, so the developer sees every one and the bridge syncs them to
 * Rust the normal way. Rules are per workspace, like the panels: the target
 * tab's workspace, applying to every tab in it.
 *
 * Agent rules carry `agent: true`. The agent can only remove or clear its own,
 * they are never persisted, and they are dropped when the last agent
 * disconnects (`dropAgentRules`).
 */
import { type HeaderRule, useHeadersStore } from "@/stores/headers";
import { type MockRule, useMocksStore } from "@/stores/mocks";
import { useWorkspacesStore } from "@/stores/workspaces";
import type { Tab } from "@/types";

type Args = Record<string, unknown>;

const MAX_DELAY = 60_000;

/** Short enough to type; the prefix is matched, so collisions just ask for more characters. */
const shortRuleId = (id: string) => id.slice(0, 8);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Blank and bare `*` would match everything; Rust refuses those for mocks, and for headers they'd leak to every origin. */
function patternArg(args: Args): string {
  const p = str(args.url);
  if (!p || /^\*+$/.test(p)) {
    throw new Error(
      'Pass url: a URL prefix like "localhost:5173/api/orders", or a pattern with * such as "*/api/orders*". A catch-all is not allowed.',
    );
  }
  return p;
}

function mockLine(r: MockRule): string {
  const delay = r.delayMs > 0 ? ` +${r.delayMs}ms` : "";
  const flags = [r.agent ? "yours" : "developer's", ...(r.enabled ? [] : ["off"])].join(", ");
  return `  ${shortRuleId(r.id)} ${r.method || "ANY"} ${r.status}${delay} ${r.pattern} (${flags})`;
}

function headerLine(r: HeaderRule): string {
  const flags = [r.agent ? "yours" : "developer's", ...(r.enabled ? [] : ["off"])].join(", ");
  return `  ${shortRuleId(r.id)} ${r.pattern} → ${r.name}: ${r.value} (${flags})`;
}

function add(ws: string, wsName: string, args: Args): string {
  const pattern = patternArg(args);
  const header = str(args.header);
  if (header) {
    if (typeof args.value !== "string") throw new Error("A header rule needs value.");
    const rule: HeaderRule = {
      id: crypto.randomUUID(),
      pattern,
      name: header,
      value: args.value,
      enabled: true,
      agent: true,
    };
    useHeadersStore.getState().addRule(ws, rule);
    return `Added header rule ${shortRuleId(rule.id)}: requests to ${pattern} now send ${header}: ${args.value}, in every tab of workspace "${wsName}". Reload (check reload=true) or redo the action to see it.`;
  }
  const status = args.status == null ? 200 : Number(args.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(`status must be 100-599, got ${JSON.stringify(args.status)}.`);
  }
  const delayMs = Math.min(MAX_DELAY, Math.max(0, Math.round(Number(args.delay) || 0)));
  const rule: MockRule = {
    id: crypto.randomUUID(),
    pattern,
    method: str(args.method).toUpperCase(),
    status,
    contentType: str(args.contentType),
    body: typeof args.body === "string" ? args.body : "",
    delayMs,
    enabled: true,
    agent: true,
  };
  // First: the first enabled match wins, and the agent's mock should be the one served.
  useMocksStore.getState().addRule(ws, rule, true);
  return `Added mock ${shortRuleId(rule.id)}: ${rule.method || "any method"} ${pattern} now answers ${status}${delayMs ? ` after ${delayMs}ms` : ""}, in every tab of workspace "${wsName}", without reaching the server. Reload (check reload=true) or redo the action to see it; network marks served requests (mocked).`;
}

function list(ws: string, wsName: string): string {
  const mocks = useMocksStore.getState().rulesByWs[ws] ?? [];
  const headers = useHeadersStore.getState().rulesByWs[ws] ?? [];
  if (!mocks.length && !headers.length) return `No mocks or header rules in workspace "${wsName}".`;
  return [
    `Workspace "${wsName}":`,
    ...(mocks.length ? ["Mocks (first enabled match wins):", ...mocks.map(mockLine)] : []),
    ...(headers.length ? ["Header rules:", ...headers.map(headerLine)] : []),
  ].join("\n");
}

function remove(ws: string, args: Args): string {
  const id = str(args.id);
  if (!id) throw new Error("Pass id, from mock action=list.");
  const mocks = (useMocksStore.getState().rulesByWs[ws] ?? []).filter((r) => r.id.startsWith(id));
  const headers = (useHeadersStore.getState().rulesByWs[ws] ?? []).filter((r) =>
    r.id.startsWith(id),
  );
  const hits = [...mocks, ...headers];
  if (hits.length > 1) throw new Error(`Id "${id}" is ambiguous; use more characters.`);
  const hit = hits[0];
  if (!hit) throw new Error(`No rule "${id}" in this workspace. Call mock action=list.`);
  if (!hit.agent) {
    throw new Error(
      `Rule ${shortRuleId(hit.id)} is the developer's; you can only remove your own. Ask them to change it in the panel.`,
    );
  }
  if (mocks.length) useMocksStore.getState().removeRule(ws, hit.id);
  else useHeadersStore.getState().removeRule(ws, hit.id);
  return `Removed ${mocks.length ? "mock" : "header rule"} ${shortRuleId(hit.id)}.`;
}

/** Removes the agent's rules from `ws`, or from every workspace; returns how many. */
export function dropAgentRules(ws?: string): number {
  let n = 0;
  for (const store of [useMocksStore, useHeadersStore] as const) {
    const { rulesByWs, removeRule } = store.getState();
    for (const [id, rules] of Object.entries(rulesByWs)) {
      if (ws && id !== ws) continue;
      for (const r of rules) {
        if (r.agent) {
          removeRule(id, r.id);
          n++;
        }
      }
    }
  }
  return n;
}

export function mockTool(tab: Tab, args: Args): string {
  const ws = tab.workspaceId;
  const wsName = useWorkspacesStore.getState().workspaces[ws]?.name ?? ws;
  switch (args.action) {
    case "add":
      return add(ws, wsName, args);
    case "list":
      return list(ws, wsName);
    case "remove":
      return remove(ws, args);
    case "clear": {
      const n = dropAgentRules(ws);
      return n
        ? `Removed your ${n} rule${n === 1 ? "" : "s"} from workspace "${wsName}". The developer's are untouched.`
        : `You have no rules in workspace "${wsName}".`;
    }
    default:
      throw new Error(
        `Unknown action ${JSON.stringify(args.action)}. Use add, list, remove or clear.`,
      );
  }
}
