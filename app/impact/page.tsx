import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { DonationsChart, PathBarChart } from "@/components/impact-charts";
import { formatUsd } from "@/lib/jobs/money";
import { CONSTANT_DOCS } from "@/lib/impact/constants";
import { computeTotals, donationsByDay } from "@/lib/impact/totals";

export const metadata = { title: "Impact" };

export default async function ImpactPage() {
  const [events, repairs, jobs, donations, pickups] = await Promise.all([
    db.impactEvent.findMany({ select: { deviceId: true, outcome: true, ewasteKg: true, co2eKg: true, demo: true } }),
    db.verifiedRepair.count({ where: { job: { status: "payout_released" } } }),
    db.job.aggregate({ where: { status: "payout_released" }, _sum: { payoutCents: true } }),
    db.donation.findMany({ where: { status: "completed" }, select: { amountCents: true, capturedAt: true, createdAt: true, simulated: true } }),
    db.recyclingPickup.count(),
  ]);
  const t = computeTotals(events);
  const raised = donations.reduce((s, d) => s + d.amountCents, 0);
  const demoJobs = await db.job.count({ where: { status: "payout_released", NOT: { payoutMode: "paypal_sandbox" } } });
  const includesDemo = t.includesDemo || demoJobs > 0 || donations.some((d) => d.simulated) || pickups > 0;

  const stats = [
    { label: "Devices diverted", value: String(t.devices) },
    { label: "E-waste avoided", value: `${t.ewasteKg.toFixed(1)} kg` },
    { label: "CO2e saved", value: `${t.co2eKg.toFixed(0)} kg` },
    { label: "Repairs completed", value: String(repairs) },
    { label: "Technician earnings paid", value: formatUsd(jobs._sum.payoutCents ?? 0) },
    { label: "Donations raised", value: formatUsd(raised) },
    { label: "Recycling pickups", value: String(pickups) },
  ];
  const paths = (["repair", "refurbish", "donate", "recycle"] as const).map((o) => ({ label: o, value: t.byOutcome[o] ?? 0 }));
  const points = donationsByDay(donations.map((d) => ({ amountCents: d.amountCents, at: d.capturedAt ?? d.createdAt })));

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Impact</h1>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="text-3xl font-bold text-primary">{s.value}</dd>
          </Card>
        ))}
      </dl>
      {includesDemo && <p className="text-sm text-muted">* Includes demo data: seeded, simulated or demo-partner records.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="text-lg font-bold">Devices by outcome</h2>
          {t.devices === 0 ? <p className="text-sm text-muted">No devices diverted yet.</p> : <PathBarChart data={paths} />}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-bold">Donations over time</h2>
          <DonationsChart points={points} />
        </Card>
      </div>

      <section aria-labelledby="how" className="space-y-3">
        <h2 id="how" className="text-xl font-bold">How we calculate this</h2>
        <p className="text-sm">
          Each device is counted <strong>once</strong>, under the outcome that finished its journey. Keeping a device in use (repair, refurbish, donate) counts its whole mass as e-waste avoided plus a fraction of a replacement&apos;s manufacturing CO2e.
          Recycling counts the collected share of its mass, with a per-kg CO2e saving. Donations convert to &ldquo;devices funded&rdquo; at the subsidy below.
        </p>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          <strong>None of these figures has a verified source.</strong> They are illustrative estimates for a demo, not measurements. Replace them in <code>lib/impact/constants.ts</code> with cited values before making real claims.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Constants used in impact calculations</caption>
            <thead className="border-b border-border text-muted"><tr><th className="p-3">Constant</th><th className="p-3">Value</th><th className="p-3">Meaning</th><th className="p-3">Source</th></tr></thead>
            <tbody>
              {CONSTANT_DOCS.map((c) => (
                <tr key={c.name} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{c.name}</td><td className="p-3">{c.value}</td><td className="p-3">{c.meaning}</td><td className="p-3">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
