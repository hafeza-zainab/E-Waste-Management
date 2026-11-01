import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroyAllSessions, destroySession, getSessionUser, sessionCookieOptions } from "@/lib/auth/sessions";
import { SESSION_COOKIE } from "@/lib/auth/constants";

export const runtime = "nodejs";

/** Deletes the session row and the cookie. `?all=1` also ends the user's other sessions. Form posts get a redirect. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    const user = await getSessionUser();
    if (user) await destroyAllSessions(user.id);
  }
  await destroySession(await cookies());
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  // A relative redirect stays on the browser's public origin behind a reverse
  // proxy; req.url can contain an internal server hostname or HTTP scheme.
  const response = wantsJson ? NextResponse.json({ ok: true }) : new NextResponse(null, { status: 303, headers: { Location: "/" } });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
