import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DiagnosisSchema, type RepairPath } from "@/lib/ai/schemas";
import { createGuide, createQuote } from "../../actions";
import { Badge, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";

const PATH_INFO: Record<RepairPath, { label: string; text: string }> = {
  diy: { label: "Fix it yourself", text: "Safe enough for a careful DIY repair, with a stop-and-book escape at every step." },
  technician: { label: "Book a technician", text: "Best handled by a skilled local technician, paid securely and released only after the repair is verified." },
  refurbish: { label: "Refurbish", text: "The device still has useful life and can be refurbished for reuse." },
  donate: { label: "Donate", text: "Suitable for donation to a school or NGO through the Refurbish & Donate Fund." },
  recycle: { label: "Certified recycling", text: "Not worth repairing. Recover the materials through a certified recycler." },
};

const riskTone = { low: "good", medium: "warn", high: "bad" } as const;
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default async function DevicePage(props: PageProps<"/owner/device/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const device = await db.device.findUnique({ where: { id } });
  if (!device?.diagnosisJson) notFound();
  const d = DiagnosisSchema.parse(JSON.parse(device.diagnosisJson));
  const openJob = await db.job.findFirst({ where: { deviceId: id, status: { not: "payout_released" } } });
  const path = PATH_INFO[d.recommended_path];
  const partsTotal = d.estimated_parts.reduce((s, p) => s + p.price_usd, 0);
  const blocked = d.safety_risk.level === "high";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{device.type} · {device.ageYears} years old</p>
          <h1 className="text-3xl font-bold">{device.brand} {device.model}</h1>
          <p className="mt-1 max-w-2xl text-muted">&ldquo;{device.problem}&rdquo;</p>
        </div>
        <Badge>{device.diagnosisSource === "claude" ? "Live Claude diagnosis" : "Demo fixture"}</Badge>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>
      )}

      {blocked && (
        <section role="alert" className="rounded-2xl border-2 border-danger bg-red-50 p-5">
          <h2 className="text-lg font-bold text-danger">Safety stop: do not attempt a DIY repair</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-950">
            {d.safety_risk.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </section>
      )}

      <Card className="space-y-2">
        <h2 className="text-xl font-bold">Diagnosis</h2>
        <p>{d.summary}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge tone={d.severity === "minor" ? "good" : d.severity === "major" ? "warn" : "bad"}>Severity: {d.severity.replace("_", " ")}</Badge>
          <Badge tone={riskTone[d.safety_risk.level]}>Safety risk: {d.safety_risk.level}</Badge>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Likely causes</h2>
          <ul className="space-y-3">
            {d.likely_causes.map((c) => (
              <li key={c.cause}>
                <div className="flex justify-between gap-2 text-sm">
                  <span>{c.cause}</span>
                  <span className="font-semibold">{Math.round(c.confidence * 100)}%</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-primary-soft" role="presentation">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.round(c.confidence * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-bold">Estimated cost</h2>
          {d.estimated_parts.length === 0 && d.estimated_labor.cost_usd === 0 ? (
            <p className="text-sm text-muted">No repair recommended, so no repair cost.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {d.estimated_parts.map((p) => (
                <div key={p.name} className="flex justify-between gap-2"><dt>{p.name}</dt><dd>{usd(p.price_usd)}</dd></div>
              ))}
              <div className="flex justify-between gap-2"><dt>Labor ({d.estimated_labor.hours} h)</dt><dd>{usd(d.estimated_labor.cost_usd)}</dd></div>
              <div className="flex justify-between gap-2 border-t border-border pt-2 font-bold"><dt>Estimated total</dt><dd>{usd(partsTotal + d.estimated_labor.cost_usd)}</dd></div>
            </dl>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">Recommended path: {path.label}</h2>
        </div>
        <p>{path.text}</p>
        {d.gate_notes.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Safety gate (enforced in code)</p>
            <ul className="mt-1 list-disc pl-5">{d.gate_notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
        {d.recommended_path === "technician" &&
          (openJob ? (
            <Link href={`/jobs/${openJob.id}`} className={buttonVariants()}>View your booking</Link>
          ) : (
            <form action={createQuote} className="space-y-3 rounded-lg border border-border p-4">
              <input type="hidden" name="deviceId" value={device.id} />
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="pickup" className="h-5 w-5" />
                <span>Add pickup and delivery</span>
              </label>
              <SubmitButton pendingText="Building quote…">Get a quote and book</SubmitButton>
            </form>
          ))}
        {d.diy_allowed ? (
          <form action={createGuide}>
            <input type="hidden" name="deviceId" value={device.id} />
            {device.guideJson ? (
              <Link href={`/owner/device/${device.id}/guide`} className={buttonVariants({ variant: "outline" })}>Open DIY guide</Link>
            ) : (
              <SubmitButton pendingText="Writing guide…">Show me the DIY guide</SubmitButton>
            )}
          </form>
        ) : (
          <p className="text-sm font-medium">DIY is not offered for this device.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Environmental impact if kept out of the waste stream</h2>
        <p className="mt-1 text-sm">
          About <strong>{d.environmental_impact.ewaste_kg} kg</strong> of e-waste avoided and{" "}
          <strong>{d.environmental_impact.co2e_kg} kg CO2e</strong> saved ({d.environmental_impact.outcome}).
          Estimates use the constants in <code>lib/impact/constants.ts</code>.
        </p>
      </Card>
    </div>
  );
}
