import type { NetworkLogEntry } from "@/stores/network";

/** `compact` also drops Cookie/Set-Cookie headers, for pasting somewhere less trusted. */
export function entryToCurl(entry: NetworkLogEntry, compact = false): string {
  const skip = compact
    ? ["content-length", "cookie", "set-cookie"]
    : ["content-length"];
  const parts: string[] = [`curl -X ${entry.method} "${entry.url.replace(/"/g, '\\"')}"`];
  for (const [k, v] of Object.entries(entry.headers)) {
    if (!skip.includes(k.toLowerCase())) {
      parts.push(`-H "${k}: ${v.replace(/"/g, '\\"')}"`);
    }
  }
  if (entry.body && entry.body.length > 0 && entry.body.length < 10000) {
    const escaped = entry.body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    parts.push(`-d "${escaped}"`);
  }
  return parts.join(" ");
}

export function entryToFetch(entry: NetworkLogEntry): string {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry.headers)) {
    if (k.toLowerCase() !== "content-length") {
      headers[k] = v;
    }
  }
  const parts: string[] = ["fetch(", `  "${entry.url}",`, "  {"];
  parts.push(`    method: "${entry.method}",`);
  if (Object.keys(headers).length > 0) {
    parts.push("    headers: {");
    for (const [k, v] of Object.entries(headers)) {
      parts.push(`      "${k}": "${v.replace(/"/g, '\\"')}",`);
    }
    parts.push("    },");
  }
  if (entry.body && entry.body.length > 0 && entry.body.length < 10000) {
    const bodyStr = (() => {
      try { return JSON.stringify(JSON.parse(entry.body)); }
      catch { return JSON.stringify(entry.body); }
    })();
    parts.push(`    body: ${bodyStr},`);
  }
  parts.push("  }");
  parts.push(");");
  return parts.join("\n");
}
