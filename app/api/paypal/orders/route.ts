import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApprovalError } from "@/lib/agent/approval";
import { createOrderWithApproval } from "@/lib/agent/order";
import { parseQuote } from "@/lib/jobs/service";
import { PayPalError } from "@/lib/paypal/client";
import { createOrder } from "@/lib/paypal/orders";

const Body = z.object({ jobId: z.string().min(1), approvalToken: z.string().max(200).optional() });

/** Creates a PayPal order for a quoted job. The amount is read from the DB, never from the request. */
export async function POST(req: Request) {
  const limited = rateLimitResponse(req, "paypalOrder");
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const job = await db.job.findUnique({ where: { id: parsed.data.jobId }, include: { device: true } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "quoted") return NextResponse.json({ error: "This job is already paid or closed." }, { status: 409 });
  const quote = parseQuote(job.quoteJson);
  if (!quote) return NextResponse.json({ error: "Job has no quote." }, { status: 409 });

  try {
    // Jobs built by the agent can only be paid with the user's single-use approval token.
    const order = job.agentRunId
      ? await createOrderWithApproval(job.id, parsed.data.approvalToken)
      : await (async () => {
          const o = await createOrder(job.id, `ReLoop repair: ${job.device.brand} ${job.device.model}`, quote);
          await db.job.update({ where: { id: job.id }, data: { paypalOrderId: o.id } });
          return o;
        })();
    return NextResponse.json({ id: order.id, simulated: order.simulated, approveUrl: order.approveUrl });
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "forbidden" ? 403 : 409 });
    const status = e instanceof PayPalError ? 502 : 500;
    return NextResponse.json({ error: e instanceof PayPalError ? `PayPal error: ${e.message}` : "Could not create the order.", debugId: e instanceof PayPalError ? e.debugId : undefined }, { status });
  }
}
