import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DiagnosisSchema } from "@/lib/ai/schemas";
import { assertTransition, type Actor, type JobStatus } from "./state-machine";
import { buildQuote, QuoteSchema, type Quote } from "./quote";

/** Statuses in which a device still has an unfinished job. */
const OPEN = ["quoted", "paid", "accepted", "in_progress", "completed", "customer_confirmed", "payout_failed"];

export async function createQuotedJob(deviceId: string, pickup: boolean) {
  const device = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
  if (!device.diagnosisJson) throw new Error("This device has not been diagnosed yet.");
  const diagnosis = DiagnosisSchema.parse(JSON.parse(device.diagnosisJson));
  if (diagnosis.recommended_path !== "technician") throw new Error("A technician quote is not part of the recommended path for this device.");

  const existing = await db.job.findFirst({ where: { deviceId, status: { in: OPEN } } });
  if (existing) return existing;

  const technicians = await db.technician.findMany();
  const quote = buildQuote({
    deviceType: device.type,
    parts: diagnosis.estimated_parts,
    laborHours: diagnosis.estimated_labor.hours,
    pickup,
    technicians,
  });
  return persistQuote(deviceId, diagnosis, quote);
}

export async function persistQuote(deviceId: string, diagnosis: unknown, quote: Quote, extra: { agentRunId?: string } = {}) {
  return db.job.create({
    data: {
      ...extra,
      deviceId,
      technicianId: quote.technicianId,
      status: "quoted",
      diagnosisJson: JSON.stringify(diagnosis),
      quoteJson: JSON.stringify(quote),
      partsCents: quote.partsCents,
      laborCents: quote.laborCents,
      logisticsCents: quote.logisticsCents,
      totalCents: quote.totalCents,
      platformFeeCents: quote.platformFeeCents,
      payoutCents: quote.technicianPayoutCents,
      events: { create: { status: "quoted", note: `Quote for ${quote.technicianName}` } },
    },
  });
}

export function parseQuote(json: string | null): Quote | null {
  return json ? QuoteSchema.parse(JSON.parse(json)) : null;
}

/**
 * Atomic, idempotent transition through the one table of legal moves: only succeeds if the job
 * is still in `from` and `actor` may make this move. Returns false when another request already moved it.
 */
export async function transitionJob(
  jobId: string,
  from: JobStatus,
  to: JobStatus,
  actor: Actor,
  data: Prisma.JobUncheckedUpdateManyInput = {},
  note?: string,
): Promise<boolean> {
  assertTransition(from, to, actor);
  return db.$transaction(async (tx) => {
    const res = await tx.job.updateMany({ where: { id: jobId, status: from }, data: { ...data, status: to } });
    if (res.count === 0) return false;
    await tx.jobEvent.create({ data: { jobId, status: to, note } });
    return true;
  });
}

export async function markPaid(jobId: string, orderId: string, authorizationId: string, note: string) {
  return transitionJob(
    jobId,
    "quoted",
    "paid",
    "system",
    { paypalOrderId: orderId, paypalAuthId: authorizationId, authSimulated: authorizationId.startsWith("SIM-"), authorizedAt: new Date() },
    note,
  );
}
