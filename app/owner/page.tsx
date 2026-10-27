import Link from "next/link";
import { db } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">My devices</h1>
        <Link href="/owner/new" className={buttonVariants()}>Diagnose a device</Link>
      </div>
      {devices.length === 0 ? (
        <Card>No devices yet. Diagnose your first device to get started.</Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Card className="h-full space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">
                    {d.diagnosisJson ? (
                      <Link href={`/owner/device/${d.id}`} className="underline">{d.brand} {d.model}</Link>
                    ) : (
                      <>{d.brand} {d.model}</>
                    )}
                  </h2>
                  <Badge>{d.type}</Badge>
                </div>
                <p className="text-sm text-muted">{d.ageYears} years old</p>
                <p className="text-sm">{d.problem}</p>
                {d.jobs.map((j) => (
                  <p key={j.id} className="text-sm">
                    <Badge tone="good">{j.status.replaceAll("_", " ")}</Badge> {formatUsd(j.totalCents)} ·{" "}
                    {j.technician?.name} ·{" "}
                    <Link href={`/jobs/${j.id}`} className="font-medium text-primary underline">
                      {j.status === "payout_released" ? "View completed repair" : "View job"}
                    </Link>
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
