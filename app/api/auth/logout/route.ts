import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroyAllSessions, destroySession, getSessionUser } from "@/lib/auth/sessions";

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
  return wantsJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/", req.url), 303);
}
