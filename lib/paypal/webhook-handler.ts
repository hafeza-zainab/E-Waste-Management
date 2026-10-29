import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { markPaid, transitionJob } from "@/lib/jobs/service";
import { isJobStatus } from "@/lib/jobs/state-machine";
import type { WebhookEvent } from "./webhooks";

export type WebhookResult = "processed" | "duplicate" | "ignored";

const PAYOUT_BAD = new Set(["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "CANCELED"]);
const CAN_LOSE_AUTH = ["paid", "accepted", "in_progress", "completed"];

/** Plain-words explanation for payout item statuses the UI shows. */
export function payoutStatusNote(status: string): string | null {
  if (status === "UNCLAIMED")
    return "The technician's PayPal email has no PayPal account yet, so the money is on hold. It is released when they sign up with that email, and returned to the platform after 30 days if not claimed.";
  if (status === "PENDING" || status === "ONHOLD") return "PayPal is still processing this payout.";
  return null;
}

async function findJob(event: WebhookEvent) {
  const r = event.resource;
  const orderId = r?.supplementary_data?.related_ids?.order_id;
  const authId = event.event_type.startsWith("PAYMENT.AUTHORIZATION") ? r?.id : r?.supplementary_data?.related_ids?.authorization_id;
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM")) {
    if (r?.payout_item_id) {
      const j = await db.job.findFirst({ where: { payoutItemId: r.payout_item_id } });
      if (j) return j;
    }
    if (r?.payout_batch_id) return db.job.findFirst({ where: { payoutBatchId: r.payout_batch_id } });
    return null;
  }
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && r?.id) {
    const j = await db.job.findFirst({ where: { paypalCaptureId: r.id } });
    if (j) return j;
  }
  if (authId) {
    const j = await db.job.findFirst({ where: { paypalAuthId: authId } });
    if (j) return j;
  }
  return orderId ? db.job.findFirst({ where: { paypalOrderId: orderId } }) : null;
}

async function findDonation(event: WebhookEvent) {
  const r = event.resource;
  const orderId = r?.supplementary_data?.related_ids?.order_id;
  if (r?.id) {
    const d = await db.donation.findFirst({ where: { paypalCaptureId: r.id } });
    if (d) return d;
  }
  if (orderId) {
    const d = await db.donation.findFirst({ where: { paypalOrderId: orderId } });
    if (d) return d;
  }
  return r?.custom_id ? db.donation.findUnique({ where: { publicId: r.custom_id } }) : null;
}

/**
 * Idempotent: each PayPal event id is recorded once (unique constraint), and every state change is a
 * conditional transition, so replays are harmless. The in-app API routes normally act first;
 * webhooks are the safety net and the only source for asynchronous payout results.
 */
export async function processWebhookEvent(event: WebhookEvent, simulated: boolean): Promise<WebhookResult> {
  const job = await findJob(event);
  const donation = !job && event.event_type === "PAYMENT.CAPTURE.COMPLETED" ? await findDonation(event) : null;
  // Guided-demo records are TOUR-SIMULATED: a webhook can never touch them.
  if (job?.isTour || donation?.isTour) return "ignored";

  try {
    await db.webhookEvent.create({ data: { eventId: event.id, type: event.event_type, jobId: job?.id, simulated } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
  if (donation) {
    // Completes a donation whose capture response we missed or that was PENDING. Already-completed donations are untouched.
    const res = await db.donation.updateMany({
      where: { id: donation.id, status: { in: ["created", "capturing", "pending"] } },
      data: { status: "completed", paypalCaptureId: event.resource?.id ?? donation.paypalCaptureId, capturedAt: new Date() },
    });
    return res.count ? "processed" : "ignored";
  }
  if (!job || !isJobStatus(job.status)) return "ignored";
  const r = event.resource;

  switch (event.event_type) {
    case "PAYMENT.AUTHORIZATION.CREATED": {
      if (!r?.id || !job.paypalOrderId) return "ignored";
      const moved = await markPaid(job.id, job.paypalOrderId, r.id, `Authorization confirmed by ${simulated ? "simulated " : ""}webhook`);
      return moved ? "processed" : "ignored";
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      // Record the capture id if our own response was lost; never moves the state by itself.
      if (r?.id && !job.paypalCaptureId && ["completed", "customer_confirmed"].includes(job.status)) {
        await db.job.updateMany({ where: { id: job.id, paypalCaptureId: null }, data: { paypalCaptureId: r.id } });
        return "processed";
      }
      return "ignored";
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      if (!CAN_LOSE_AUTH.includes(job.status)) return "ignored";
      const moved = await transitionJob(job.id, job.status as "paid", "authorization_expired", "system", {}, "PayPal reported the authorization voided; nothing was charged");
      return moved ? "processed" : "ignored";
    }
    default: {
      if (!event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) return "ignored";
      const status = r?.transaction_status ?? event.event_type.split(".").pop()!.toUpperCase();
      const note = payoutStatusNote(status);
      await db.job.update({ where: { id: job.id }, data: { payoutStatus: status, payoutNote: note ?? undefined, payoutItemId: r?.payout_item_id ?? job.payoutItemId } });
      await db.jobEvent.create({ data: { jobId: job.id, status: job.status, note: `Payout item ${status}${simulated ? " (simulated webhook)" : ""}` } });
      if (PAYOUT_BAD.has(status) && job.status === "payout_released") {
        // PayPal definitively failed this item: a retry needs a fresh sender_batch_id.
        await transitionJob(job.id, "payout_released", "payout_failed", "system", { payoutError: `PayPal reported the payout ${status}.`, payoutAttempt: { increment: 1 } }, `Payout ${status}`);
      }
      return "processed";
    }
  }
}
