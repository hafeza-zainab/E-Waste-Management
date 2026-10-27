import { afterEach, describe, expect, it, vi } from "vitest";
import { POLICIES, check, clientIp, hit, rateLimitResponse, resetRateLimits } from "@/lib/security/rate-limit";
import { aiCallsToday, aiCapReached, isDemoMode, recordAiCall, resetAiUsage } from "@/lib/ai/config";
import { evaluateStartup } from "@/lib/security/startup";
import { scrub } from "@/lib/log";
import nextConfig from "@/next.config";

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimits();
  resetAiUsage();
});

describe("rate limiting", () => {
  it("allows the limit, then blocks until the window passes", () => {
    const p = { limit: 3, windowMs: 1000 };
    expect([hit("k", p, 0), hit("k", p, 1), hit("k", p, 2)]).toEqual([0, 0, 0]);
    expect(hit("k", p, 3)).toBe(1);
    expect(hit("k", p, 999)).toBe(1);
    expect(hit("k", p, 1000)).toBe(0); // new window
  });
  it("limits per IP and per session independently", () => {
    const n = POLICIES.agent.limit;
    for (let i = 0; i < n; i++) expect(check("agent", "1.1.1.1", "sid-aaaa1111", 0)).toBe(0);
    expect(check("agent", "1.1.1.1", "sid-bbbb2222", 0)).toBeGreaterThan(0); // IP exhausted
    expect(check("agent", "2.2.2.2", "sid-aaaa1111", 0)).toBeGreaterThan(0); // session exhausted
    expect(check("agent", "2.2.2.2", "sid-cccc3333", 0)).toBe(0);
  });
  it("returns a friendly 429 with Retry-After", async () => {
    const req = () => new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    for (let i = 0; i < POLICIES.agent.limit; i++) expect(rateLimitResponse(req(), "agent")).toBeNull();
    const res = rateLimitResponse(req(), "agent")!;
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/wait/i);
    expect(clientIp(req().headers)).toBe("9.9.9.9");
  });
});

describe("daily live-AI cap", () => {
  it("falls back to scripted demo mode once the cap is used up", () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_DAILY_CALL_CAP", "2");
    expect(isDemoMode()).toBe(false);
    recordAiCall();
    expect(isDemoMode()).toBe(false);
    recordAiCall();
    expect(aiCallsToday()).toBe(2);
    expect(aiCapReached()).toBe(true);
    expect(isDemoMode()).toBe(true);
  });
  it("a cap of 0 means always scripted", () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_DAILY_CALL_CAP", "0");
    expect(isDemoMode()).toBe(true);
  });
});

describe("startup self-check", () => {
  it("refuses simulated approval in production and reports modes without secrets", () => {
    const env = { NODE_ENV: "production", PAYPAL_SIMULATE_APPROVAL: "true", PAYPAL_CLIENT_ID: "cid-SECRET-123", PAYPAL_CLIENT_SECRET: "shh-SECRET-456", DEMO_ACTIONS: "true", ANTHROPIC_API_KEY: "sk-ant-SECRET-789", DEMO_MODE: "false" };
    const r = evaluateStartup(env);
    expect(r.modes).toMatchObject({ env: "production", paypal: "sandbox", ai: "live", demoActions: true, simulatedApproval: false });
    expect(r.forced).toEqual({ PAYPAL_SIMULATE_APPROVAL: "false" });
    expect(r.warnings.join(" ")).toMatch(/ignored because NODE_ENV=production/);
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
  });
  it("allows the dev shortcut outside production and warns about missing production config", () => {
    expect(evaluateStartup({ NODE_ENV: "development", PAYPAL_SIMULATE_APPROVAL: "true" }).modes.simulatedApproval).toBe(true);
    const w = evaluateStartup({ NODE_ENV: "production" }).warnings.join(" ");
    expect(w).toMatch(/credentials are missing/);
    expect(w).toMatch(/WEBHOOK_ID/);
    expect(evaluateStartup({ NODE_ENV: "production" }).modes.donations).toBe("unavailable");
  });
});

describe("logging", () => {
  it("drops secret-looking keys, scrubs emails and long tokens, keeps PayPal debug ids", () => {
    const out = scrub({ debug_id: "abc123def", token: "x", clientSecret: "y", authorization: "Bearer z", note: "contact jane.doe@example.com now", blob: "A".repeat(60), status: 502 }) as Record<string, unknown>;
    expect(out).toEqual({ debug_id: "abc123def", note: "contact [email] now", blob: "[redacted]", status: 502 });
  });
});

describe("security headers", () => {
  it("sends a CSP that allows PayPal and forbids framing, plus the standard hardening headers", async () => {
    const rules = await nextConfig.headers!();
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toMatch(/script-src[^;]*https:\/\/www\.sandbox\.paypal\.com/);
    expect(h["Content-Security-Policy"]).toMatch(/frame-src[^;]*https:\/\/www\.sandbox\.paypal\.com/);
    expect(h["Content-Security-Policy"]).toMatch(/connect-src[^;]*paypal\.com/);
    expect(h["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(h["X-Frame-Options"]).toBe("DENY");
  });
});
