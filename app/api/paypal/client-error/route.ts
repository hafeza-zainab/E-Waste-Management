import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  name: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
  debugId: z.string().max(100).optional(),
  jobId: z.string().max(60).optional(),
});

/** Receives the browser-side PayPal SDK error so its debug id shows up in the server log. Non-secret fields only. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { name, message, debugId, jobId } = parsed.data;
  const oneLine = (s?: string) => (s ?? "n/a").replace(/[\r\n]+/g, " ");
  console.error(`[paypal-client] job=${oneLine(jobId)} error=${oneLine(name)} debug_id=${oneLine(debugId)} message=${oneLine(message)}`);
  return NextResponse.json({ logged: true });
}
