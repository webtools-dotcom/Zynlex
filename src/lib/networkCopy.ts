import type { NetworkLogEntry } from "@/stores/network";

export function entryToCurl(entry: NetworkLogEntry): string {
  const parts: string[] = [`curl -X ${entry.method} "${entry.url}"`];
  for (const [k, v] of Object.entries(entry.headers)) {
    if (k.toLowerCase() !== "content-length") {
      parts.push(`-H "${k}: ${v.replace(/"/g, '\\"')}"`);
    }
  }
  if (entry.body && entry.body.length > 0 && entry.body.length < 10000) {
    const escaped = entry.body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    parts.push(`-d "${escaped}"`);
  }
  return parts.join(" ");
}

export function entryToCurlCompact(entry: NetworkLogEntry): string {
  const parts: string[] = [`curl -X ${entry.method} "${entry.url}"`];
  for (const [k, v] of Object.entries(entry.headers)) {
    if (!["content-length", "cookie", "set-cookie"].includes(k.toLowerCase())) {
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
    parts.push(`    body: ${JSON.stringify(entry.body)},`);
  }
  parts.push("  }");
  parts.push(");");
  return parts.join("\n");
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
