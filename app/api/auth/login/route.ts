import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/accounts";
import { homeFor, safeNext } from "@/lib/auth/redirect";
import { rotateSession } from "@/lib/auth/sessions";
import { LoginSchema, normalizeEmail } from "@/lib/auth/validation";
import { authRateLimit, bodyTooLarge } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const BAD = { error: "Email or password is incorrect." };

export async function POST(req: Request) {
  const tooBig = bodyTooLarge(req, 5_000);
  if (tooBig) return tooBig;
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const rawEmail = typeof (raw as { email?: unknown }).email === "string" ? normalizeEmail((raw as { email: string }).email) : undefined;
  const limited = authRateLimit(req, "login", rawEmail);
  if (limited) return limited;
  const parsed = LoginSchema.safeParse(raw);
  // A malformed email gets the same generic answer as a wrong password: nothing reveals which accounts exist.
  if (!parsed.success) return NextResponse.json(BAD, { status: 401 });
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return NextResponse.json(BAD, { status: 401 });
  await rotateSession(await cookies(), user.id);
  return NextResponse.json({ ok: true, redirect: safeNext(parsed.data.next, homeFor(user.role)) });
}
