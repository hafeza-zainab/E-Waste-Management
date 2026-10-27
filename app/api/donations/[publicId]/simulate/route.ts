import { NextResponse } from "next/server";
import { DonationError, simulateDonationApproval } from "@/lib/donations/service";

/** DEV ONLY (404 in production). Completes a donation as SIMULATED without contacting PayPal. */
export async function POST(_req: Request, ctx: RouteContext<"/api/donations/[publicId]/simulate">) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not available." }, { status: 404 });
  const { publicId } = await ctx.params;
  try {
    return NextResponse.json(await simulateDonationApproval(publicId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof DonationError ? e.message : "Failed." }, { status: 400 });
  }
}
