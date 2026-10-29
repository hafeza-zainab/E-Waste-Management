import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { z } from "zod";
import { authorizeJobOrder } from "@/lib/jobs/payment";
import { db } from "@/lib/db";
import { blockPaypalDuringTour } from "@/lib/tour/paypal-guard";

const Body = z.object({ jobId: z.string().min(1) });

/** Authorizes (holds) the approved order and moves the job quoted -> paid. Capture happens on verified completion. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]/authorize">) {
  const limited = rateLimitResponse(req, "paypalOrder");
  if (limited) return limited;
  const { orderId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const job = await db.job.findUnique({ where: { id: parsed.data.jobId }, select: { isTour: true } });
  const blocked = await blockPaypalDuringTour("/api/paypal/orders/authorize", job);
  if (blocked) return blocked;
  const r = await authorizeJobOrder(parsed.data.jobId, orderId);
  const { httpStatus, ok, ...rest } = r;
  void ok;
  return NextResponse.json(rest, { status: httpStatus });
}
