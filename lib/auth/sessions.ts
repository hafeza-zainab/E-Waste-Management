import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TOUCH_MS, SESSION_TTL_MS } from "./constants";

type Jar = Awaited<ReturnType<typeof cookies>>;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const sessionCookieOptions = (maxAgeMs = SESSION_TTL_MS) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

/** New session row for the user; returns the raw token (only its hash is stored). */
export async function createSession(userId: string, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(now + SESSION_TTL_MS), createdAt: new Date(now), lastSeen: new Date(now) } });
  return token;
}

/**
 * Login and signup call this: it deletes the session the browser arrived with (if any) and issues a fresh token,
 * so a token planted before login can never become an authenticated one (session fixation).
 */
export async function rotateSession(jar: Jar, userId: string) {
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old && TOKEN_RE.test(old)) await db.session.deleteMany({ where: { tokenHash: sha256(old) } });
  const token = await createSession(userId);
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

export async function destroySession(jar: Jar) {
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old && TOKEN_RE.test(old)) await db.session.deleteMany({ where: { tokenHash: sha256(old) } });
  jar.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

/** Deletes every session of a user ("log out everywhere"). */
export const destroyAllSessions = (userId: string) => db.session.deleteMany({ where: { userId } });

/** The logged-in user for a raw cookie token, or null. Expired sessions are deleted; live ones slide forward. */
export async function userForToken(token: string | undefined | null, now = Date.now()) {
  if (!token || !TOKEN_RE.test(token)) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { owner: true, technician: true } } } });
  if (!s) return null;
  if (s.expiresAt.getTime() <= now) {
    await db.session.deleteMany({ where: { id: s.id } });
    return null;
  }
  if (now - s.lastSeen.getTime() > SESSION_TOUCH_MS) {
    await db.session.update({ where: { id: s.id }, data: { lastSeen: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) } });
  }
  return s.user;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof userForToken>>>;

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    return await userForToken((await cookies()).get(SESSION_COOKIE)?.value);
  } catch {
    return null; // no request scope (a script)
  }
}
