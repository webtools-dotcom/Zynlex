/**
 * Environments: the same app on several origins (local, staging, production).
 * Pure matching and URL translation for the environment switcher — the store
 * is src/stores/environments.ts, the UI the pill in Toolbar.tsx.
 */

export interface Environment {
  id: string;
  name: string;
  /** Normalized by normalizeOrigin: scheme://host:port, port always explicit. */
  origin: string;
  /** Marked in red, and switching into it takes a second click. */
  isProd: boolean;
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

/** localhost and 127.0.0.1 are the same server, though browsers treat them as different origins. */
function canonicalHost(host: string): string {
  return host === "127.0.0.1" || host === "[::1]" ? "localhost" : host;
}

/**
 * "localhost:3000" / "https://staging.acme.com/some/page" → "http://localhost:3000" /
 * "https://staging.acme.com:443". The port is always explicit, so localhost and
 * localhost:80 can never be mistaken for two environments. Null if unparseable.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!(u.protocol in DEFAULT_PORTS)) return null;
    return `${u.protocol}//${u.hostname}:${u.port || DEFAULT_PORTS[u.protocol]}`;
  } catch {
    return null;
  }
}

/** Origin as shown to people: default ports dropped again. */
export function displayOrigin(origin: string): string {
  return origin.replace(/:(80|443)$/, "");
}

function matchKey(origin: string): string {
  const u = new URL(origin);
  return `${u.protocol}//${canonicalHost(u.hostname)}:${u.port || DEFAULT_PORTS[u.protocol]}`;
}

/** The environment a URL is on, or null. */
export function matchEnv(url: string, envs: Environment[]): Environment | null {
  const origin = normalizeOrigin(url);
  if (!origin) return null;
  const key = matchKey(origin);
  return envs.find((e) => matchKey(e.origin) === key) ?? null;
}

/** The same page on another environment: path, query and hash carried over. */
export function translate(url: string, to: Environment): string {
  const u = new URL(url);
  return displayOrigin(to.origin) + u.pathname + u.search + u.hash;
}
