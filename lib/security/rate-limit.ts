import { cookies, headers } from "next/headers";
import { log } from "@/lib/log";

/**
 * In-memory fixed-window limiter (fine for one instance; resets on restart and is per process).
 * Each policy limits per IP and, separately, per session cookie. Defaults are generous for a human
 * and tight for a script; the expensive routes (agent, diagnosis) are the tightest.
 */
export const POLICIES = {
  agent: { limit: 6, windowMs: 10 * 60_000 },
  diagnosis: { limit: 10, windowMs: 10 * 60_000 },
  upload: { limit: 15, windowMs: 10 * 60_000 },
  donation: { limit: 10, windowMs: 10 * 60_000 },
  paypalOrder: { limit: 20, windowMs: 10 * 60_000 },
  approval: { limit: 20, windowMs: 10 * 60_000 },
  action: { limit: 60, windowMs: 60_000 },
  clientError: { limit: 20, windowMs: 10 * 60_000 },
} as const;
export type PolicyName = keyof typeof POLICIES;

interface Bucket { count: number; resetAt: number }
const store = new Map<string, Bucket>();

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`You're going a bit fast. Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} and try again.`);
    this.name = "RateLimitError";
  }
}

/** Pure core, testable with a fake clock. Returns 0 when allowed, else seconds to wait. */
export function hit(key: string, policy: { limit: number; windowMs: number }, now = Date.now()): number {
  if (store.size > 5000) for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
  const b = store.get(key);
  if (!b || b.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + policy.windowMs });
    return 0;
  }
  if (b.count >= policy.limit) return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  b.count += 1;
  return 0;
}

export const resetRateLimits = () => store.clear();

export function clientIp(h: { get(name: string): string | null }): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "local").slice(0, 64);
}

function sessionFromCookieHeader(cookie: string | null): string | null {
  return cookie?.match(/(?:^|;\s*)reloop_sid=([A-Za-z0-9-]{8,64})/)?.[1] ?? null;
}

/** Seconds to wait if either the IP or the session bucket is exhausted, else 0. */
export function check(name: PolicyName, ip: string, sid: string | null, now = Date.now()): number {
  const p = POLICIES[name];
  const waits = [hit(`${name}:ip:${ip}`, p, now), sid ? hit(`${name}:sid:${sid}`, p, now) : 0];
  return Math.max(...waits);
}

/** For route handlers: returns a ready 429 Response, or null when allowed. */
export function rateLimitResponse(req: Request, name: PolicyName): Response | null {
  const wait = check(name, clientIp(req.headers), sessionFromCookieHeader(req.headers.get("cookie")));
  if (!wait) return null;
  log.warn("rate_limited", { policy: name });
  return Response.json({ error: new RateLimitError(wait).message, retryAfter: wait }, { status: 429, headers: { "Retry-After": String(wait) } });
}

/** For server actions: throws RateLimitError (callers show its friendly message). */
export async function assertRate(name: PolicyName): Promise<void> {
  const h = await headers();
  const sid = (await cookies()).get("reloop_sid")?.value ?? null;
  const wait = check(name, clientIp(h), sid && /^[A-Za-z0-9-]{8,64}$/.test(sid) ? sid : null);
  if (wait) {
    log.warn("rate_limited", { policy: name });
    throw new RateLimitError(wait);
  }
}

/** Rejects oversized bodies early using Content-Length (multipart uploads are additionally capped per file). */
export function bodyTooLarge(req: Request, maxBytes: number): Response | null {
  const len = Number(req.headers.get("content-length") ?? 0);
  return len > maxBytes ? Response.json({ error: "That request is too large." }, { status: 413 }) : null;
}
