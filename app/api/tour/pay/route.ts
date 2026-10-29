import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newSimId } from "@/lib/paypal/gateway";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { transitionJob } from "@/lib/jobs/service";
import { currentTourRun, tourEnabled } from "@/lib/tour/server";

export const runtime = "nodejs";

/**
 * Tour-only step: marks a tour job as paid ("held") with a TOUR-SIMULATED authorization. It never calls PayPal and
 * only works for a job that (a) is a tour job of THIS session, (b) the user already approved, (c) with demo actions on.
 */
export async function POST(req: Request) {
  if (!tourEnabled()) return NextResponse.json({ error: "The guided demo is not enabled here." }, { status: 403 });
  const limited = rateLimitResponse(req, "tour");
  if (limited) return limited;
  const body = z.object({ jobId: z.string().min(1).max(60) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const run = await currentTourRun();
  if (!run) return NextResponse.json({ error: "No active guided demo session." }, { status: 403 });
  const job = await db.job.findUnique({ where: { id: body.data.jobId } });
  if (!job || !job.isTour || job.tourRunId !== run.id) return NextResponse.json({ error: "That job is not part of your guided demo." }, { status: 403 });
  if (job.status !== "quoted") return NextResponse.json({ ok: true, status: job.status });
  const approved = await db.agentApproval.findFirst({ where: { jobId: job.id, userApprovedAt: { not: null }, expiresAt: { gt: new Date() } } });
  if (!approved) return NextResponse.json({ error: "Approve the quote first." }, { status: 409 });
  const ok = await transitionJob(
    job.id,
    "quoted",
    "paid",
    "system",
    { paypalOrderId: newSimId("TOUR-ORDER"), paypalAuthId: newSimId("TOUR-AUTH"), authSimulated: true, authorizedAt: new Date() },
    "TOUR-SIMULATED: funds marked as held by the guided demo. PayPal was not called.",
  );
  return NextResponse.json({ ok, status: "paid" });
}
