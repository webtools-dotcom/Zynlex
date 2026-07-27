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

export function resolveInput(raw: string, searchEngine: string, customSearchUrl: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^127\.0\.0\.1/.test(s))
    return `http://${s}`;
  if (/^[\w-]+\.[\w.-]+(\/.*)?$/.test(s) && !s.includes(" "))
    return `https://${s}`;
  if (searchEngine === "custom" && customSearchUrl) {
    return customSearchUrl.replace("%s", encodeURIComponent(s));
  }
  const engine = searchEngine === "duckduckgo" ? "duckduckgo.com"
    : searchEngine === "bing" ? "bing.com"
    : "google.com";
  return `https://${engine}/search?q=${encodeURIComponent(s)}`;
}
