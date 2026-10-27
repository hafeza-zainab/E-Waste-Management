import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { verifiedRepairsFor } from "@/lib/profile/queries";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";

export async function generateMetadata(props: PageProps<"/tech/[id]">): Promise<Metadata> {
  const t = await db.technician.findUnique({ where: { id: (await props.params).id }, select: { name: true } });
  return { title: t ? `${t.name} - verified repair profile | ReLoop` : "Technician not found" };
}

/** Public profile: no login, no emails, no payer ids, shortened payout references only. */
export default async function TechProfile(props: PageProps<"/tech/[id]">) {
  const { id } = await props.params;
  const tech = await db.technician.findUnique({
    where: { id },
    select: { id: true, name: true, city: true, bio: true, skills: true, rating: true, isTrainee: true },
  });
  if (!tech) notFound();
  const repairs = await verifiedRepairsFor(id);
  const rated = repairs.filter((r) => r.rating > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{tech.name}</h1>
          <p className="text-muted">{tech.city} · rating {tech.rating.toFixed(1)} {tech.isTrainee && <Badge>Trainee, supervised</Badge>}</p>
          <p className="mt-2 max-w-2xl">{tech.bio}</p>
        </div>
        <a href={`/tech/${tech.id}/cv`} className={buttonVariants()} download>Download Verified Repair CV</a>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Card><dt className="text-sm text-muted">Verified repairs</dt><dd className="text-3xl font-bold text-primary">{repairs.length}</dd></Card>
        <Card>
          <dt className="text-sm text-muted">Skills</dt>
          <dd className="mt-1 flex flex-wrap gap-2">{tech.skills.split(",").map((s) => <Badge key={s}>{s.trim()}</Badge>)}</dd>
        </Card>
        <Card>
          <dt className="text-sm text-muted">Customer ratings</dt>
          <dd className="text-3xl font-bold text-primary">{rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : "none yet"}</dd>
        </Card>
      </dl>

      <section aria-labelledby="repairs" className="space-y-3">
        <h2 id="repairs" className="text-xl font-bold">Verified repairs</h2>
        <p className="text-sm text-muted">Listed only after the customer confirmed the repair and PayPal paid the technician. Entries tagged demo are seeded or simulated.</p>
        {repairs.length === 0 ? (
          <Card className="text-sm text-muted">No verified repairs yet. They appear here once a customer confirms a finished repair and the payout is released.</Card>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr><th className="p-3">Device</th><th className="p-3">Repair</th><th className="p-3">Date</th><th className="p-3">Rating</th><th className="p-3">Payout ref</th></tr>
              </thead>
              <tbody>
                {repairs.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-3 capitalize">{r.deviceType}</td>
                    <td className="p-3">{r.repairType}</td>
                    <td className="p-3">{r.date.toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                    <td className="p-3">{r.rating > 0 ? `${r.rating} / 5` : "pending"}</td>
                    <td className="p-3 font-mono">{r.payoutRef} {r.demo && <Badge tone="warn">demo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
