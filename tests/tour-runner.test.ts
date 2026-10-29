import { describe, expect, it } from "vitest";
import { ChapterSkip, TourAbort, TourRunner } from "@/lib/tour/runner";
import { installPaypalGuard, isPaypalBound } from "@/lib/tour/paypal-client-guard";

/** A fake clock: sleep() just records how long the runner asked to wait. */
const fake = () => {
  const slept: number[] = [];
  let hook: (() => void) | null = null;
  const sleep = async (ms: number) => {
    slept.push(ms);
    hook?.();
  };
  return { slept, sleep, onSleep: (f: () => void) => (hook = f), total: () => slept.reduce((a, b) => a + b, 0) };
};

describe("TourRunner", () => {
  it("waits the requested time in 50 ms ticks", async () => {
    const c = fake();
    await new TourRunner(c.sleep).wait(200);
    expect(c.slept).toEqual([50, 50, 50, 50]);
  });
  it("speed shortens waits (2x halves, 1.5x is two thirds)", async () => {
    const a = fake();
    const r2 = new TourRunner(a.sleep);
    r2.setSpeed(2);
    await r2.wait(1000);
    expect(a.total()).toBe(500);
    const b = fake();
    const r15 = new TourRunner(b.sleep);
    r15.setSpeed(1.5);
    await r15.wait(900);
    expect(Math.round(b.total())).toBe(600);
  });
  it("abort stops a wait within one tick", async () => {
    const c = fake();
    const r = new TourRunner(c.sleep);
    c.onSleep(() => {
      if (c.slept.length === 2) r.abort();
    });
    await expect(r.wait(10_000)).rejects.toBeInstanceOf(TourAbort);
    expect(c.slept.length).toBe(2);
  });
  it("pause holds time still until resume", async () => {
    const c = fake();
    const r = new TourRunner(c.sleep);
    r.pause();
    c.onSleep(() => {
      if (c.slept.length === 5) r.resume();
    });
    await r.wait(100);
    // 5 paused ticks that do not count, then the full 100 ms
    expect(c.slept.length).toBe(5 + 2);
    expect(c.slept.slice(5).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("abort works while paused", async () => {
    const c = fake();
    const r = new TourRunner(c.sleep);
    r.pause();
    c.onSleep(() => {
      if (c.slept.length === 3) r.abort();
    });
    await expect(r.wait(100)).rejects.toBeInstanceOf(TourAbort);
  });
  it("skipChapter interrupts the current wait once, then waits work again", async () => {
    const c = fake();
    const r = new TourRunner(c.sleep);
    c.onSleep(() => {
      if (c.slept.length === 1) r.skipChapter();
    });
    await expect(r.wait(1000)).rejects.toBeInstanceOf(ChapterSkip);
    c.onSleep(() => {});
    await expect(r.wait(100)).resolves.toBeUndefined();
  });
  it("until() finds a value, times out with null, and respects abort", async () => {
    const c = fake();
    const r = new TourRunner(c.sleep);
    let n = 0;
    expect(await r.until(() => (++n === 3 ? "ok" : null), 1000)).toBe("ok");
    expect(await r.until(() => null, 200)).toBeNull();
    r.abort();
    await expect(r.until(() => null, 200)).rejects.toBeInstanceOf(TourAbort);
  });
});

describe("browser PayPal guard", () => {
  it("recognises PayPal hosts and our /api/paypal routes only", () => {
    expect(isPaypalBound("https://www.paypal.com/sdk/js?client-id=x")).toBe(true);
    expect(isPaypalBound("https://api-m.sandbox.paypal.com/v2/checkout/orders")).toBe(true);
    expect(isPaypalBound("https://www.paypalobjects.com/x.png")).toBe(true);
    expect(isPaypalBound("/api/paypal/orders")).toBe(true);
    expect(isPaypalBound("/api/paypal/webhook")).toBe(true);
    expect(isPaypalBound("/api/tour/pay")).toBe(false);
    expect(isPaypalBound("/api/agent/approve")).toBe(false);
    expect(isPaypalBound("https://example.com/paypal.com")).toBe(false);
    expect(isPaypalBound("/tour/sample-proof.png")).toBe(false);
  });
  it("blocks PayPal-bound fetches while installed, passes others, and restores fetch after", async () => {
    const calls: string[] = [];
    const win = {
      fetch: (async (u: string) => {
        calls.push(String(u));
        return new Response("ok");
      }) as unknown as typeof fetch,
      location: { origin: "http://localhost" },
    };
    const original = win.fetch;
    const blocked: string[] = [];
    const uninstall = installPaypalGuard(win, (u) => blocked.push(u));
    const res = await win.fetch("/api/paypal/orders", { method: "POST" });
    expect(res.status).toBe(403);
    expect((await win.fetch("https://www.paypal.com/sdk/js")).status).toBe(403);
    expect((await win.fetch("/api/tour/pay")).status).toBe(200);
    expect(calls).toEqual(["/api/tour/pay"]);
    expect(blocked).toHaveLength(2);
    uninstall();
    expect(win.fetch).toBe(original);
  });
});
