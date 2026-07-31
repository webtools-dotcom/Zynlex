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
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^127\.0\.0\.1/.test(s)) return `http://${s}`;
  if (/^[\w-]+\.[\w.-]+(\/.*)?$/.test(s) && !s.includes(" ")) return `https://${s}`;
  return searchUrl(s, searchEngine);
}
