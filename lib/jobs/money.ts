/** Money helpers. All amounts are integer cents to avoid float drift. */

export function platformFeeBps(): number {
  const raw = Number(process.env.PLATFORM_FEE_BPS ?? 1000);
  return Number.isInteger(raw) && raw >= 0 && raw <= 5000 ? raw : 1000;
}

export interface PayoutSplit {
  totalCents: number;
  platformFeeCents: number;
  technicianCents: number;
}

/** Split a job total. The fee applies to the whole total, rounded half-up; the technician gets the remainder. */
export function splitPayout(totalCents: number, feeBps = platformFeeBps()): PayoutSplit {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("totalCents must be a non-negative integer");
  const platformFeeCents = Math.floor((totalCents * feeBps + 5000) / 10000); // integer half-up, no float rounding
  return { totalCents, platformFeeCents, technicianCents: totalCents - platformFeeCents };
}

export const formatUsd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const centsToDecimalString = (cents: number) => (cents / 100).toFixed(2);
