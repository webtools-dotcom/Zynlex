import { describe, expect, it } from "vitest";
import { type Environment, matchEnv, normalizeOrigin, translate } from "@/lib/envSwitch";

const env = (name: string, origin: string, isProd = false): Environment => ({
  id: name,
  name,
  origin: normalizeOrigin(origin) ?? "",
  isProd,
});

const envs = [
  env("local", "localhost:3000"),
  env("staging", "https://staging.acme.com"),
  env("prod", "https://acme.com", true),
];

describe("normalizeOrigin", () => {
  it("adds a scheme and makes the port explicit", () => {
    expect(normalizeOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeOrigin("https://acme.com/some/page?x=1")).toBe("https://acme.com:443");
    expect(normalizeOrigin("http://localhost")).toBe("http://localhost:80");
  });

  it("rejects what isn't an http(s) origin", () => {
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("ftp://files.acme.com")).toBeNull();
    expect(normalizeOrigin("http://")).toBeNull();
  });
});

describe("matchEnv", () => {
  it("matches by origin, ignoring path", () => {
    expect(matchEnv("https://staging.acme.com/orders/42", envs)?.name).toBe("staging");
    expect(matchEnv("http://localhost:3000/", envs)?.name).toBe("local");
  });

  it("treats a different port as a different server", () => {
    expect(matchEnv("http://localhost:3001/", envs)).toBeNull();
  });

  it("treats localhost and 127.0.0.1 as the same server", () => {
    expect(matchEnv("http://127.0.0.1:3000/x", envs)?.name).toBe("local");
  });

  it("does not match a lookalike host", () => {
    expect(matchEnv("https://acme.com.evil.io/", envs)).toBeNull();
    expect(matchEnv("https://www.acme.com/", envs)).toBeNull();
  });
});

describe("translate", () => {
  it("keeps path, query and hash", () => {
    expect(translate("http://localhost:3000/orders/42?tab=items#notes", envs[2])).toBe(
      "https://acme.com/orders/42?tab=items#notes",
    );
    expect(translate("https://acme.com/a", envs[0])).toBe("http://localhost:3000/a");
  });
});
