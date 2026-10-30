import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { csrfExempt, isSameOrigin } from "@/lib/auth/csrf";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/constants";

/**
 * 1. CSRF: every state-changing /api request must come from this app's own origin (Server Actions have Next's own check).
 * 2. Gives every browser an opaque id (cookie `reloop_sid`) used only to rate-limit per session. It carries no identity.
 * 3. Slides the session cookie's expiry on page loads (the DB row slides in lib/auth/sessions.ts). Skipped while a guided
 *    demo runs, so the visitor's real session cookie is not touched at all during a tour.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !csrfExempt(pathname) && !isSameOrigin(request.method, request.headers)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const response = NextResponse.next();
  if (!request.cookies.get("reloop_sid")) {
    response.cookies.set("reloop_sid", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && request.method === "GET" && !request.cookies.get("reloop_tour_on")) {
    response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads/|api/health).*)"] };
