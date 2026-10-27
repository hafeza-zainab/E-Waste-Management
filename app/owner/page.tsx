import { db } from "@/lib/db";
import { getDemoOwner } from "@/lib/session";
import { Badge, Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/jobs/money";

export default async function OwnerPage() {
  const owner = await getDemoOwner();
  const devices = await db.device.findMany({
    where: { ownerId: owner.id },
    orderBy: { createdAt: "desc" },
    include: { jobs: { include: { technician: true } } },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">My devices</h1>
      {devices.length === 0 ? (
        <Card>No devices yet.</Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Card className="h-full space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{d.brand} {d.model}</h2>
                  <Badge>{d.type}</Badge>
                </div>
                <p className="text-sm text-muted">{d.ageYears} years old</p>
                <p className="text-sm">{d.problem}</p>
                {d.jobs.map((j) => (
                  <p key={j.id} className="text-sm">
                    <Badge tone="good">{j.status.replaceAll("_", " ")}</Badge> {formatUsd(j.totalCents)} ·{" "}
                    {j.technician?.name}
                  </p>
                ))}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
