import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paypalMode } from "@/lib/paypal/client";
import { isJobOwner } from "@/lib/auth/access";
import { getPrincipalOrNull } from "@/lib/session";
import { processWebhookEvent } from "@/lib/paypal/webhook-handler";

const Body = z.object({ jobId: z.string().min(1) });

/**
 * Local-dev fallback: replays a PAYMENT.AUTHORIZATION.CREATED event through the
 * same handler as the real webhook, minus signature verification. Disabled in
 * production unless PayPal is in simulated mode.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" && paypalMode() !== "simulated") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const who = await getPrincipalOrNull();
  if (!who) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const job = await db.job.findUnique({ where: { id: parsed.data.jobId }, include: { device: true } });
  if (!job || !isJobOwner(who, job)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!job.paypalOrderId) return NextResponse.json({ error: "Create a PayPal order first." }, { status: 409 });

  const result = await processWebhookEvent(
    {
      id: `SIM-EVT-${randomUUID()}`,
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: { id: `SIM-AUTH-${randomUUID()}`, supplementary_data: { related_ids: { order_id: job.paypalOrderId } } },
    },
    true,
  );
  return NextResponse.json({ result });
}
