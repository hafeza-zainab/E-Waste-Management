import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { z } from "zod";
import { db } from "@/lib/db";
import { cancelJob } from "@/lib/jobs/lifecycle";
import { getPrincipalOrNull } from "@/lib/session";

const Body = z.object({ approvalId: z.string().min(1).max(60) });

/** "Change request": cancels the unpaid quote and expires the approval. */
export async function POST(req: Request) {
  const limited = rateLimitResponse(req, "approval");
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const who = await getPrincipalOrNull();
  if (!who) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const approval = await db.agentApproval.findUnique({ where: { id: parsed.data.approvalId } });
  if (!approval) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    await cancelJob(approval.jobId, who);
    await db.agentApproval.update({ where: { id: approval.id }, data: { expiresAt: new Date(0) } });
    return NextResponse.json({ cancelled: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not cancel." }, { status: 409 });
  }
}
