import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/jobs/money";

export default async function ImpactPage() {
  const [events, repairs, jobs, donations] = await Promise.all([
    db.impactEvent.aggregate({ _sum: { ewasteKg: true, co2eKg: true }, _count: true }),
    db.verifiedRepair.count(),
    db.job.aggregate({ where: { status: "payout_released" }, _sum: { payoutCents: true } }),
    db.donation.aggregate({ _sum: { amountCents: true } }),
  ]);
  const stats = [
    { label: "Devices diverted", value: String(events._count) },
    { label: "E-waste avoided", value: `${(events._sum.ewasteKg ?? 0).toFixed(1)} kg` },
    { label: "CO2e saved", value: `${(events._sum.co2eKg ?? 0).toFixed(0)} kg` },
    { label: "Repairs completed", value: String(repairs) },
    { label: "Technician earnings", value: formatUsd(jobs._sum.payoutCents ?? 0) },
    { label: "Donations raised", value: formatUsd(donations._sum.amountCents ?? 0) },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Impact</h1>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="text-3xl font-bold text-primary">{s.value}</dd>
          </Card>
        ))}
      </dl>
      <p className="text-sm text-muted">Estimates use the transparent constants in lib/impact/constants.ts.</p>
    </div>
  );
}
