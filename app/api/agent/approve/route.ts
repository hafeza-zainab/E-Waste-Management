import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { z } from "zod";
import { ApprovalError, approveByUser, mintToken } from "@/lib/agent/approval";
import { log } from "@/lib/log";
import { getPrincipal } from "@/lib/session";

const Body = z.object({ approvalId: z.string().min(1).max(60) });

/**
 * The user's Approve click. The only code that records user approval, and it authenticates the session
 * as the job's owner. Each call also mints a fresh single-use token for one PayPal order creation.
 */
export async function POST(req: Request) {
  const limited = rateLimitResponse(req, "approval");
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const who = await getPrincipal();
    const approval = await approveByUser(parsed.data.approvalId, who);
    const token = await mintToken(approval.id);
    return NextResponse.json({ token, jobId: approval.jobId, expiresAt: approval.expiresAt });
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "forbidden" ? 403 : 409 });
    log.error("agent_approve_failed", { error: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "Could not record your approval." }, { status: 500 });
  }
}
