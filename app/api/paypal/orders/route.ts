import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseQuote } from "@/lib/jobs/service";
import { PayPalError } from "@/lib/paypal/client";
import { createOrder } from "@/lib/paypal/orders";

const Body = z.object({ jobId: z.string().min(1) });

/** Creates a PayPal order for a quoted job. The amount is read from the DB, never from the request. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const job = await db.job.findUnique({ where: { id: parsed.data.jobId }, include: { device: true } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "quoted") return NextResponse.json({ error: "This job is already paid or closed." }, { status: 409 });
  const quote = parseQuote(job.quoteJson);
  if (!quote) return NextResponse.json({ error: "Job has no quote." }, { status: 409 });

  try {
    const order = await createOrder(job.id, `ReLoop repair: ${job.device.brand} ${job.device.model}`, quote);
    await db.job.update({ where: { id: job.id }, data: { paypalOrderId: order.id } });
    return NextResponse.json({ id: order.id, simulated: order.simulated, approveUrl: order.approveUrl });
  } catch (e) {
    const status = e instanceof PayPalError ? 502 : 500;
    return NextResponse.json({ error: e instanceof PayPalError ? `PayPal error: ${e.message}` : "Could not create the order.", debugId: e instanceof PayPalError ? e.debugId : undefined }, { status });
  }
}
