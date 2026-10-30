import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createGuest } from "@/lib/auth/accounts";
import { safeNext } from "@/lib/auth/redirect";
import { rotateSession } from "@/lib/auth/sessions";
import { authRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** "Continue as guest (demo)": a real owner User with isGuest=true and a normal session. Purged after 24 hours. */
export async function POST(req: Request) {
  const limited = authRateLimit(req, "guest");
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { next?: unknown } | null;
  const user = await createGuest();
  await rotateSession(await cookies(), user.id);
  return NextResponse.json({ ok: true, redirect: safeNext(body?.next, "/owner") });
}
