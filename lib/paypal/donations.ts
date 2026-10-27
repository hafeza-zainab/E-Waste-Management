import { randomUUID } from "node:crypto";
import { centsToDecimalString } from "@/lib/jobs/money";
import { isSimulatedId, paypalFetch, paypalMode } from "./client";
import { appBaseUrl, approveLink } from "./orders";

/** Pure. Donations use intent CAPTURE (money moves at approval). Amount is a 2-decimal string built from integer cents. */
export function buildDonationOrderPayload(publicId: string, cents: number, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    intent: "CAPTURE" as const,
    purchase_units: [
      {
        reference_id: publicId,
        custom_id: publicId,
        description: "ReLoop Refurbish and Donate Fund (sandbox demo donation)",
        amount: { currency_code: "USD", value: centsToDecimalString(cents) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "ReLoop",
          shipping_preference: "NO_SHIPPING" as const,
          user_action: "PAY_NOW" as const,
          return_url: `${base}/donate/return?d=${publicId}`,
          cancel_url: `${base}/donate/return?d=${publicId}&cancelled=1`,
        },
      },
    },
  };
}

export interface DonationOrder {
  id: string;
  simulated: boolean;
  approveUrl: string | null;
}

/** A fresh PayPal-Request-Id per attempt, so a retry never replays a stuck order. */
export async function createDonationOrder(publicId: string, cents: number): Promise<DonationOrder> {
  const body = buildDonationOrderPayload(publicId, cents, appBaseUrl());
  const order = await paypalFetch<{ id: string; links?: { rel: string; href: string }[] }>("/v2/checkout/orders", {
    method: "POST",
    body,
    requestId: `reloop-donation-order-${publicId}-${randomUUID()}`,
  });
  return { id: order.id, simulated: false, approveUrl: approveLink(order) };
}

export const newSimulatedDonationOrder = (): DonationOrder => ({ id: `SIM-DORDER-${randomUUID()}`, simulated: true, approveUrl: null });

export interface DonationCapture {
  captureId: string;
  status: "COMPLETED" | "PENDING";
}

/** Captures an approved order. The request id is derived from the donation, so a retry cannot capture twice. */
export async function captureDonationOrder(orderId: string, publicId: string): Promise<DonationCapture> {
  if (isSimulatedId(orderId)) return { captureId: `SIM-DCAP-${publicId}`, status: "COMPLETED" };
  if (paypalMode() === "simulated") throw new Error("PayPal is not configured.");
  const res = await paypalFetch<{ status: string; purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[] }>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    { method: "POST", body: {}, requestId: `reloop-donation-capture-${publicId}` },
  );
  const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap) throw new Error("PayPal returned no capture.");
  if (cap.status === "COMPLETED") return { captureId: cap.id, status: "COMPLETED" };
  if (cap.status === "PENDING") return { captureId: cap.id, status: "PENDING" };
  throw new Error(`Capture ended in status ${cap.status}.`);
}
