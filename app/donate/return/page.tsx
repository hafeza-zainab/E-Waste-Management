import { redirect } from "next/navigation";
import { z } from "zod";
import { captureDonation } from "@/lib/donations/service";

const Query = z.object({ d: z.string().uuid(), token: z.string().max(100).optional(), cancelled: z.string().optional() });

/** Return URL for the full-page PayPal flow. PayPal appends `token` (the order id). Captures server-side, exactly once. */
export default async function DonateReturn(props: PageProps<"/donate/return">) {
  const sp = await props.searchParams;
  const q = Query.safeParse({ d: sp.d, token: sp.token, cancelled: sp.cancelled });
  const fail = (m: string): never => redirect(`/donate?error=${encodeURIComponent(m)}`);
  if (!q.success) return fail("That donation link is not valid.");
  if (q.data.cancelled) return fail("Donation cancelled. Nothing was charged.");
  if (!q.data.token) return fail("PayPal did not return an order. Nothing was charged.");
  const r = await captureDonation(q.data.d, q.data.token);
  if (r.status === "failed") return fail(`${r.error ?? "The donation failed."}${r.debugId ? ` (PayPal debug id ${r.debugId})` : ""}`);
  return redirect(`/donate/thanks/${q.data.d}`);
}
