import { db } from "@/lib/db";
import { PayPalError, paypalMode } from "@/lib/paypal/client";
import { captureDonationOrder, createDonationOrder, newSimulatedDonationOrder, type DonationOrder } from "@/lib/paypal/donations";
import { DonationInputSchema } from "./amount";

export type DonationMode = "sandbox" | "simulated" | "unavailable";

/** Dev-only simulated approval switch (same rule as jobs): never in production. */
export const donationSimulationAllowed = () => process.env.NODE_ENV !== "production" && process.env.PAYPAL_SIMULATE_APPROVAL === "true";

/**
 * sandbox     = real PayPal sandbox credentials.
 * simulated   = no credentials, outside production: local labelled simulation.
 * unavailable = no credentials in production: donations are switched off rather than faked.
 */
export function donationMode(): DonationMode {
  if (paypalMode() === "sandbox") return "sandbox";
  return process.env.NODE_ENV === "production" ? "unavailable" : "simulated";
}

export class DonationError extends Error {}

/** Validates input, stores a `created` donation and opens a PayPal order for it (one donation row per attempt). */
export async function startDonation(raw: unknown): Promise<{ publicId: string; order: DonationOrder }> {
  const parsed = DonationInputSchema.safeParse(raw);
  if (!parsed.success) throw new DonationError(parsed.error.issues[0]?.message ?? "Please check the form.");
  const mode = donationMode();
  if (mode === "unavailable") throw new DonationError("Donations are not available right now.");
  const { amount, donorName, message, deviceId } = parsed.data;

  const donation = await db.donation.create({
    data: { amountCents: amount, donorName: donorName || "Anonymous", message, deviceId, simulated: mode === "simulated" },
  });
  try {
    const order = mode === "sandbox" ? await createDonationOrder(donation.publicId, amount) : newSimulatedDonationOrder();
    await db.donation.update({ where: { id: donation.id }, data: { paypalOrderId: order.id } });
    return { publicId: donation.publicId, order };
  } catch (e) {
    await db.donation.delete({ where: { id: donation.id } }).catch(() => {});
    throw e instanceof PayPalError ? new DonationError(`PayPal error: ${e.message}`) : e;
  }
}

export interface CaptureResult {
  status: "completed" | "pending" | "failed";
  publicId: string;
  error?: string;
  debugId?: string;
}

/**
 * Capture exactly once. A stored completed donation returns as-is; a conditional claim
 * (created -> capturing) lets only one concurrent request call PayPal, and the capture
 * request id is derived from the donation so even a lost response cannot double-capture.
 */
export async function captureDonation(publicId: string, orderId: string): Promise<CaptureResult> {
  const d = await db.donation.findUnique({ where: { publicId } });
  if (!d || d.paypalOrderId !== orderId) return { status: "failed", publicId, error: "That order does not belong to this donation." };
  if (d.status === "completed" || d.status === "pending") return { status: d.status, publicId };

  const claim = await db.donation.updateMany({ where: { id: d.id, status: "created" }, data: { status: "capturing" } });
  if (claim.count === 0) {
    const now = await db.donation.findUnique({ where: { id: d.id } });
    return { status: now?.status === "completed" ? "completed" : "pending", publicId };
  }
  try {
    const cap = await captureDonationOrder(orderId, publicId);
    const status = cap.status === "COMPLETED" ? "completed" : "pending";
    await db.donation.update({ where: { id: d.id }, data: { status, paypalCaptureId: cap.captureId, capturedAt: status === "completed" ? new Date() : null } });
    return { status, publicId };
  } catch (e) {
    await db.donation.updateMany({ where: { id: d.id, status: "capturing" }, data: { status: "created" } }); // allow a retry
    if (e instanceof PayPalError) return { status: "failed", publicId, error: `PayPal could not take the donation: ${e.message}`, debugId: e.debugId };
    return { status: "failed", publicId, error: e instanceof Error ? e.message : "Donation failed." };
  }
}

/** DEV ONLY: completes a donation without PayPal. Tagged simulated; never in production. */
export async function simulateDonationApproval(publicId: string): Promise<CaptureResult> {
  if (!donationSimulationAllowed() && !(donationMode() === "simulated")) throw new DonationError("Not available.");
  if (process.env.NODE_ENV === "production") throw new DonationError("Not available.");
  const d = await db.donation.findUnique({ where: { publicId } });
  if (!d) throw new DonationError("Donation not found.");
  if (d.status === "completed") return { status: "completed", publicId };
  const claim = await db.donation.updateMany({
    where: { id: d.id, status: "created" },
    data: { status: "completed", simulated: true, paypalOrderId: d.paypalOrderId ?? `SIM-DORDER-${publicId}`, paypalCaptureId: `SIM-DCAP-${publicId}`, capturedAt: new Date() },
  });
  void claim;
  return { status: "completed", publicId };
}

/** Certificates exist only for completed (captured or simulated) donations. */
export const certificateAvailable = (d: { status: string; paypalCaptureId: string | null }) => d.status === "completed" && !!d.paypalCaptureId;
