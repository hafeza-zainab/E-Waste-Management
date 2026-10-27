import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseQuote } from "@/lib/jobs/service";
import { isJobStatus, STATUS_LABELS } from "@/lib/jobs/state-machine";
import { deviceLabel } from "@/lib/jobs/device-label";
import { formatUsd } from "@/lib/jobs/money";
import { simulationAllowed } from "@/lib/jobs/lifecycle";
import { isSimulatedId, paypalMode } from "@/lib/paypal/client";
import { payoutStatusNote } from "@/lib/paypal/webhook-handler";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JobTimeline } from "@/components/job-timeline";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { SimulateWebhook } from "@/components/simulate-webhook";
import { SafeImage } from "@/components/safe-image";
import { SubmitButton } from "@/components/submit-button";
import { cancelAction, confirmAction, rateAction, reportAction, retryPayoutAction, simulateApprovalAction } from "../actions";

const Simulated = () => <Badge tone="warn">SIMULATED</Badge>;

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const flash = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const job = await db.job.findUnique({
    where: { id },
    include: { device: true, technician: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!job || !isJobStatus(job.status)) notFound();
  const quote = parseQuote(job.quoteJson);
  const mode = paypalMode();
  // The SDK client id is the server's own app id: one source, so the browser and the server can never be on different PayPal apps.
  const clientId = mode === "sandbox" ? process.env.PAYPAL_CLIENT_ID || null : null;
  const authSimulated = job.authSimulated || isSimulatedId(job.paypalAuthId) || (mode === "simulated" && !!job.paypalAuthId);
  const payoutSimulated = job.payoutMode === "simulated";
  const canSimulateWebhook = job.status === "quoted" && !!job.paypalOrderId && (mode === "simulated" || process.env.NODE_ENV !== "production");
  const s = job.status;
  const held = ["paid", "accepted", "in_progress", "completed"].includes(s);
  const captured = !!job.paypalCaptureId;
  const unclaimedNote = job.payoutStatus ? payoutStatusNote(job.payoutStatus) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <div>
          <Link href={`/owner/device/${job.deviceId}`} className="text-sm text-primary underline">Back to diagnosis</Link>
          <h1 className="mt-1 text-3xl font-bold">{deviceLabel(job.device)} repair</h1>
          <p className="text-muted">
            {job.device.type} · Technician: {job.technician?.name ?? "unassigned"} · <Badge>{STATUS_LABELS[s]}</Badge>
          </p>
        </div>

        {flash("ok") && <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">{flash("ok")}</p>}
        {flash("error") && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{flash("error")}</p>}

        {quote && (
          <Card className="space-y-3">
            <h2 className="text-xl font-bold">Your quote</h2>
            <p className="text-sm text-muted">
              This is the price you pay. It can differ from the diagnosis <em>estimate</em>, which is only a rough AI guide: the quote uses the matched technician&apos;s real hourly rate.
            </p>
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
              <Link href={`/tech/${quote.technicianId}`} className="mt-2 inline-flex min-h-11 items-center text-primary underline">See {quote.technicianName}&apos;s verified profile</Link>
            </details>
          </Card>
        )}

        {s === "quoted" && (
          <Card className="space-y-3">
            <h2 className="text-xl font-bold">Approve and pay</h2>
            <p className="text-sm text-muted">
              Your payment is <strong>authorized, not captured</strong>: the money is held by PayPal and only taken when you confirm the repair is done.
            </p>
            {job.agentRunId ? (
              <p className="rounded-lg bg-primary-soft p-3 text-sm">
                The agent built this quote, so it can only be paid after you approve it in the agent. <Link className="font-semibold underline" href={`/agent?run=${job.agentRunId}`}>Review and approve in the agent</Link> (approvals expire after 15 minutes; ask the agent again if it has).
              </p>
            ) : (
              <PayPalCheckout jobId={job.id} clientId={clientId} />
            )}
            {canSimulateWebhook && <SimulateWebhook jobId={job.id} />}
            {simulationAllowed() && (
              <form action={simulateApprovalAction} className="rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3 text-sm">
                <input type="hidden" name="jobId" value={job.id} />
                <p className="mb-2 font-semibold">DEV ONLY: skip PayPal approval</p>
                <p className="mb-2">Marks the job paid with a fake authorization tagged SIMULATED. No money moves at PayPal.</p>
                <Button variant="outline" type="submit">Simulate buyer approval</Button>
              </form>
            )}
            <form action={cancelAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <Button variant="outline" type="submit">Cancel this booking</Button>
            </form>
          </Card>
        )}

        {s !== "quoted" && (
          <Card className="space-y-2">
            <h2 className="text-xl font-bold">Payment</h2>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {held && <Badge tone="good">Funds held</Badge>}
              {captured && <Badge tone="good">Captured</Badge>}
              {s === "cancelled" && <Badge>Hold released</Badge>}
              {s === "authorization_expired" && <Badge tone="bad">Hold expired, nothing charged</Badge>}
              {authSimulated && <Simulated />}
              <span className="text-muted">{authSimulated ? "simulated PayPal authorization" : "PayPal sandbox authorization"}</span>
            </p>
            <dl className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Order ID</dt>
              <dd className="break-all font-mono">{job.paypalOrderId}</dd>
              <dt className="text-muted">Authorization</dt>
              <dd className="break-all font-mono">{job.paypalAuthId}</dd>
              {job.paypalCaptureId && (
                <>
                  <dt className="text-muted">Capture</dt>
                  <dd className="break-all font-mono">{job.paypalCaptureId}</dd>
                </>
              )}
            </dl>
            {s === "authorization_expired" && (
              <p className="text-sm">
                PayPal holds last up to 29 days (guaranteed for the first 3). This one lapsed before the repair was confirmed, so you were not charged. Please <Link className="underline" href={`/owner/device/${job.deviceId}`}>book again</Link>.
              </p>
            )}
          </Card>
        )}

        {(job.proofPhotoPath || job.proofNotes) && (
          <Card className="space-y-2">
            <h2 className="text-xl font-bold">Proof of repair</h2>
            {job.proofPhotoPath && <SafeImage src={job.proofPhotoPath} alt="Photo of the finished repair uploaded by the technician" className="max-h-80 rounded-lg border border-border" />}
            {job.proofNotes && <p className="text-sm">{job.proofNotes}</p>}
          </Card>
        )}

        {s === "completed" && (
          <Card className="space-y-4">
            <h2 className="text-xl font-bold">Is the repair done?</h2>
            {job.problemReport ? (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                You reported: &ldquo;{job.problemReport}&rdquo;. Your payment is <strong>not</strong> captured. The technician must upload new proof before you can confirm.
              </p>
            ) : (
              <form action={confirmAction} className="space-y-2">
                <input type="hidden" name="jobId" value={job.id} />
                <p className="text-sm text-muted">Confirming captures your {formatUsd(job.totalCents)} payment and pays the technician {formatUsd(job.payoutCents)}.</p>
                <SubmitButton pendingText="Capturing payment…">Confirm repair is done</SubmitButton>
              </form>
            )}
            <form action={reportAction} className="space-y-2 border-t border-border pt-4">
              <input type="hidden" name="jobId" value={job.id} />
              <label htmlFor="problem" className="text-sm font-medium">Something wrong? Report a problem (blocks the payment)</label>
              <textarea id="problem" name="problem" rows={2} minLength={5} maxLength={1000} required className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-base" />
              <Button variant="outline" type="submit">Report a problem</Button>
            </form>
          </Card>
        )}

        {(s === "customer_confirmed" || s === "payout_failed" || s === "payout_released") && (
          <Card className="space-y-2">
            <h2 className="text-xl font-bold">Technician payout</h2>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={s === "payout_released" ? "good" : s === "payout_failed" ? "bad" : "warn"}>{STATUS_LABELS[s]}</Badge>
              {payoutSimulated && <Simulated />}
              <strong>{formatUsd(job.payoutCents)}</strong> to {job.technician?.name}
            </p>
            <dl className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
              {job.payoutBatchId && (<><dt className="text-muted">Batch ID</dt><dd className="break-all font-mono">{job.payoutBatchId}</dd></>)}
              {job.payoutItemId && (<><dt className="text-muted">Item ID</dt><dd className="break-all font-mono">{job.payoutItemId}</dd></>)}
              {job.payoutStatus && (<><dt className="text-muted">PayPal status</dt><dd>{job.payoutStatus}</dd></>)}
            </dl>
            {job.payoutNote && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{job.payoutNote}</p>}
            {unclaimedNote && job.payoutStatus === "UNCLAIMED" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{unclaimedNote}</p>}
            {job.payoutError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{job.payoutError}</p>}
            {(s === "payout_failed" || s === "customer_confirmed") && (
              <form action={retryPayoutAction} className="space-y-1">
                <input type="hidden" name="jobId" value={job.id} />
                <p className="text-sm text-muted">Your payment is already captured and safe. Retrying cannot pay twice.</p>
                <SubmitButton pendingText="Retrying…">Retry payout</SubmitButton>
              </form>
            )}
          </Card>
        )}

        {s === "payout_released" && !job.customerRating && (
          <Card className="space-y-2">
            <h2 className="text-lg font-bold">Rate {job.technician?.name}</h2>
            <form action={rateAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="jobId" value={job.id} />
              <label htmlFor="rating" className="sr-only">Rating</label>
              <select id="rating" name="rating" defaultValue="5" className="min-h-11 rounded-lg border border-border bg-white px-2">
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
              </select>
              <SubmitButton pendingText="Saving…">Submit rating</SubmitButton>
            </form>
          </Card>
        )}
      </div>

      <aside>
        <Card>
          <h2 className="mb-4 text-lg font-bold">Progress</h2>
          <JobTimeline status={s} events={job.events} />
        </Card>
      </aside>
    </div>
  );
}
