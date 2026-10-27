import type { RecyclingPickup } from "@prisma/client";
import { advanceRecycling, bookRecycling } from "@/app/owner/actions";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { DEMO_RECYCLER } from "@/lib/impact/constants";
import { computeImpact, recoverableMaterials } from "@/lib/impact/formulas";
import { PICKUP_STATUSES, nextPickupStatus } from "@/lib/recycling/pickup";

const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base";

interface Props {
  deviceId: string;
  deviceType: string;
  pickup: RecyclingPickup | null;
  /** Demo/dev only: shows the buttons that stand in for the recycler. Never true in production. */
  canAdvance: boolean;
}

export function RecyclePanel({ deviceId, deviceType, pickup, canAdvance }: Props) {
  const impact = computeImpact(deviceType, "recycle");
  const materials = recoverableMaterials(deviceType);
  const today = new Date().toISOString().slice(0, 10);
  const idx = pickup ? PICKUP_STATUSES.indexOf(pickup.status as (typeof PICKUP_STATUSES)[number]) : -1;
  const next = pickup ? nextPickupStatus(pickup.status) : null;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">Recycle this device</h2>
        <Badge tone="warn">Demo partner</Badge>
      </div>
      <p className="text-sm text-muted">{DEMO_RECYCLER}. Booking is free and takes no payment or phone number.</p>

      {pickup ? (
        <>
          <ol aria-label="Pickup status" className="flex flex-wrap gap-2">
            {PICKUP_STATUSES.map((s, i) => (
              <li key={s} aria-current={i === idx ? "step" : undefined}>
                <Badge tone={i < idx || (i === idx && s === "processed") ? "good" : i === idx ? "warn" : "neutral"}>{i + 1}. {s}</Badge>
              </li>
            ))}
          </ol>
          <p className="text-sm">Pickup on <strong>{pickup.pickupDate}</strong> at: {pickup.address}</p>
          {canAdvance && next && (
            <form action={advanceRecycling} className="rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3 text-sm">
              <input type="hidden" name="deviceId" value={deviceId} />
              <p className="mb-2 font-semibold">Demo control: stands in for the recycler (no real recycler exists)</p>
              <Button variant="outline" type="submit">Demo control: mark {next}</Button>
            </form>
          )}
          {pickup.status === "processed" && <p role="status" className="text-sm font-medium">Processed. This device now counts toward the impact dashboard (demo data).</p>}
        </>
      ) : (
        <form action={bookRecycling} className="space-y-3">
          <input type="hidden" name="deviceId" value={deviceId} />
          <div className="space-y-1">
            <label htmlFor="address" className="font-medium">Pickup address</label>
            <textarea id="address" name="address" rows={2} minLength={8} maxLength={200} required autoComplete="street-address" className={`${field} py-2`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="pickupDate" className="font-medium">Preferred date</label>
            <input id="pickupDate" name="pickupDate" type="date" min={today} required className={field} />
          </div>
          <SubmitButton pendingText="Booking…">Book certified recycler pickup</SubmitButton>
        </form>
      )}

      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <h3 className="font-semibold">Recoverable materials (estimate)</h3>
          <ul className="mt-1 list-disc pl-5">{materials.map((m) => <li key={m.material}>{m.material}: about {m.grams} g</li>)}</ul>
        </div>
        <div>
          <h3 className="font-semibold">Pollution avoided (estimate)</h3>
          <p className="mt-1">About <strong>{impact.ewasteKg} kg</strong> kept out of landfill and <strong>{impact.co2eKg} kg CO2e</strong> saved. These are illustrative estimates, see the impact page.</p>
        </div>
      </div>
    </Card>
  );
}
