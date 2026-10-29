import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { TOUR_COOKIE } from "@/lib/tour/constants";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { cleanupTourRun, clearTourCookies, tourEnabled } from "@/lib/tour/server";

export const runtime = "nodejs";

/** Cleans up the tour session bound to this browser's cookie. Always clears the cookies; never touches non-tour data. */
export async function POST(req: Request) {
  if (!tourEnabled()) return NextResponse.json({ error: "The guided demo is not enabled here." }, { status: 403 });
  const limited = rateLimitResponse(req, "tour");
  if (limited) return limited;
  const jar = await cookies();
  const body = z.object({ runId: z.string().max(60).optional() }).safeParse(await req.json().catch(() => ({})));
  const id = jar.get(TOUR_COOKIE)?.value;
  // The cookie is the authority. A runId in the body is only accepted if it matches it (a stale tab cannot delete another run).
  if (id && /^[0-9a-f-]{36}$/.test(id) && (!body.success || !body.data.runId || body.data.runId === id)) await cleanupTourRun(id);
  clearTourCookies(jar);
  return NextResponse.json({ ok: true });
}
