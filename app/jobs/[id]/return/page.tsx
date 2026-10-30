import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isJobOwner } from "@/lib/auth/access";
import { authorizeJobOrder } from "@/lib/jobs/payment";
import { getPrincipalOrNull } from "@/lib/session";

/** Return URL for the full-page PayPal flow. PayPal appends `token` (the order id) and `PayerID`. */
export default async function PayPalReturn(props: PageProps<"/jobs/[id]/return">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const back = (key: "ok" | "error", text: string): never => redirect(`/jobs/${id}?${key}=${encodeURIComponent(text)}`);

  if (one(sp.cancelled)) back("error", "Payment cancelled. Nothing was charged; you can try again.");
  const who = await getPrincipalOrNull();
  if (!who) redirect(`/login?next=${encodeURIComponent(`/jobs/${id}`)}`);
  const job = await db.job.findUnique({ where: { id }, include: { device: true } });
  if (!job || !isJobOwner(who, job)) redirect("/owner");
  const token = one(sp.token);
  if (!token) back("error", "PayPal did not return an order. Nothing was charged.");

  const r = await authorizeJobOrder(id, token!);
  if (!r.ok) back("error", `${r.error ?? "Authorization failed."}${r.debugId ? ` (PayPal debug id ${r.debugId})` : ""}`);
  return back("ok", "Payment authorized. Funds are held until the repair is verified.");
}
