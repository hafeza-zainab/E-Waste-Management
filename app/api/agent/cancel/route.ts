import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { cancelJob } from "@/lib/jobs/lifecycle";
import { getPrincipal } from "@/lib/session";

const Body = z.object({ approvalId: z.string().min(1).max(60) });

/** "Change request": cancels the unpaid quote and expires the approval. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const approval = await db.agentApproval.findUnique({ where: { id: parsed.data.approvalId } });
  if (!approval) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    await cancelJob(approval.jobId, await getPrincipal());
    await db.agentApproval.update({ where: { id: approval.id }, data: { expiresAt: new Date(0) } });
    return NextResponse.json({ cancelled: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not cancel." }, { status: 409 });
  }
}
