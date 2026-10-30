import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAccount, EmailTakenError } from "@/lib/auth/accounts";
import { homeFor, safeNext } from "@/lib/auth/redirect";
import { rotateSession } from "@/lib/auth/sessions";
import { fieldErrors, normalizeEmail, SignupSchema } from "@/lib/auth/validation";
import { authRateLimit, bodyTooLarge } from "@/lib/security/rate-limit";
import { log } from "@/lib/log";

export const runtime = "nodejs";

/** Creates an account (and its owner or technician profile) and logs it in with a fresh session. */
export async function POST(req: Request) {
  const tooBig = bodyTooLarge(req, 10_000);
  if (tooBig) return tooBig;
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const rawEmail = typeof (raw as { email?: unknown }).email === "string" ? normalizeEmail((raw as { email: string }).email) : undefined;
  const limited = authRateLimit(req, "signup", rawEmail);
  if (limited) return limited;
  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Please fix the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  try {
    const user = await createAccount(parsed.data);
    await rotateSession(await cookies(), user.id);
    return NextResponse.json({ ok: true, redirect: safeNext(parsed.data.next, homeFor(user.role)) });
  } catch (e) {
    if (e instanceof EmailTakenError) return NextResponse.json({ error: e.message, fields: { email: e.message } }, { status: 409 });
    log.error("signup_failed", { error: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "Could not create the account. Please try again." }, { status: 500 });
  }
}
