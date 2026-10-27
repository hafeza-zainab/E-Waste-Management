import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseQuote } from "@/lib/jobs/service";
import { isJobStatus } from "@/lib/jobs/state-machine";
import { formatUsd } from "@/lib/jobs/money";
import { isSimulatedId, paypalMode } from "@/lib/paypal/client";
import { Badge, Card } from "@/components/ui/card";
import { JobTimeline } from "@/components/job-timeline";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { SimulateWebhook } from "@/components/simulate-webhook";

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  const job = await db.job.findUnique({
    where: { id },
    include: { device: true, technician: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!job || !isJobStatus(job.status)) notFound();
  const quote = parseQuote(job.quoteJson);
  const mode = paypalMode();
  const clientId = mode === "sandbox" ? (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || null) : null;
  const simulated = isSimulatedId(job.paypalOrderId) || mode === "simulated";
  const canSimulateWebhook = job.status === "quoted" && !!job.paypalOrderId && (mode === "simulated" || process.env.NODE_ENV !== "production");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <div>
          <Link href={`/owner/device/${job.deviceId}`} className="text-sm text-primary underline">Back to diagnosis</Link>
          <h1 className="mt-1 text-3xl font-bold">{job.device.brand} {job.device.model} repair</h1>
          <p className="text-muted">Technician: {job.technician?.name ?? "unassigned"}</p>
        </div>

        {quote && (
          <Card className="space-y-3">
            <h2 className="text-xl font-bold">Your quote</h2>
            <ul className="divide-y divide-border text-sm">
              {quote.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-3 py-2">
                  <span>{l.label}</span>
                  <span>{formatUsd(l.cents)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 py-2 text-base font-bold">
                <span>Total</span>
                <span>{formatUsd(quote.totalCents)}</span>
              </li>
            </ul>
            <p className="rounded-lg bg-primary-soft p-3 text-sm">
              How the money moves: the technician receives <strong>{formatUsd(quote.technicianPayoutCents)}</strong> after a{" "}
              <strong>{formatUsd(quote.platformFeeCents)}</strong> platform fee, and only once you confirm the repair.
            </p>
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">Why {quote.technicianName}?</summary>
              <ul className="list-disc pl-5 text-muted">{quote.matchReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </details>
          </Card>
        )}

        {job.status === "quoted" ? (
          <Card className="space-y-3">
            <h2 className="text-xl font-bold">Approve and pay</h2>
            <p className="text-sm text-muted">
              Your payment is <strong>authorized, not captured</strong>: the money is held by PayPal and only taken when you confirm the repair is done.
            </p>
            <PayPalCheckout jobId={job.id} clientId={clientId} />
            {canSimulateWebhook && <SimulateWebhook jobId={job.id} />}
          </Card>
        ) : (
          <Card className="space-y-2">
            <h2 className="text-xl font-bold">Payment</h2>
            <p className="text-sm">
              <Badge tone="good">Funds held</Badge>{" "}
              <span className="text-muted">{simulated ? "simulated PayPal authorization" : "PayPal sandbox authorization"}</span>
            </p>
            <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted">Order ID</dt>
              <dd className="break-all font-mono">{job.paypalOrderId}</dd>
              <dt className="text-muted">Authorization</dt>
              <dd className="break-all font-mono">{job.paypalAuthId}</dd>
            </dl>
          </Card>
        )}
      </div>

      <aside>
        <Card>
          <h2 className="mb-4 text-lg font-bold">Progress</h2>
          <JobTimeline status={job.status} events={job.events} />
        </Card>
      </aside>
    </div>
  );
}
