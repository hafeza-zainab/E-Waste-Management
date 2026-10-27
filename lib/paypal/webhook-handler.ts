import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { markPaid } from "@/lib/jobs/service";
import type { WebhookEvent } from "./webhooks";

export type WebhookResult = "processed" | "duplicate" | "ignored";

/**
 * Idempotent: each PayPal event id is recorded once (unique constraint), and the
 * state change itself is a conditional transition, so replays are harmless.
 * Webhooks are a safety net: the authorize API route normally marks the job paid first.
 */
export async function processWebhookEvent(event: WebhookEvent, simulated: boolean): Promise<WebhookResult> {
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
  const job = orderId ? await db.job.findFirst({ where: { paypalOrderId: orderId } }) : null;

  try {
    await db.webhookEvent.create({ data: { eventId: event.id, type: event.event_type, jobId: job?.id, simulated } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }

  if (event.event_type === "PAYMENT.AUTHORIZATION.CREATED" && job && event.resource?.id) {
    const moved = await markPaid(job.id, job.paypalOrderId!, event.resource.id, `Authorization confirmed by ${simulated ? "simulated " : ""}webhook`);
    return moved ? "processed" : "ignored";
  }
  return "ignored";
}
