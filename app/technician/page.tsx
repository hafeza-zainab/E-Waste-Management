import { db } from "@/lib/db";
import { getCurrentTechnician } from "@/lib/session";
import { Badge, Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/jobs/money";

export default async function TechnicianPage() {
  const tech = await getCurrentTechnician();
  const jobs = await db.job.findMany({
    where: { technicianId: tech.id },
    orderBy: { createdAt: "desc" },
    include: { device: true },
  });
  const earned = jobs.reduce((s, j) => s + (j.status === "payout_released" ? j.payoutCents : 0), 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{tech.name}</h1>
        <p className="text-muted">
          {tech.city} · rating {tech.rating.toFixed(1)} · skills: {tech.skills.replaceAll(",", ", ")}
        </p>
      </div>
      <Card>
        <p className="text-sm text-muted">Total paid out</p>
        <p className="text-3xl font-bold">{formatUsd(earned)}</p>
      </Card>
      <h2 className="text-xl font-bold">Jobs</h2>
      {jobs.length === 0 ? (
        <Card>No jobs assigned yet.</Card>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <Card className="flex flex-wrap items-center justify-between gap-2">
                <span>{j.device.brand} {j.device.model}</span>
                <span className="flex items-center gap-3">
                  <Badge tone="good">{j.status.replaceAll("_", " ")}</Badge>
                  <strong>{formatUsd(j.totalCents)}</strong>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
