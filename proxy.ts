import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gives every browser an opaque session id (cookie `reloop_sid`) used only to rate-limit per session.
 * It carries no identity. The rate limiting itself lives in route handlers, not here.
 */
export function proxy(request: NextRequest) {
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
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads/|api/health).*)"] };
