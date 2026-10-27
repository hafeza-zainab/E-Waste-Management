import { randomUUID } from "node:crypto";
import { centsToDecimalString } from "@/lib/jobs/money";
import type { Quote } from "@/lib/jobs/quote";
import { log } from "@/lib/log";
import { isSimulatedId, paypalFetch, paypalMode } from "./client";

const CURRENCY = "USD";
const money = (cents: number) => ({ currency_code: CURRENCY, value: centsToDecimalString(cents) });

/** Printable-ASCII-ish text within PayPal's limits. */
const clean = (s: string, max: number) => s.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "Repair";

/**
 * Pure: builds the Orders v2 body. Amounts always come from our DB quote, never the browser.
 * Uses `payment_source.paypal.experience_context` (the current field; `application_context` is deprecated).
 * Lines are all DIGITAL_GOODS: this is a service with no shipping address, so PHYSICAL_GOODS would
 * contradict shipping_preference NO_SHIPPING.
 */
export function buildOrderPayload(jobId: string, description: string, quote: Quote, baseUrl: string) {
  const lines = quote.lines.filter((l) => l.cents > 0); // PayPal rejects zero-value items
  const items = lines.map((l) => ({
    name: clean(l.label, 127),
    quantity: "1",
    unit_amount: money(l.cents),
    category: "DIGITAL_GOODS" as const,
  }));
  const itemTotal = lines.reduce((s, l) => s + l.cents, 0);
  if (itemTotal !== quote.totalCents) throw new Error("Quote lines do not add up to the total.");
  const base = baseUrl.replace(/\/$/, "");
  return {
    intent: "AUTHORIZE" as const,
    purchase_units: [
      {
        reference_id: jobId,
        custom_id: jobId,
        description: clean(description, 127),
        amount: { ...money(quote.totalCents), breakdown: { item_total: money(itemTotal) } },
        items,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "ReLoop",
          shipping_preference: "NO_SHIPPING" as const,
          user_action: "PAY_NOW" as const,
          return_url: `${base}/jobs/${jobId}/return`,
          cancel_url: `${base}/jobs/${jobId}/return?cancelled=1`,
        },
      },
    },
  };
}

export const appBaseUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

export interface CreatedOrder {
  id: string;
  simulated: boolean;
  /** Where to send the buyer for the full-page (non-popup) flow. */
  approveUrl: string | null;
}

interface OrderResponse {
  id: string;
  status?: string;
  links?: { rel: string; href: string }[];
}

export const approveLink = (o: Pick<OrderResponse, "links">) => o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;

/**
 * A fresh order per attempt: reusing one PayPal-Request-Id would hand back the same (possibly stuck)
 * order after a failed approval, so every retry would fail the same way.
 */
export async function createOrder(jobId: string, description: string, quote: Quote): Promise<CreatedOrder> {
  if (paypalMode() === "simulated") return { id: `SIM-ORDER-${randomUUID()}`, simulated: true, approveUrl: null };
  const body = buildOrderPayload(jobId, description, quote, appBaseUrl());
  if (process.env.NODE_ENV !== "production") log.info("paypal_create_order_payload", { jobId, amount: body.purchase_units[0].amount.value, items: body.purchase_units[0].items.length });
  const order = await paypalFetch<OrderResponse>("/v2/checkout/orders", {
    method: "POST",
    body,
    requestId: `reloop-order-${jobId}-${randomUUID()}`,
  });
  return { id: order.id, simulated: false, approveUrl: approveLink(order) };
}

export interface Authorization {
  authorizationId: string;
  status: string;
}

interface AuthorizeResponse {
  status: string;
  purchase_units?: { payments?: { authorizations?: { id: string; status: string }[] } }[];
}

/** Authorize (hold) the buyer's funds. Capture happens later, on verified completion. */
export async function authorizeOrder(orderId: string): Promise<Authorization> {
  if (isSimulatedId(orderId)) return { authorizationId: `SIM-AUTH-${randomUUID()}`, status: "CREATED" };
  const res = await paypalFetch<AuthorizeResponse>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    method: "POST",
    body: {},
    requestId: `reloop-authorize-${orderId}`,
  });
  const auth = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("PayPal returned no authorization.");
  if (auth.status !== "CREATED") throw new Error(`Authorization is ${auth.status}, expected CREATED.`);
  return { authorizationId: auth.id, status: auth.status };
}
