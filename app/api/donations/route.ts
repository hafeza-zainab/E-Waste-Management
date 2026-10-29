import { NextResponse } from "next/server";
import { bodyTooLarge, rateLimitResponse } from "@/lib/security/rate-limit";
import { log } from "@/lib/log";
import { blockPaypalDuringTour } from "@/lib/tour/paypal-guard";
import { DonationError, startDonation } from "@/lib/donations/service";

/** Validates the donation (zod), stores it and creates the PayPal order. The amount never comes from PayPal or the DOM. */
export async function POST(req: Request) {
  const blocked = await blockPaypalDuringTour("/api/donations");
  if (blocked) return blocked;
  const limited = rateLimitResponse(req, "donation");
  if (limited) return limited;
  const tooBig = bodyTooLarge(req, 10_000);
  if (tooBig) return tooBig;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const { publicId, order } = await startDonation(body);
    return NextResponse.json({ publicId, id: order.id, approveUrl: order.approveUrl, simulated: order.simulated });
  } catch (e) {
    if (e instanceof DonationError) return NextResponse.json({ error: e.message }, { status: 400 });
    log.error("donation_create_failed", { error: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "Could not start the donation." }, { status: 500 });
  }
}
