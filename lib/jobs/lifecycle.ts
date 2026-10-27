import { db } from "@/lib/db";
import { PayPalError, isSimulatedId } from "@/lib/paypal/client";
import * as pp from "@/lib/paypal/gateway";
import { ActionError, checkPermission, type Action, type Principal } from "./permissions";
import { transitionJob } from "./service";
import { isJobStatus, type JobStatus } from "./state-machine";

async function load(jobId: string) {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { device: true, technician: true } });
  if (!job || !isJobStatus(job.status)) throw new ActionError("Job not found.", "not_found");
  return job;
}

async function authorize(action: Action, who: Principal, jobId: string) {
  const job = await load(jobId);
  checkPermission(action, who, { status: job.status, technicianId: job.technicianId, ownerId: job.device.ownerId });
  return job;
}

/** Moves the job, treating "someone else already did it" as a conflict the caller can report. */
async function move(jobId: string, from: JobStatus, to: JobStatus, actor: "owner" | "technician" | "system", data = {}, note?: string) {
  if (!(await transitionJob(jobId, from, to, actor, data, note))) throw new ActionError("This job just changed. Refresh and try again.", "bad_state");
}

// ---- technician actions ------------------------------------------------------------------------

export async function acceptJob(jobId: string, who: Principal) {
  const job = await authorize("accept", who, jobId);
  await move(jobId, "paid", "accepted", "technician", {}, `Accepted by ${job.technician?.name}`);
}

/** Declining releases the hold on the buyer's funds and cancels the job. */
export async function declineJob(jobId: string, who: Principal) {
  const job = await authorize("decline", who, jobId);
  await voidThenCancel(job.id, job.paypalAuthId, "technician", `Declined by ${job.technician?.name}`);
}

export async function startJob(jobId: string, who: Principal) {
  await authorize("start", who, jobId);
  await move(jobId, "accepted", "in_progress", "technician", {}, "Repair started");
}

export async function completeJob(jobId: string, who: Principal, proof: { photoPath: string; notes: string }) {
  await authorize("complete", who, jobId);
  const notes = proof.notes.trim();
  if (!proof.photoPath) throw new ActionError("A proof photo is required.", "blocked");
  if (notes.length < 5) throw new ActionError("Please add a few words about what you did.", "blocked");
  await move(jobId, "in_progress", "completed", "technician", { proofPhotoPath: proof.photoPath, proofNotes: notes.slice(0, 1000) }, "Repair completed, proof uploaded");
}

/** After the owner reported a problem: replace the proof; this clears the flag so the owner can confirm. */
export async function uploadProof(jobId: string, who: Principal, proof: { photoPath: string; notes: string }) {
  await authorize("upload_proof", who, jobId);
  if (!proof.photoPath) throw new ActionError("A proof photo is required.", "blocked");
  await db.$transaction([
    db.job.update({ where: { id: jobId }, data: { proofPhotoPath: proof.photoPath, proofNotes: proof.notes.trim().slice(0, 1000) || undefined, problemReport: null } }),
    db.jobEvent.create({ data: { jobId, status: "completed", note: "New proof uploaded; reported problem cleared" } }),
  ]);
}

// ---- owner actions -----------------------------------------------------------------------------

export async function cancelJob(jobId: string, who: Principal) {
  const job = await authorize("cancel", who, jobId);
  await voidThenCancel(job.id, job.status === "paid" ? job.paypalAuthId : null, "owner", "Cancelled by the owner before work started", job.status as JobStatus);
}

async function voidThenCancel(jobId: string, authId: string | null, actor: "owner" | "technician", note: string, from: JobStatus = "paid") {
  // Void first: if PayPal fails we keep the job (and the hold) visible instead of cancelling and losing track of it.
  if (authId) await pp.voidAuthorization(authId, jobId);
  await move(jobId, from, "cancelled", actor, {}, note);
}

export async function reportProblem(jobId: string, who: Principal, text: string) {
  await authorize("report", who, jobId);
  const t = text.trim();
  if (t.length < 5) throw new ActionError("Please describe the problem.", "blocked");
  await db.$transaction([
    db.job.update({ where: { id: jobId }, data: { problemReport: t.slice(0, 1000) } }),
    db.jobEvent.create({ data: { jobId, status: "completed", note: `Problem reported by owner: ${t.slice(0, 200)}` } }),
  ]);
}

export async function rateJob(jobId: string, who: Principal, rating: number) {
  const job = await authorize("rate", who, jobId);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ActionError("Rating must be 1 to 5.", "blocked");
  await db.job.update({ where: { id: jobId }, data: { customerRating: rating } });
  await db.verifiedRepair.updateMany({ where: { jobId: job.id }, data: { rating } });
}

export class CaptureError extends ActionError {}

const authIsGone = (e: unknown) => e instanceof PayPalError && /(^|_)(VOIDED|EXPIRED)$|^AUTHORIZATION_(NOT_FOUND|INVALID)$/i.test(e.issue ?? "");

/**
 * Owner confirms the repair. Order matters and is the money-safety core:
 *   1. permission + state check, blocked if a problem is reported
 *   2. capture exactly once (stored captureId short-circuits; PayPal-Request-Id covers lost responses)
 *   3. only then move to customer_confirmed and attempt the payout
 */
export async function confirmRepair(jobId: string, who: Principal) {
  const job = await authorize("confirm", who, jobId);
  if (job.problemReport) throw new ActionError("A problem is reported on this job. The technician must upload new proof before you can confirm.", "blocked");
  if (!job.paypalAuthId) throw new ActionError("This job has no payment authorization.", "bad_state");

  let captureId = job.paypalCaptureId;
  if (!captureId) {
    const plan = pp.planCapture(job.authorizedAt ?? job.createdAt);
    if (plan === "expired") return expire(jobId);

    let authId = job.paypalAuthId;
    if (plan === "reauthorize_then_capture" && !isSimulatedId(authId)) {
      try {
        const re = await pp.reauthorizeAuthorization(authId, job.id, job.totalCents, job.reauthCount + 1);
        authId = re.authorizationId;
        await db.job.update({ where: { id: jobId }, data: { paypalAuthId: authId, authorizedAt: new Date(), reauthCount: { increment: 1 } } });
        await db.jobEvent.create({ data: { jobId, status: "completed", note: "Authorization re-authorized after the 3-day honor period" } });
      } catch (e) {
        if (authIsGone(e)) return expire(jobId);
        // Re-authorization may be refused; the original authorization is still valid until day 29, so try capturing it.
      }
    }
    try {
      captureId = (await pp.captureAuthorization(authId, job.id, job.totalCents)).captureId;
    } catch (e) {
      if (authIsGone(e)) return expire(jobId);
      throw new CaptureError(e instanceof PayPalError ? `PayPal could not capture the payment: ${e.message}` : "Capture failed. You were not charged; please try again.", "blocked");
    }
  }

  // The capture is stored in the same write that confirms, so a captured job can never look unconfirmed-and-uncaptured.
  await transitionJob(jobId, "completed", "customer_confirmed", "owner", { paypalCaptureId: captureId }, `Owner confirmed; payment captured (${captureId})`);
  return releasePayout(jobId);
}

async function expire(jobId: string): Promise<never> {
  await transitionJob(
    jobId,
    "completed",
    "authorization_expired",
    "system",
    {},
    "The PayPal authorization expired or was voided before capture; nothing was charged",
  );
  throw new ActionError("The payment hold has expired (PayPal holds last 29 days), so nothing was charged. Please book the repair again.", "expired");
}

// ---- payout --------------------------------------------------------------------------------------

export type PayoutOutcome = { ok: true; job: Awaited<ReturnType<typeof load>> } | { ok: false; error: string };

/** Idempotent: a released job returns as-is; payout never runs without a stored capture. */
export async function releasePayout(jobId: string): Promise<PayoutOutcome> {
  const job = await load(jobId);
  if (job.status === "payout_released") return { ok: true, job };
  if (job.status !== "customer_confirmed" && job.status !== "payout_failed") throw new ActionError("Payout is only possible after the payment was captured and confirmed.", "bad_state");
  if (!job.paypalCaptureId) throw new ActionError("No captured payment on this job, so no payout.", "blocked");
  if (!job.technician) throw new ActionError("No technician on this job.", "blocked");
  const cents = job.totalCents - job.platformFeeCents;
  if (cents !== job.payoutCents || cents <= 0) throw new ActionError("Payout amount does not match the quote.", "blocked");

  const from = job.status;
  let result: pp.PayoutResult;
  try {
    result = await pp.createPayout({
      jobId: job.id,
      attempt: job.payoutAttempt,
      email: job.technician.paypalEmail,
      cents,
      captureId: job.paypalCaptureId,
      description: `ReLoop payout for ${job.device.brand} ${job.device.model} repair`,
    });
  } catch (e) {
    if (pp.isPayoutsNotEnabled(e)) {
      result = pp.simulatedPayout(job.id, "the PayPal sandbox business account is not enabled for Payouts, so no real transfer was made.");
    } else if (pp.isDuplicateBatch(e)) {
      result = { mode: "paypal_sandbox", batchId: pp.senderBatchId(job.id, job.payoutAttempt), itemId: null, status: "PENDING", note: "PayPal reports this payout was already submitted; waiting for its confirmation." };
    } else {
      const msg = e instanceof PayPalError ? `PayPal: ${e.message}${e.debugId ? ` (debug ${e.debugId})` : ""}` : "Payout could not be sent.";
      if (from === "customer_confirmed") await transitionJob(job.id, from, "payout_failed", "system", { payoutError: msg }, `Payout failed: ${msg}`);
      else await db.job.update({ where: { id: job.id }, data: { payoutError: msg } });
      return { ok: false, error: msg };
    }
  }

  await transitionJob(
    job.id,
    from,
    "payout_released",
    "system",
    { payoutBatchId: result.batchId, payoutItemId: result.itemId, payoutStatus: result.status, payoutMode: result.mode, payoutNote: result.note, payoutError: null },
    `Payout ${result.mode === "simulated" ? "SIMULATED" : "sent"} (${result.batchId})`,
  );
  const done = await load(job.id);
  await ensureVerifiedRepair(done);
  return { ok: true, job: done };
}

export async function retryPayout(jobId: string, who: Principal) {
  await authorize("retry_payout", who, jobId);
  return releasePayout(jobId);
}

// ---- verified record -----------------------------------------------------------------------------

export function repairTypeOf(diagnosisJson: string): string {
  try {
    const d = JSON.parse(diagnosisJson) as { estimated_parts?: { name: string }[]; likely_causes?: { cause: string }[] };
    return d.estimated_parts?.[0]?.name ?? d.likely_causes?.[0]?.cause ?? "Repair";
  } catch {
    return "Repair";
  }
}

/** Idempotent: one VerifiedRepair per job (jobId is unique). Rating 0 = rating prompt still open. */
export async function ensureVerifiedRepair(job: { id: string; technicianId: string | null; diagnosisJson: string; customerRating: number | null; payoutBatchId: string | null; device: { type: string } }) {
  if (!job.technicianId) return;
  await db.verifiedRepair.upsert({
    where: { jobId: job.id },
    update: {},
    create: {
      jobId: job.id,
      technicianId: job.technicianId,
      deviceType: job.device.type,
      repairType: repairTypeOf(job.diagnosisJson),
      rating: job.customerRating ?? 0,
      payoutRef: job.payoutBatchId,
      completedAt: new Date(),
    },
  });
}

// ---- dev-only simulated buyer approval ---------------------------------------------------------

export const simulationAllowed = () => process.env.NODE_ENV !== "production" && process.env.PAYPAL_SIMULATE_APPROVAL === "true";

/** DEV ONLY. Marks a quoted job as paid with an authorization flagged `authSimulated`. Never reachable in production. */
export async function simulateBuyerApproval(jobId: string) {
  if (!simulationAllowed()) throw new ActionError("Not available.", "forbidden");
  const j = await load(jobId);
  await move(
    jobId,
    "quoted",
    "paid",
    "system",
    { paypalOrderId: j.paypalOrderId ?? pp.newSimId("ORDER"), paypalAuthId: pp.newSimId("AUTH"), authSimulated: true, authorizedAt: new Date() },
    "SIMULATED buyer approval (dev only): no real PayPal authorization exists",
  );
}
