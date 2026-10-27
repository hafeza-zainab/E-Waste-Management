import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { markPaid } from "@/lib/jobs/service";
import { PayPalError } from "@/lib/paypal/client";
import { authorizeOrder } from "@/lib/paypal/orders";

const Body = z.object({ jobId: z.string().min(1) });

/** Authorizes (holds) the approved order and moves the job quoted -> paid. Capture happens on verified completion. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]/authorize">) {
  const { orderId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const job = await db.job.findUnique({ where: { id: parsed.data.jobId } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  // The order must be the one we created for this job.
  if (job.paypalOrderId !== orderId) return NextResponse.json({ error: "Order does not belong to this job." }, { status: 409 });
  if (job.status !== "quoted") return NextResponse.json({ status: job.status, alreadyPaid: true });

  try {
    const auth = await authorizeOrder(orderId);
    await markPaid(job.id, orderId, auth.authorizationId, `Funds authorized (${auth.authorizationId})`);
    return NextResponse.json({ status: "paid", authorizationId: auth.authorizationId });
  } catch (e) {
    if (e instanceof PayPalError) {
      return NextResponse.json(
        { error: e.issue === "INSTRUMENT_DECLINED" ? "Your payment method was declined. Please choose another." : `PayPal error: ${e.message}`, issue: e.issue, debugId: e.debugId },
        { status: e.issue === "INSTRUMENT_DECLINED" ? 422 : 502 },
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Authorization failed." }, { status: 500 });
  }
}
