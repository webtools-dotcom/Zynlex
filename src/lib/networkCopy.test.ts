import { describe, expect, it } from "vitest";
import { entryToCurl, entryToFetch } from "./networkCopy";
import type { NetworkLogEntry } from "@/stores/network";

function makeEntry(overrides: Partial<NetworkLogEntry> = {}): NetworkLogEntry {
  return {
    id: "1",
    tabId: "tab-1",
    method: "GET",
    url: "https://example.com/api",
    statusCode: 200,
    reasonPhrase: "OK",
    resourceType: "fetch",
    durationMs: 42,
    contentLength: 100,
    referrer: "",
    headers: { "Content-Length": "100", "Content-Type": "application/json" },
    body: "",
    ...overrides,
  };
}

describe("entryToCurl", () => {
  it("builds a curl command, dropping Content-Length", () => {
    const curl = entryToCurl(makeEntry());
    expect(curl).toBe('curl -X GET "https://example.com/api" -H "Content-Type: application/json"');
  });

  it("includes the body when present and under the size cap", () => {
    const curl = entryToCurl(makeEntry({ body: '{"a":1}' }));
    expect(curl).toContain('-d "{\\"a\\":1}"');
  });

  it("also drops Cookie/Set-Cookie headers in compact mode", () => {
    const entry = makeEntry({
      headers: { "Content-Length": "100", Cookie: "session=abc", "X-Custom": "1" },
    });
    const compact = entryToCurl(entry, true);
    expect(compact).not.toContain("Cookie");
    expect(compact).toContain("X-Custom");

    const full = entryToCurl(entry, false);
    expect(full).toContain("Cookie");
  });
});

describe("entryToFetch", () => {
  it("builds a fetch() call, dropping Content-Length", () => {
    const fetchCall = entryToFetch(makeEntry());
    expect(fetchCall).toContain('fetch(');
    expect(fetchCall).toContain('"https://example.com/api"');
    expect(fetchCall).toContain('method: "GET"');
    expect(fetchCall).toContain('"Content-Type": "application/json"');
    expect(fetchCall).not.toContain("Content-Length");
  });

  it("pretty-prints a JSON body", () => {
    const fetchCall = entryToFetch(makeEntry({ body: '{"a":1}' }));
    expect(fetchCall).toContain('body: {"a":1},');
  });
});
