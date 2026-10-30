import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { checkPermission, type Principal } from "@/lib/jobs/permissions";
import { parseQuote } from "@/lib/jobs/service";
import type { Quote } from "@/lib/jobs/quote";

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

export type ApprovalErrorCode = "missing_token" | "invalid_token" | "token_used" | "wrong_job" | "expired" | "not_approved" | "changed" | "job_not_quoted" | "forbidden";

export class ApprovalError extends Error {
  constructor(
    public code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Hash of the exact line items and total the user is approving. Any change to them invalidates the approval. */
export function itemsHash(quote: Pick<Quote, "lines" | "totalCents">): string {
  return sha256(JSON.stringify({ lines: quote.lines.map((l) => [l.kind, l.label, l.cents]), total: quote.totalCents }));
}

/** Created by the agent's request_user_approval tool. Grants nothing by itself: the user must click Approve. */
export async function requestApproval(runId: string, jobId: string, now = new Date()) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const quote = parseQuote(job.quoteJson);
  if (!quote || job.status !== "quoted" || job.agentRunId !== runId) throw new ApprovalError("job_not_quoted", "That job is not a quoted job from this run.");
  return db.agentApproval.create({
    data: { runId, jobId, totalCents: job.totalCents, itemsHash: itemsHash({ lines: quote.lines, totalCents: job.totalCents }), expiresAt: new Date(+now + APPROVAL_TTL_MS) },
  });
}

/** Re-checks that the job still matches what was approved. */
async function assertUnchanged(approval: { jobId: string; totalCents: number; itemsHash: string }) {
  const job = await db.job.findUnique({ where: { id: approval.jobId } });
  if (!job || job.status !== "quoted") throw new ApprovalError("job_not_quoted", "The job is no longer open for payment.");
  const quote = parseQuote(job.quoteJson);
  if (!quote || job.totalCents !== approval.totalCents || itemsHash({ lines: quote.lines, totalCents: job.totalCents }) !== approval.itemsHash)
    throw new ApprovalError("changed", "The quote changed after it was shown to you. Please review it again.");
  return job;
}

/**
 * The ONLY place userApprovedAt is set. Called from the UI endpoint, which authenticates the session principal
 * as the job's owner. No agent tool calls this.
 */
export async function approveByUser(approvalId: string, who: Principal, now = new Date()) {
  const approval = await db.agentApproval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new ApprovalError("invalid_token", "Approval request not found.");
  if (approval.expiresAt <= now) throw new ApprovalError("expired", "This approval expired. Please ask the agent again.");
  const job = await assertUnchanged(approval);
  const full = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { device: true } });
  try {
    checkPermission("cancel", who, { status: "quoted", technicianId: full.technicianId, ownerId: full.device.ownerId, isTour: full.isTour, tourRunId: full.tourRunId }); // owner-only check
  } catch {
    throw new ApprovalError("forbidden", "Only the job's owner can approve it.");
  }
  await db.agentApproval.update({ where: { id: approvalId }, data: { userApprovedAt: approval.userApprovedAt ?? now } });
  return approval;
}

/** Mints a single-use token for an approval the user already clicked. Only the hash is stored. */
export async function mintToken(approvalId: string, now = new Date()): Promise<string> {
  const approval = await db.agentApproval.findUnique({ where: { id: approvalId } });
  if (!approval || !approval.userApprovedAt) throw new ApprovalError("not_approved", "The user has not approved this yet.");
  if (approval.expiresAt <= now) throw new ApprovalError("expired", "This approval expired. Please ask the agent again.");
  await assertUnchanged(approval);
  const token = randomBytes(32).toString("hex");
  await db.approvalToken.create({ data: { approvalId, tokenHash: sha256(token) } });
  return token;
}

/**
 * Verifies a token for a job and burns it. Every rule is checked here, in code:
 * existence, single use, same job, not expired, user-approved, amount and line items unchanged.
 */
export async function consumeToken(token: string | undefined, jobId: string, now = new Date()) {
  if (!token) throw new ApprovalError("missing_token", "An approval token from the user is required.");
  const row = await db.approvalToken.findUnique({ where: { tokenHash: sha256(token) }, include: { approval: true } });
  if (!row) throw new ApprovalError("invalid_token", "That approval token is not valid.");
  if (row.usedAt) throw new ApprovalError("token_used", "That approval token was already used.");
  const a = row.approval;
  if (a.jobId !== jobId) throw new ApprovalError("wrong_job", "That approval token belongs to a different job.");
  if (a.expiresAt <= now) throw new ApprovalError("expired", "That approval expired (15 minutes). Please approve again.");
  if (!a.userApprovedAt) throw new ApprovalError("not_approved", "The user has not approved this yet.");
  const job = await assertUnchanged(a);
  const burned = await db.approvalToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (burned.count === 0) throw new ApprovalError("token_used", "That approval token was already used.");
  return job;
}
