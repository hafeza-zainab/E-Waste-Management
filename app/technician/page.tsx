import Link from "next/link";
import { db } from "@/lib/db";
import { requirePrincipal } from "@/lib/session";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { deviceLabel } from "@/lib/jobs/device-label";
import { formatUsd, platformFeeBps } from "@/lib/jobs/money";
import { STATUS_LABELS, type JobStatus } from "@/lib/jobs/state-machine";
import { acceptAction, completeAction, declineAction, reuploadProofAction, startAction } from "../jobs/actions";

const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-base";
const SIM = <Badge tone="warn">SIMULATED</Badge>;
const TOUR = <Badge tone="warn">Tour simulation</Badge>;

function Money({ j, pct }: { j: { totalCents: number; platformFeeCents: number; payoutCents: number }; pct: number }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-muted">Job total</dt><dd className="font-semibold">{formatUsd(j.totalCents)}</dd></div>
      <div><dt className="text-muted">Platform fee</dt><dd>{formatUsd(j.platformFeeCents)}</dd></div>
      <div><dt className="text-muted">Your payout ({pct}%)</dt><dd className="font-semibold">{formatUsd(j.payoutCents)}</dd></div>
    </dl>
  );
}

export const metadata = { title: "Technician dashboard" };

export default async function TechnicianPage() {
  const who = await requirePrincipal("technician", "/technician");
  const tech = await db.technician.findUniqueOrThrow({ where: { id: who.techId } });
  const jobs = await db.job.findMany({
    // A tour identity sees only its own run's jobs (tagged below); a real account never sees tour jobs.
    where: { technicianId: tech.id, status: { not: "quoted" }, ...(who.tourRunId ? { tourRunId: who.tourRunId } : { isTour: false }) },
    orderBy: { createdAt: "desc" },
    include: { device: true },
  });
  const pct = 100 - platformFeeBps() / 100;
  const incoming = jobs.filter((j) => j.status === "paid");
  const active = jobs.filter((j) => ["accepted", "in_progress"].includes(j.status));
  const waiting = jobs.filter((j) => ["completed", "customer_confirmed", "payout_failed"].includes(j.status));
  const closed = jobs.filter((j) => ["payout_released", "cancelled", "authorization_expired"].includes(j.status));
  const released = closed.filter((j) => j.status === "payout_released");
  // Earnings never include guided-demo (TOUR-SIMULATED) jobs.
  const paidOut = released.filter((j) => !j.isTour).reduce((s, j) => s + j.payoutCents, 0);
  const pending = [...active, ...waiting, ...incoming].filter((j) => !j.isTour).reduce((s, j) => s + j.payoutCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{tech.name}</h1>
        <p className="text-muted">
          {tech.city} · rating {tech.rating.toFixed(1)} · skills: {tech.skills.replaceAll(",", ", ")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Total paid out ({released.filter((j) => !j.isTour).length} job{released.filter((j) => !j.isTour).length === 1 ? "" : "s"}, your {pct}% share)</p>
          <p className="text-3xl font-bold">{formatUsd(paidOut)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Pending payout (open jobs)</p>
          <p className="text-3xl font-bold">{formatUsd(pending)}</p>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Incoming jobs (paid, waiting for you)</h2>
        {incoming.length === 0 && <Card className="text-sm text-muted">No paid jobs waiting.</Card>}
        {incoming.map((j) => (
          <Card key={j.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{deviceLabel(j.device)} <span className="font-normal text-muted">({j.device.type})</span></strong>
              <span className="flex gap-2">{j.isTour ? TOUR : j.authSimulated && SIM}<Badge tone="good">funds held</Badge></span>
            </div>
            <p className="text-sm">{j.device.problem}</p>
            <Money j={j} pct={pct} />
            <div className="flex flex-wrap gap-2">
              <form action={acceptAction} data-tour="accept-form" data-job-id={j.id}><input type="hidden" name="jobId" value={j.id} /><SubmitButton tour="accept" pendingText="Accepting…">Accept</SubmitButton></form>
              <form action={declineAction}><input type="hidden" name="jobId" value={j.id} /><Button variant="outline" type="submit">Decline</Button></form>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">In progress</h2>
        {active.length === 0 && <Card className="text-sm text-muted">Nothing in progress.</Card>}
        {active.map((j) => (
          <Card key={j.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{deviceLabel(j.device)}</strong>
              <span className="flex gap-2">{j.isTour && TOUR}<Badge>{STATUS_LABELS[j.status as JobStatus]}</Badge></span>
            </div>
            <Money j={j} pct={pct} />
            {j.status === "accepted" ? (
              <form action={startAction} data-tour="start-form" data-job-id={j.id}><input type="hidden" name="jobId" value={j.id} /><SubmitButton tour="start" pendingText="Starting…">Mark in progress</SubmitButton></form>
            ) : (
              <form action={completeAction} className="space-y-3" data-tour="complete-form" data-job-id={j.id}>
                <input type="hidden" name="jobId" value={j.id} />
                <div className="space-y-1">
                  <label htmlFor={`photo-${j.id}`} className="font-medium">Proof photo (required)</label>
                  <input id={`photo-${j.id}`} data-tour="proof-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full text-sm" />
                  <p className="text-sm text-muted">JPEG, PNG or WebP, up to 4 MB.</p>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`notes-${j.id}`} className="font-medium">What did you do?</label>
                  <textarea id={`notes-${j.id}`} data-tour="proof-notes" name="notes" rows={3} minLength={5} maxLength={1000} required className={field} />
                </div>
                <SubmitButton tour="complete" pendingText="Uploading…">Mark complete</SubmitButton>
              </form>
            )}
          </Card>
        ))}
      </section>

      {waiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Waiting on the owner or on PayPal</h2>
          {waiting.map((j) => (
            <Card key={j.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/jobs/${j.id}`} className="inline-flex min-h-11 items-center font-semibold underline">{deviceLabel(j.device)}</Link>
                <Badge tone={j.status === "payout_failed" ? "bad" : "warn"}>{STATUS_LABELS[j.status as JobStatus]}</Badge>
              </div>
              <Money j={j} pct={pct} />
              {j.problemReport && (
                <form action={reuploadProofAction} className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                  <input type="hidden" name="jobId" value={j.id} />
                  <p className="font-semibold">The owner reported a problem: &ldquo;{j.problemReport}&rdquo;</p>
                  <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full" aria-label="New proof photo" />
                  <textarea name="notes" rows={2} maxLength={1000} placeholder="What you fixed" className={field} />
                  <SubmitButton pendingText="Uploading…">Upload new proof</SubmitButton>
                </form>
              )}
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">History</h2>
        {closed.length === 0 && <Card className="text-sm text-muted">No finished jobs yet.</Card>}
        {closed.map((j) => (
          <Card key={j.id} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/jobs/${j.id}`} className="inline-flex min-h-11 items-center font-semibold underline">{deviceLabel(j.device)}</Link>
              <span className="flex gap-2">
                {j.payoutMode === "simulated" && SIM}
                <Badge tone={j.status === "payout_released" ? "good" : "neutral"}>{STATUS_LABELS[j.status as JobStatus]}</Badge>
              </span>
            </div>
            <Money j={j} pct={pct} />
          </Card>
        ))}
      </section>
    </div>
  );
}
