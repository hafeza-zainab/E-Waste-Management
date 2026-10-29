import { db } from "@/lib/db";

/** "ABCDEFGH-1234" -> "ABCD…1234". Public pages never show a full transaction id. */
export function shortRef(ref: string | null | undefined): string {
  if (!ref) return "n/a";
  return ref.length <= 10 ? ref : `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

export interface PublicRepair {
  id: string;
  deviceType: string;
  repairType: string;
  date: Date;
  rating: number; // 0 = rating still pending
  payoutRef: string; // shortened
  demo: boolean;
}

/**
 * Only repairs whose job reached payout_released. VerifiedRepair.jobId is unique, so each job appears once.
 * `demo` is true for seeded, simulated or ledger-fallback payouts.
 */
export async function verifiedRepairsFor(technicianId: string): Promise<PublicRepair[]> {
  const rows = await db.verifiedRepair.findMany({
    where: { technicianId, job: { status: "payout_released", isTour: false } }, // guided-demo repairs are never public
    orderBy: { completedAt: "desc" },
    include: { job: { select: { authSimulated: true, payoutMode: true, payoutBatchId: true, paypalOrderId: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    deviceType: r.deviceType,
    repairType: r.repairType,
    date: r.completedAt,
    rating: r.rating,
    payoutRef: shortRef(r.payoutRef),
    demo: r.job.authSimulated || r.job.payoutMode !== "paypal_sandbox" || /^(SEED|SIM)-/.test(r.job.payoutBatchId ?? r.job.paypalOrderId ?? ""),
  }));
}
