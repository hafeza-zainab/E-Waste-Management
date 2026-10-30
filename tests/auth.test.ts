import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
const opts = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.get(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o: Record<string, unknown> = {}) => {
      opts.set(n, o);
      if (v === "") jar.delete(n);
      else jar.set(n, v);
    },
    delete: (n: string) => jar.delete(n),
  }),
  headers: async () => new Headers(),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_MS, GUEST_TTL_MS } from "@/lib/auth/constants";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { safeNext } from "@/lib/auth/redirect";
import { isSameOrigin } from "@/lib/auth/csrf";
import { createSession, sessionCookieOptions, sha256, userForToken } from "@/lib/auth/sessions";
import { EmailSchema, LoginSchema, SignupSchema } from "@/lib/auth/validation";
import { purgeExpiredGuests } from "@/lib/auth/accounts";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { wipeAll } from "./helpers/wipe";
import { proxy } from "@/proxy";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as guest } from "@/app/api/auth/guest/route";

const req = (path: string, body: unknown, ip = "1.1.1.1") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) });
const owner = (over: Record<string, unknown> = {}) => ({ role: "owner", name: "Ada Lovelace", email: "ada@example.com", password: "correct horse battery", ...over });
const tech = (over: Record<string, unknown> = {}) => ({ role: "technician", name: "Tess Tech", email: "tess@example.com", password: "another long passphrase", skills: ["phone", "tablet"], area: "Westside", payoutEmail: "tess-payout@example.com", ...over });

beforeEach(async () => {
  jar.clear();
  opts.clear();
  resetRateLimits();
  vi.unstubAllEnvs();
  await wipeAll();
});

describe("passwords", () => {
  it("hashes with a per-user salt and parameters stored in the hash, and verifies", async () => {
    const a = await hashPassword("a long enough password");
    const b = await hashPassword("a long enough password");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("a long enough password", a)).toBe(true);
    expect(await verifyPassword("a long enough passworD", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });
  it("never verifies against a missing, unusable or malformed hash (and still does the work)", async () => {
    expect(await verifyPassword("x".repeat(12), null)).toBe(false);
    expect(await verifyPassword("x".repeat(12), "!")).toBe(false);
    expect(await verifyPassword("x".repeat(12), "scrypt$999999999$8$1$AAAA$AAAA")).toBe(false); // refuses absurd cost parameters
    expect(await verifyPassword("x".repeat(12), "plain-text")).toBe(false);
  });
  it("enforces 10 to 128 characters and rejects the email or name as password", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("x".repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem("x".repeat(128))).toBeNull();
    expect(passwordProblem("ada@example.com", { email: "Ada@Example.com" })).toMatch(/email/);
    expect(passwordProblem("Ada Lovelace", { name: "ada lovelace" })).toMatch(/name/);
  });
});

describe("validation", () => {
  it("normalises emails: trims, lower-cases, accepts plus tags", () => {
    expect(EmailSchema.parse("  Ada+Test@Example.COM  ")).toBe("ada+test@example.com");
  });
  it("rejects bad, unicode and very long emails with a friendly message", () => {
    for (const bad of ["", "no-at", "a@b", "ünï@example.com", "ada@exämple.com", `${"a".repeat(250)}@example.com`, "a b@example.com"]) expect(EmailSchema.safeParse(bad).success, bad).toBe(false);
  });
  it("accepts unicode names, collapses spaces, rejects control characters and very long input", () => {
    const ok = SignupSchema.parse(owner({ name: "  Zoë   Ångström  " }));
    expect(ok.name).toBe("Zoë Ångström");
    expect(SignupSchema.safeParse(owner({ name: "x".repeat(81) })).success).toBe(false);
    expect(SignupSchema.safeParse(owner({ name: "bad\u0007name" })).success).toBe(false);
    expect(SignupSchema.safeParse(owner({ password: "p".repeat(5000) })).success).toBe(false);
    expect(LoginSchema.safeParse({ email: "a@example.com", password: "p".repeat(5000) }).success).toBe(false);
  });
  it("technician signup needs skills, area and a payout email; owner signup does not", () => {
    expect(SignupSchema.safeParse(tech({ skills: [] })).success).toBe(false);
    expect(SignupSchema.safeParse(tech({ skills: ["spaceship"] })).success).toBe(false);
    expect(SignupSchema.safeParse(tech({ payoutEmail: "nope" })).success).toBe(false);
    expect(SignupSchema.safeParse(tech({ area: "" })).success).toBe(false);
    expect(SignupSchema.safeParse(owner()).success).toBe(true);
    expect(SignupSchema.safeParse(owner({ role: "admin" })).success).toBe(false);
  });
  it("rejects a password equal to the email or the name", () => {
    expect(SignupSchema.safeParse(owner({ password: "ada@example.com", email: "ada@example.com" })).success).toBe(false);
    expect(SignupSchema.safeParse(owner({ password: "Ada Lovelace" })).success).toBe(false);
  });
});

describe("?next= open-redirect protection", () => {
  it("allows only same-origin relative paths", () => {
    expect(safeNext("/owner/new?scenario=dead-tv", "/x")).toBe("/owner/new?scenario=dead-tv");
    expect(safeNext("/jobs/abc", "/x")).toBe("/jobs/abc");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "/%2F%2Fevil.com", "/%5Cevil.com", "evil.com", "", "/login", "/api/auth/logout", "/ok\r\nSet-Cookie: x=1", `/${"a".repeat(600)}`, "http:/evil.com", " /owner"])
      expect(safeNext(bad, "/fallback"), bad).toBe("/fallback");
    expect(safeNext(undefined, "/fallback")).toBe("/fallback");
    expect(safeNext(["/a"], "/fallback")).toBe("/fallback");
  });
  it("login honours a safe next and ignores an evil one", async () => {
    await signup(req("/api/auth/signup", owner()));
    jar.clear();
    const good = await (await login(req("/api/auth/login", { email: "ada@example.com", password: "correct horse battery", next: "/agent" }))).json();
    expect(good.redirect).toBe("/agent");
    jar.clear();
    const evil = await (await login(req("/api/auth/login", { email: "ada@example.com", password: "correct horse battery", next: "https://evil.com" }))).json();
    expect(evil.redirect).toBe("/owner");
  });
});

describe("CSRF origin checks", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("same origin passes; cross-site, missing and null origins fail; GET is never checked", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://reloop.example.com" };
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", origin: "https://reloop.example.com" }), env)).toBe(true);
    expect(isSameOrigin("POST", h({ host: "internal:3000", origin: "https://reloop.example.com" }), env)).toBe(true);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", referer: "https://reloop.example.com/signup" }), env)).toBe(true);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", origin: "https://evil.com" }), env)).toBe(false);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", origin: "https://reloop.example.com.evil.com" }), env)).toBe(false);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", referer: "https://evil.com/x" }), env)).toBe(false);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com", origin: "null" }), env)).toBe(false);
    expect(isSameOrigin("POST", h({ host: "reloop.example.com" }), env)).toBe(false);
    expect(isSameOrigin("DELETE", h({ host: "reloop.example.com", origin: "https://evil.com" }), env)).toBe(false);
    expect(isSameOrigin("GET", h({ host: "reloop.example.com" }), env)).toBe(true);
  });
  it("the proxy blocks a cross-site POST to any /api route, lets the PayPal webhook through, and passes same-origin", async () => {
    const mk = (path: string, origin?: string) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", ...(origin ? { origin } : {}) } });
    expect((await proxy(mk("/api/auth/login", "https://evil.com"))).status).toBe(403);
    expect((await proxy(mk("/api/agent/run"))).status).toBe(403);
    expect((await proxy(mk("/api/tour/start", "https://evil.com"))).status).toBe(403);
    expect((await proxy(mk("/api/paypal/webhook"))).status).toBe(200);
    expect((await proxy(mk("/api/auth/login", "http://localhost"))).status).toBe(200);
  });
  it("the proxy refreshes the session cookie on page loads, but not during a tour", async () => {
    const tok = "A".repeat(43);
    const page = (cookie: string) => new NextRequest("http://localhost/owner", { headers: { cookie } });
    expect((await proxy(page(`${SESSION_COOKIE}=${tok}`))).cookies.get(SESSION_COOKIE)?.value).toBe(tok);
    expect((await proxy(page(`${SESSION_COOKIE}=${tok}; reloop_tour_on=1`))).cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("sessions", () => {
  it("stores only the SHA-256 of the token", async () => {
    const u = await db.user.create({ data: { email: "s@x.test", name: "S", passwordHash: "!", role: "owner" } });
    const token = await createSession(u.id);
    const row = await db.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toContain(token);
    expect(token).toHaveLength(43); // 32 random bytes, base64url
  });
  it("expires, deletes the expired row, and slides forward when used later", async () => {
    const u = await db.user.create({ data: { email: "s@x.test", name: "S", passwordHash: "!", role: "owner" } });
    const t0 = Date.now();
    const token = await createSession(u.id, t0);
    expect((await userForToken(token, t0 + 1000))?.id).toBe(u.id);
    const before = (await db.session.findFirstOrThrow({ where: { userId: u.id } })).expiresAt.getTime();
    const later = t0 + 2 * 60 * 60 * 1000;
    expect((await userForToken(token, later))?.id).toBe(u.id);
    expect((await db.session.findFirstOrThrow({ where: { userId: u.id } })).expiresAt.getTime()).toBeGreaterThan(before);
    expect(await userForToken(token, later + SESSION_TTL_MS + 5000)).toBeNull();
    expect(await db.session.count()).toBe(0);
    expect(await userForToken("not-a-token")).toBeNull();
    expect(await userForToken(undefined)).toBeNull();
  });
  it("cookie flags: httpOnly, SameSite=Lax, path /, 7 days, Secure in production only", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 7 * 24 * 3600 });
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions().secure).toBe(false);
  });
  it("signup sets the cookie with those flags, and login rotates away the old session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await signup(req("/api/auth/signup", owner()));
    expect(res.status).toBe(200);
    expect(opts.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    const first = jar.get(SESSION_COOKIE)!;
    const res2 = await login(req("/api/auth/login", { email: "ada@example.com", password: "correct horse battery" }));
    expect(res2.status).toBe(200);
    const second = jar.get(SESSION_COOKIE)!;
    expect(second).not.toBe(first);
    expect(await db.session.count({ where: { tokenHash: sha256(first) } })).toBe(0);
    expect(await db.session.count({ where: { tokenHash: sha256(second) } })).toBe(1);
  });
  it("logout deletes the row and the cookie; with ?all=1 it ends every session", async () => {
    await signup(req("/api/auth/signup", owner()));
    const user = await db.user.findFirstOrThrow();
    await createSession(user.id); // a second device
    expect(await db.session.count()).toBe(2);
    const res = await logout(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { accept: "application/json" } }));
    expect(res.status).toBe(200);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.session.count()).toBe(1);
    await login(req("/api/auth/login", { email: "ada@example.com", password: "correct horse battery" }));
    await logout(new Request("http://localhost/api/auth/logout?all=1", { method: "POST", headers: { accept: "application/json" } }));
    expect(await db.session.count()).toBe(0);
  });
});

describe("login and signup routes", () => {
  it("login failures are generic: same status and message for a wrong password, an unknown email and a bad email", async () => {
    await signup(req("/api/auth/signup", owner()));
    jar.clear();
    const bodies = [];
    for (const b of [{ email: "ada@example.com", password: "wrong password!!" }, { email: "nobody@example.com", password: "wrong password!!" }, { email: "not-an-email", password: "x" }]) {
      const r = await login(req("/api/auth/login", b));
      expect(r.status).toBe(401);
      bodies.push(await r.json());
    }
    expect(new Set(bodies.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(bodies[0].error).toBe("Email or password is incorrect.");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
  it("login is rate limited: 10 per 15 minutes per IP, and separately per email", async () => {
    const attempt = (ip: string, email = "ada@example.com") => login(req("/api/auth/login", { email, password: "wrong password!!" }, ip));
    for (let i = 0; i < 10; i++) expect((await attempt("9.9.9.9", `u${i}@example.com`)).status).toBe(401);
    const blocked = await attempt("9.9.9.9", "fresh@example.com");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    resetRateLimits();
    for (let i = 0; i < 10; i++) expect((await attempt(`8.8.8.${i}`)).status).toBe(401); // same email, many IPs
    expect((await attempt("8.8.8.99")).status).toBe(429);
  });
  it("signup is rate limited: 5 per hour per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await signup(req("/api/auth/signup", owner({ email: `n${i}@example.com` }), "7.7.7.7"))).status).toBe(200);
    expect((await signup(req("/api/auth/signup", owner({ email: "n6@example.com" }), "7.7.7.7"))).status).toBe(429);
  });
  it("signup returns inline field errors, and says when the email is taken", async () => {
    const bad = await signup(req("/api/auth/signup", owner({ email: "nope", password: "short" })));
    expect(bad.status).toBe(400);
    const j = await bad.json();
    expect(j.fields.email).toBeTruthy();
    expect(j.fields.password).toMatch(/at least 10/);
    await signup(req("/api/auth/signup", owner()));
    const dup = await signup(req("/api/auth/signup", owner({ email: "  ADA@example.com " })));
    expect(dup.status).toBe(409);
  });
  it("owner signup creates the Owner profile; technician signup creates the Technician profile in the same transaction", async () => {
    await signup(req("/api/auth/signup", owner()));
    const o = await db.user.findUniqueOrThrow({ where: { email: "ada@example.com" }, include: { owner: true, technician: true } });
    expect(o.owner?.name).toBe("Ada Lovelace");
    expect(o.technician).toBeNull();
    jar.clear();
    const r = await signup(req("/api/auth/signup", tech()));
    expect((await r.json()).redirect).toBe("/technician");
    const t = await db.user.findUniqueOrThrow({ where: { email: "tess@example.com" }, include: { technician: true, owner: true } });
    expect(t.owner).toBeNull();
    expect(t.technician).toMatchObject({ skills: "phone,tablet", city: "Westside", paypalEmail: "tess-payout@example.com", name: "Tess Tech" });
  });
  it("a failure while creating the profile leaves no half-made user", async () => {
    await db.owner.create({ data: { name: "Squatter", email: "ada@example.com" } }); // makes the Owner insert collide
    const r = await signup(req("/api/auth/signup", owner()));
    expect(r.status).toBe(409);
    expect(await db.user.count()).toBe(0);
    expect(await db.session.count()).toBe(0);
  });
  it("never stores the password in the clear", async () => {
    await signup(req("/api/auth/signup", owner()));
    const u = await db.user.findFirstOrThrow();
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(u.passwordHash).not.toContain("correct horse");
  });
});

describe("guests", () => {
  it("Continue as guest creates a real isGuest user with an owner profile and a normal session", async () => {
    const r = await guest(req("/api/auth/guest", {}));
    expect((await r.json()).redirect).toBe("/owner");
    const g = await db.user.findFirstOrThrow({ where: { isGuest: true }, include: { owner: true } });
    expect(g.name).toMatch(/^Guest \d{4}$/);
    expect(g.owner).toBeTruthy();
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect((await userForToken(jar.get(SESSION_COOKIE)))?.id).toBe(g.id);
  });
  it("a guest cannot log in with a password", async () => {
    await guest(req("/api/auth/guest", {}));
    const g = await db.user.findFirstOrThrow({ where: { isGuest: true } });
    jar.clear();
    expect((await login(req("/api/auth/login", { email: g.email, password: "anything at all" }))).status).toBe(401);
  });
  it("guests older than 24 hours and everything they own are purged; fresh guests and real users are kept", async () => {
    await guest(req("/api/auth/guest", {}));
    await signup(req("/api/auth/signup", owner()));
    const old = await db.user.findFirstOrThrow({ where: { isGuest: true }, include: { owner: true } });
    await db.user.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - GUEST_TTL_MS - 60_000) } });
    const dev = await db.device.create({ data: { ownerId: old.owner!.id, type: "phone", brand: "A", model: "B", ageYears: 1, problem: "cracked screen here" } });
    await db.agentRun.create({ data: { goal: "g", mode: "scripted", ownerId: old.owner!.id, deviceId: dev.id } });
    resetRateLimits();
    await guest(req("/api/auth/guest", {}, "2.2.2.2")); // creating a guest purges the expired one
    expect(await db.user.count({ where: { id: old.id } })).toBe(0);
    expect(await db.owner.count({ where: { id: old.owner!.id } })).toBe(0);
    expect(await db.device.count({ where: { id: dev.id } })).toBe(0);
    expect(await db.agentRun.count()).toBe(0);
    expect(await db.session.count({ where: { userId: old.id } })).toBe(0);
    expect(await db.user.count({ where: { isGuest: true } })).toBe(1);
    expect(await db.user.count({ where: { email: "ada@example.com" } })).toBe(1);
    expect(await purgeExpiredGuests()).toBe(0);
  });
});
