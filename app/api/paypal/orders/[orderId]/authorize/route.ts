import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeJobOrder } from "@/lib/jobs/payment";

const Body = z.object({ jobId: z.string().min(1) });

/** Authorizes (holds) the approved order and moves the job quoted -> paid. Capture happens on verified completion. */
export async function POST(req: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]/authorize">) {
  const { orderId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await authorizeJobOrder(parsed.data.jobId, orderId);
  const { httpStatus, ok, ...rest } = r;
  void ok;
  return NextResponse.json(rest, { status: httpStatus });
}
