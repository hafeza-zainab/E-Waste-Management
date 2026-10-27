import { db } from "@/lib/db";
import { publicDonorName } from "@/lib/donations/amount";
import { donationMode, donationSimulationAllowed } from "@/lib/donations/service";
import { DEMO_BENEFICIARY, FUND_GOAL_CENTS, REFURB_SUBSIDY_CENTS_PER_DEVICE } from "@/lib/impact/constants";
import { formatUsd } from "@/lib/jobs/money";
import { Badge, Card } from "@/components/ui/card";
import { DonateForm } from "@/components/donate-form";

export const metadata = { title: "Refurbish & Donate Fund | ReLoop" };

export default async function DonatePage(props: PageProps<"/donate">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : undefined;
  const deviceId = typeof sp.deviceId === "string" ? sp.deviceId.slice(0, 40) : undefined;
  const [sum, recent] = await Promise.all([
    db.donation.aggregate({ where: { status: "completed" }, _sum: { amountCents: true }, _count: true }),
    db.donation.findMany({ where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, donorName: true, amountCents: true, message: true, simulated: true } }),
  ]);
  const raised = sum._sum.amountCents ?? 0;
  const pct = Math.min(100, Math.round((raised / FUND_GOAL_CENTS) * 100));
  const mode = donationMode();
  const clientId = mode === "sandbox" ? process.env.PAYPAL_CLIENT_ID || null : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Refurbish &amp; Donate Fund</h1>
        <p className="mt-1 text-muted">
          Your donation pays for parts and technician time to refurbish devices so a school or community group can keep using them instead of buying new.
        </p>
      </div>

      <Card className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p><strong className="text-2xl text-primary">{formatUsd(raised)}</strong> raised of {formatUsd(FUND_GOAL_CENTS)} goal</p>
          <p className="text-sm text-muted">{sum._count} donation{sum._count === 1 ? "" : "s"}</p>
        </div>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Fundraising progress" className="h-3 rounded-full bg-primary-soft">
          <div className="h-3 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted">{pct}% of the demo goal.</p>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>}

      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Donate</h2>
        {mode === "unavailable" ? (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Donations are switched off because PayPal is not configured on this server.</p>
        ) : (
          <DonateForm mode={mode} clientId={clientId} deviceId={deviceId} allowSimulate={donationSimulationAllowed()} />
        )}
      </Card>

      <Card className="space-y-2 text-sm">
        <h2 className="text-lg font-bold">How funds are used</h2>
        <p>Money goes toward refurbishing devices at an assumed {formatUsd(REFURB_SUBSIDY_CENTS_PER_DEVICE)} each (an illustrative estimate): replacement parts, a technician&apos;s time and delivery.</p>
        <p>Beneficiary: {DEMO_BENEFICIARY}. <Badge tone="warn">Demo placeholder</Badge></p>
        <p className="text-muted">This is a sandbox demo: PayPal moves no real money, and nothing here is a tax receipt.</p>
      </Card>

      <section aria-labelledby="donors" className="space-y-2">
        <h2 id="donors" className="text-lg font-bold">Recent donors</h2>
        {recent.length === 0 ? (
          <Card className="text-sm text-muted">No donations yet. Be the first.</Card>
        ) : (
          <ul className="space-y-2">
            {recent.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span><strong>{publicDonorName(d.donorName)}</strong>{d.message ? <span className="text-muted"> · &ldquo;{d.message}&rdquo;</span> : null}</span>
                  <span className="flex items-center gap-2">{d.simulated && <Badge tone="warn">SIMULATED</Badge>}<strong>{formatUsd(d.amountCents)}</strong></span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
