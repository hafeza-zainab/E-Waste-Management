import { paypalFetch } from "./client";

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
    // PAYMENT.PAYOUTS-ITEM.* events
    payout_item_id?: string;
    payout_batch_id?: string;
    sender_item_id?: string;
    transaction_status?: string;
    errors?: { name?: string; message?: string };
  };
}

/** Verifies a webhook with PayPal's verify-webhook-signature endpoint. Returns false on any doubt. */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (n: string) => headers.get(n);
  const fields = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
  };
  if (Object.values(fields).some((v) => !v)) return false;
  // Only trust PayPal-hosted certificates.
  try {
    const host = new URL(fields.cert_url!).hostname;
    if (!host.endsWith(".paypal.com")) return false;
  } catch {
    return false;
  }
  try {
    const res = await paypalFetch<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: { ...fields, webhook_id: webhookId, webhook_event: JSON.parse(rawBody) },
    });
    return res.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

