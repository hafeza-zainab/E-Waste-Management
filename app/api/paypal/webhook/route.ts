import { NextResponse } from "next/server";
import { processWebhookEvent } from "@/lib/paypal/webhook-handler";
import { verifyWebhook, type WebhookEvent } from "@/lib/paypal/webhooks";

/** PayPal sandbox webhook endpoint. Rejects anything whose signature PayPal does not verify. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyWebhook(req.headers, raw))) {
    return NextResponse.json({ error: "Signature verification failed." }, { status: 401 });
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!event.id || !event.event_type) return NextResponse.json({ error: "Malformed event." }, { status: 400 });
  const result = await processWebhookEvent(event, false);
  return NextResponse.json({ result });
}
