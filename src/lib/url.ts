/** Scheme + host + port, or `fallback` if `url` doesn't parse. */
export function originOf(url: string, fallback = ""): string {
  try {
    return new URL(url).origin;
  } catch {
    return fallback;
  }
}

/** Hostname only (no port), or `fallback` if `url` doesn't parse. */
export function hostOf(url: string, fallback = ""): string {
  try {
    return new URL(url).hostname;
  } catch {
    return fallback;
  }
}

/** Host (with port, if any) minus scheme and "www." — a placeholder title
 * shown before the real page title loads. Never throws: unlike `hostOf`,
 * this has to tolerate not-yet-resolved or malformed strings. */
export function titleFromUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
}

/**
 * Full query templates, not just hostnames — the results path and query
 * parameter differ per engine, and getting either wrong silently returns a
 * page with no results (DuckDuckGo 302s `/search?q=x` to `?q=search&q=x`,
 * Yahoo takes `p=` rather than `q=`). `%s` is the URL-encoded query.
 *
 * Ordered as rendered in Settings.
 */
export const SEARCH_ENGINES = [
  { id: "google", label: "Google", template: "https://www.google.com/search?q=%s" },
  { id: "bing", label: "Bing", template: "https://www.bing.com/search?q=%s" },
  { id: "duckduckgo", label: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
  { id: "brave", label: "Brave", template: "https://search.brave.com/search?q=%s" },
  { id: "yahoo", label: "Yahoo", template: "https://search.yahoo.com/search?p=%s" },
  { id: "qwant", label: "Qwant", template: "https://www.qwant.com/?q=%s" },
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]["id"];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";

/** Build a search URL for `query`. Falls back to the default engine for an
 * unknown id — persisted settings can still name the removed "custom" engine. */
export function searchUrl(query: string, engine: string): string {
  const entry = SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0];
  return entry.template.replace("%s", encodeURIComponent(query));
}

export function resolveInput(raw: string, searchEngine: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(s)) return `http://${s}`;
  // Bare IPv4, with optional port and path. This used to be a `127.0.0.1` prefix
  // test; it has to be a branch of its own now, because the hostname rule below
  // requires a letters-only TLD and would otherwise send `192.168.1.50:3000` to
  // the search engine. http, like localhost — these are not TLS hosts in practice.
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(s)) return `http://${s}`;
  // Require a real TLD — at least two letters, not digits — so `1.5` and `3.14`
  // are searches rather than navigations. The tail allows `?` and `#` as well as
  // `/`, so `example.com?q=1` is recognised as a URL instead of being searched for.
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s) && !s.includes(" "))
    return `https://${s}`;
  return searchUrl(s, searchEngine);
}
