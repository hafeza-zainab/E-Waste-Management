import { randomUUID } from "node:crypto";
import { centsToDecimalString } from "@/lib/jobs/money";
import type { Quote } from "@/lib/jobs/quote";
import { isSimulatedId, paypalFetch, paypalMode } from "./client";

const CURRENCY = "USD";
const money = (cents: number) => ({ currency_code: CURRENCY, value: centsToDecimalString(cents) });

/** Pure: builds the Orders v2 body. Amounts always come from our DB quote, never the browser. */
export function buildOrderPayload(jobId: string, description: string, quote: Quote) {
  const items = quote.lines.map((l) => ({
    name: l.label.slice(0, 127),
    quantity: "1",
    unit_amount: money(l.cents),
    category: l.kind === "part" ? "PHYSICAL_GOODS" : "DIGITAL_GOODS",
  }));
  const itemTotal = quote.lines.reduce((s, l) => s + l.cents, 0);
  if (itemTotal !== quote.totalCents) throw new Error("Quote lines do not add up to the total.");
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: jobId,
        custom_id: jobId,
        description: description.slice(0, 127),
        amount: { ...money(quote.totalCents), breakdown: { item_total: money(itemTotal) } },
        items,
      },
    ],
    application_context: { brand_name: "ReLoop", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
  };
}

export interface CreatedOrder {
  id: string;
  simulated: boolean;
}

/** Idempotent per job: PayPal-Request-Id is stable, so retries return the same order. */
export async function createOrder(jobId: string, description: string, quote: Quote): Promise<CreatedOrder> {
  if (paypalMode() === "simulated") return { id: `SIM-ORDER-${randomUUID()}`, simulated: true };
  const order = await paypalFetch<{ id: string }>("/v2/checkout/orders", {
    method: "POST",
    body: buildOrderPayload(jobId, description, quote),
    requestId: `reloop-order-${jobId}`,
  });
  return { id: order.id, simulated: false };
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
