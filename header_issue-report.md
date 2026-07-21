# Header Injection — Resolved (closed 2026-07-21)

Feature complete and verified end-to-end. Summary kept for history; investigation log removed.

**Root cause:** URL pattern matcher used `uri.contains(&rule.pattern)`, a plain substring
check. The panel's default pattern is `"*"`, and `"...".contains("*")` is always `false` — so
every rule made with the UI's own default silently never matched, and COM `SetHeader` was never
reached. `SetHeader` itself was never broken (a hardcoded-literal test proved it works).
Verification against `httpbin.org/headers` was a red herring — it returned `"headers": {}` for
every request regardless of interception, sending debugging toward disconnected-COM-object and
CDP theories that weren't the problem. Local echo servers were used for all verification from
then on.

**Fixes shipped:**
- `url_matches()` — case-insensitive glob (`*` wildcard), scheme-stripped and anchored so a
  pattern can't match a substring buried in a foreign origin's query string.
- `HEADER_RULES` keyed by `tabId` (not one global rule set) — closes a cross-workspace leak
  where an inactive workspace's still-alive background tabs could pick up another workspace's
  rules, since workspace switch only hides webviews rather than destroying them.
- Internal-scheme guard so rules never inject into Tauri's own IPC traffic.
- Inline value editing in the panel (token refresh no longer requires delete/recreate).
- Known limitation: WebSockets aren't covered (WebView2 doesn't fire `WebResourceRequested`
  for them — not fixable app-side). Documented in the panel's empty state.

Verified manually: rules apply live to open tabs without reload, toggle/delete work,
workspace isolation holds under a same-port cross-workspace test, persistence survives app
restart.
