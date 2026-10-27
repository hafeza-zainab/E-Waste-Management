import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/log";
import { rateLimitResponse } from "@/lib/security/rate-limit";

const Body = z.object({
  name: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
  debugId: z.string().max(100).optional(),
  jobId: z.string().max(60).optional(),
});

/** Receives the browser-side PayPal SDK error so its debug id shows up in the server log. Non-secret fields only. */
export async function POST(req: Request) {
  const limited = rateLimitResponse(req, "clientError");
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { name, message, debugId, jobId } = parsed.data;
  const oneLine = (s?: string) => (s ?? "n/a").replace(/[\r\n]+/g, " ");
  log.error("paypal_client_error", { jobId: oneLine(jobId), name: oneLine(name), debug_id: oneLine(debugId), message: oneLine(message) });
  return NextResponse.json({ logged: true });
}
