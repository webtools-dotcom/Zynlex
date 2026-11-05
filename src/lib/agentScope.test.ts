import { beforeEach, describe, expect, it } from "vitest";
import { agentCanUse, grantedEnv } from "@/lib/agentScope";
import type { Environment } from "@/lib/envSwitch";
import { useEnvironmentsStore } from "@/stores/environments";

const env = (origin: string, more: Partial<Environment> = {}): Environment => ({
  id: origin,
  name: "staging",
  origin,
  isProd: false,
  ...more,
});

describe("agent scope", () => {
  beforeEach(() => {
    useEnvironmentsStore.setState({
      rulesByWs: {
        ws1: [
          env("https://staging.acme.com:443", { agent: true }),
          env("https://qa.acme.com:443"),
          env("https://acme.com:443", { agent: true, isProd: true }),
        ],
      },
    });
  });

  it("always covers localhost", () => {
    expect(agentCanUse("http://localhost:5173/x", "ws1")).toBe(true);
    expect(agentCanUse("http://app.localhost:3000/", "other")).toBe(true);
  });

  it("covers only environments ticked for agents, in the tab's own workspace", () => {
    expect(agentCanUse("https://staging.acme.com/orders?id=1", "ws1")).toBe(true);
    expect(agentCanUse("https://qa.acme.com/", "ws1")).toBe(false);
    expect(agentCanUse("https://staging.acme.com/", "ws2")).toBe(false);
    expect(agentCanUse("https://evil.example/", "ws1")).toBe(false);
  });

  it("never covers production, even if it was ticked before being marked prod", () => {
    expect(agentCanUse("https://acme.com/", "ws1")).toBe(false);
    expect(grantedEnv("https://acme.com/", useEnvironmentsStore.getState().rulesByWs.ws1)).toBe(
      null,
    );
  });

  it("matches the origin, not a lookalike host or another port", () => {
    expect(agentCanUse("https://staging.acme.com.evil.example/", "ws1")).toBe(false);
    expect(agentCanUse("https://staging.acme.com:8443/", "ws1")).toBe(false);
  });
});
