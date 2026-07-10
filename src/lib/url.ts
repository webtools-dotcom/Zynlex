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
