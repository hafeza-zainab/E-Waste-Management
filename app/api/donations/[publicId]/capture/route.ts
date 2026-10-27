import { NextResponse } from "next/server";
import { z } from "zod";
import { captureDonation } from "@/lib/donations/service";

const Body = z.object({ orderId: z.string().min(1).max(100) });

export async function POST(req: Request, ctx: RouteContext<"/api/donations/[publicId]/capture">) {
  const { publicId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await captureDonation(publicId, parsed.data.orderId);
  return NextResponse.json(r, { status: r.status === "failed" ? 502 : 200 });
}
