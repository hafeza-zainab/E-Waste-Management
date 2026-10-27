import { NextResponse } from "next/server";
import { DonationError, startDonation } from "@/lib/donations/service";

/** Validates the donation (zod), stores it and creates the PayPal order. The amount never comes from PayPal or the DOM. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const { publicId, order } = await startDonation(body);
    return NextResponse.json({ publicId, id: order.id, approveUrl: order.approveUrl, simulated: order.simulated });
  } catch (e) {
    if (e instanceof DonationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[donations] create failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not start the donation." }, { status: 500 });
  }
}
