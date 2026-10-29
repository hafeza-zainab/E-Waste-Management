import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { cleanupTourRun, currentTourRun, setTourCookies, startTourRun, tourEnabled } from "@/lib/tour/server";

export const runtime = "nodejs";

/** Starts a guided-demo session. Replaces (and cleans up) any earlier session of this browser. */
export async function POST(req: Request) {
  if (!tourEnabled()) return NextResponse.json({ error: "The guided demo is not enabled here." }, { status: 403 });
  const limited = rateLimitResponse(req, "tour");
  if (limited) return limited;
  const previous = await currentTourRun();
  if (previous) await cleanupTourRun(previous.id);
  const run = await startTourRun();
  setTourCookies(await cookies(), run.id);
  return NextResponse.json({ runId: run.id });
}
