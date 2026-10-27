import { randomUUID } from "node:crypto";
import { centsToDecimalString } from "@/lib/jobs/money";
import { isSimulatedId, paypalFetch, paypalMode, PayPalError } from "./client";

/**
 * PayPal authorization timing (Payments v2): an authorization has a 3-day HONOR
 * period (PayPal guarantees the funds) and stays VALID for 29 days. After the
 * honor period it can be re-authorized (POST .../reauthorize) until day 29.
 */
export const HONOR_PERIOD_DAYS = 3;
export const VALID_PERIOD_DAYS = 29;
const DAY = 86_400_000;

export type CapturePlan = "capture" | "reauthorize_then_capture" | "expired";

export function planCapture(authorizedAt: Date, now = new Date()): CapturePlan {
  const age = now.getTime() - authorizedAt.getTime();
  if (age >= VALID_PERIOD_DAYS * DAY) return "expired";
  if (age > HONOR_PERIOD_DAYS * DAY) return "reauthorize_then_capture";
  return "capture";
}

const money = (cents: number) => ({ currency_code: "USD", value: centsToDecimalString(cents) });

/** Capture exactly once: the PayPal-Request-Id is derived from the job id, so a retry returns the stored capture. */
export async function captureAuthorization(authorizationId: string, jobId: string, cents: number): Promise<{ captureId: string; status: string }> {
  if (isSimulatedId(authorizationId)) return { captureId: `SIM-CAP-${jobId}`, status: "COMPLETED" };
  const res = await paypalFetch<{ id: string; status: string }>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    method: "POST",
    body: { amount: money(cents), final_capture: true, invoice_id: jobId },
    requestId: `reloop-capture-${jobId}`,
  });
  if (res.status !== "COMPLETED" && res.status !== "PENDING") throw new Error(`Capture ended in status ${res.status}.`);
  return { captureId: res.id, status: res.status };
}

export async function reauthorizeAuthorization(authorizationId: string, jobId: string, cents: number, attempt: number): Promise<{ authorizationId: string }> {
  if (isSimulatedId(authorizationId)) return { authorizationId };
  const res = await paypalFetch<{ id?: string }>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`, {
    method: "POST",
    body: { amount: money(cents) },
    requestId: `reloop-reauth-${jobId}-${attempt}`,
  });
  return { authorizationId: res.id ?? authorizationId };
}

/** Releases the hold. Required when a paid job is cancelled or declined so the buyer is not left with held funds. */
export async function voidAuthorization(authorizationId: string, jobId: string): Promise<void> {
  if (isSimulatedId(authorizationId)) return;
  await paypalFetch(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    method: "POST",
    requestId: `reloop-void-${jobId}`,
  });
}

export interface PayoutResult {
  mode: "paypal_sandbox" | "simulated";
  batchId: string;
  itemId: string | null;
  status: string;
  note: string | null;
}

/** Deterministic per job and attempt, so a retry can never pay twice. */
export const senderBatchId = (jobId: string, attempt: number) => `reloop-payout-${jobId}${attempt ? `-r${attempt}` : ""}`;

/** 401/403 from the Payouts API means the sandbox business account has no Payouts permission. */
export const isPayoutsNotEnabled = (e: unknown) => e instanceof PayPalError && (e.status === 401 || e.status === 403);
/** PayPal rejects a repeated sender_batch_id; that means the batch already exists. */
export const isDuplicateBatch = (e: unknown) => e instanceof PayPalError && /duplicate|already (been )?(used|exist|submitted)|BATCH_ID/i.test(`${e.issue ?? ""} ${e.message}`);

export function simulatedPayout(jobId: string, reason: string): PayoutResult {
  return { mode: "simulated", batchId: `SIM-BATCH-${jobId}`, itemId: `SIM-ITEM-${jobId}`, status: "SUCCESS", note: `SIMULATED payout: ${reason}` };
}

/** Sends the technician share with the Payouts API. `captureId` must be a real PayPal capture to hit PayPal. */
export async function createPayout(args: { jobId: string; attempt: number; email: string; cents: number; captureId: string; description: string }): Promise<PayoutResult> {
  if (paypalMode() === "simulated") return simulatedPayout(args.jobId, "PayPal is not configured (no sandbox credentials).");
  if (isSimulatedId(args.captureId)) return simulatedPayout(args.jobId, "the payment was never really captured at PayPal, so nothing real may be paid out.");
  const receiver = (process.env.NODE_ENV !== "production" && process.env.PAYPAL_PAYOUT_RECEIVER_OVERRIDE) || args.email;
  const batchId = senderBatchId(args.jobId, args.attempt);
  const created = await paypalFetch<{ batch_header: { payout_batch_id: string; batch_status: string } }>("/v1/payments/payouts", {
    method: "POST",
    requestId: batchId,
    body: {
      sender_batch_header: { sender_batch_id: batchId, email_subject: "Your ReLoop repair payout", email_message: args.description.slice(0, 200) },
      items: [
        {
          recipient_type: "EMAIL",
          receiver,
          amount: money(args.cents),
          note: args.description.slice(0, 160),
          sender_item_id: `${args.jobId}${args.attempt ? `-r${args.attempt}` : ""}`,
        },
      ],
    },
  });
  const payoutBatchId = created.batch_header.payout_batch_id;
  let itemId: string | null = null;
  let status = created.batch_header.batch_status;
  try {
    const detail = await paypalFetch<{ items?: { payout_item_id: string; transaction_status?: string }[] }>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
    itemId = detail.items?.[0]?.payout_item_id ?? null;
    status = detail.items?.[0]?.transaction_status ?? status;
  } catch {
    // Batch exists; item details will arrive via PAYMENT.PAYOUTS-ITEM.* webhooks.
  }
  return { mode: "paypal_sandbox", batchId: payoutBatchId, itemId, status, note: null };
}

export const newSimId = (kind: string) => `SIM-${kind}-${randomUUID()}`;
