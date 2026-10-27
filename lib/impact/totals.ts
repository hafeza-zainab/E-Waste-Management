import { REFURB_SUBSIDY_CENTS_PER_DEVICE } from "./constants";

export interface ImpactRow {
  deviceId: string | null;
  outcome: string;
  ewasteKg: number;
  co2eKg: number;
  demo: boolean;
}

export interface ImpactTotals {
  devices: number;
  ewasteKg: number;
  co2eKg: number;
  byOutcome: Record<string, number>;
  includesDemo: boolean;
}

/** A device is counted once: later rows for the same deviceId are ignored. Rows without a deviceId always count. */
export function computeTotals(rows: ImpactRow[]): ImpactTotals {
  const seen = new Set<string>();
  const t: ImpactTotals = { devices: 0, ewasteKg: 0, co2eKg: 0, byOutcome: { repair: 0, refurbish: 0, donate: 0, recycle: 0 }, includesDemo: false };
  for (const r of rows) {
    if (r.deviceId) {
      if (seen.has(r.deviceId)) continue;
      seen.add(r.deviceId);
    }
    t.devices += 1;
    t.ewasteKg += r.ewasteKg;
    t.co2eKg += r.co2eKg;
    t.byOutcome[r.outcome] = (t.byOutcome[r.outcome] ?? 0) + 1;
    if (r.demo) t.includesDemo = true;
  }
  t.ewasteKg = Math.round(t.ewasteKg * 100) / 100;
  t.co2eKg = Math.round(t.co2eKg * 100) / 100;
  return t;
}

/** Whole devices a donation helps keep in use: floor(amount / subsidy per device). */
export const devicesFunded = (amountCents: number) => Math.floor(amountCents / REFURB_SUBSIDY_CENTS_PER_DEVICE);

export interface DayPoint {
  day: string; // YYYY-MM-DD (UTC)
  cents: number;
  cumulativeCents: number;
}

/** Donations grouped by UTC day with a running total, oldest first. */
export function donationsByDay(rows: { amountCents: number; at: Date }[]): DayPoint[] {
  const per = new Map<string, number>();
  for (const r of rows) {
    const day = r.at.toISOString().slice(0, 10);
    per.set(day, (per.get(day) ?? 0) + r.amountCents);
  }
  let run = 0;
  return [...per.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, cents]) => ({ day, cents, cumulativeCents: (run += cents) }));
}
