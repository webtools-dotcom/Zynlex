import { createWorkspaceRulesStore } from "@/stores/workspaceRules";
import type { NetworkLogEntry } from "@/stores/network";

/** Mirrors `MockRule` in src-tauri/src/commands/browser/net.rs. */
export interface MockRule {
  id: string;
  /** Required — Rust ignores blank and bare-`*` patterns (they'd replace the page itself). */
  pattern: string;
  /** Empty = any method. */
  method: string;
  status: number;
  /** Empty = application/json. */
  contentType: string;
  body: string;
  delayMs: number;
  enabled: boolean;
}

export const useMocksStore = createWorkspaceRulesStore<MockRule>("zynlex-mock-rules");

/**
 * A mock that replays a captured response: same URL (scheme-less, so a prefix
 * match on exactly this request), method, status, content type and body. The
 * user edits from there.
 */
export function mockRuleFromEntry(entry: NetworkLogEntry): MockRule {
  const contentType = entry.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  return {
    id: crypto.randomUUID(),
    pattern: entry.url.replace(/^[a-z]+:\/\//i, ""),
    method: entry.method,
    status: entry.statusCode || 200,
    contentType,
    body: entry.body,
    delayMs: 0,
    enabled: true,
  };
}
