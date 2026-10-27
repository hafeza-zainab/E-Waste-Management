import type { JobStatus } from "./state-machine";

export type Principal = { kind: "owner"; ownerId: string } | { kind: "technician"; techId: string };

export type Action =
  | "accept"
  | "decline"
  | "start"
  | "complete"
  | "upload_proof"
  | "confirm"
  | "report"
  | "cancel"
  | "rate"
  | "retry_payout";

export class ActionError extends Error {
  constructor(
    message: string,
    public code: "forbidden" | "bad_state" | "blocked" | "expired" | "not_found",
  ) {
    super(message);
    this.name = "ActionError";
  }
}

interface ActionRule {
  /** Who may do it. "either" = the job's owner or its assigned technician. */
  who: "owner" | "technician" | "either";
  from: readonly JobStatus[];
}

export const ACTION_RULES: Record<Action, ActionRule> = {
  accept: { who: "technician", from: ["paid"] },
  decline: { who: "technician", from: ["paid"] },
  start: { who: "technician", from: ["accepted"] },
  complete: { who: "technician", from: ["in_progress"] },
  upload_proof: { who: "technician", from: ["completed"] },
  confirm: { who: "owner", from: ["completed"] },
  report: { who: "owner", from: ["completed"] },
  cancel: { who: "owner", from: ["quoted", "paid"] }, // before acceptance only
  rate: { who: "owner", from: ["payout_released"] },
  retry_payout: { who: "either", from: ["customer_confirmed", "payout_failed"] },
};

export interface JobFacts {
  status: string;
  technicianId: string | null;
  ownerId: string;
}

/** Server-side authorization for every lifecycle action. Identity comes from the session, never from the request body. */
export function checkPermission(action: Action, who: Principal, job: JobFacts): void {
  const rule = ACTION_RULES[action];
  const isOwner = who.kind === "owner" && who.ownerId === job.ownerId;
  const isAssignedTech = who.kind === "technician" && !!job.technicianId && who.techId === job.technicianId;
  const allowed = rule.who === "owner" ? isOwner : rule.who === "technician" ? isAssignedTech : isOwner || isAssignedTech;
  if (!allowed) {
    throw new ActionError(
      rule.who === "technician" ? "Only the technician assigned to this job can do that." : rule.who === "owner" ? "Only the job's owner can do that." : "You are not part of this job.",
      "forbidden",
    );
  }
  if (!rule.from.includes(job.status as JobStatus)) {
    throw new ActionError(`This can't be done while the job is "${job.status.replaceAll("_", " ")}".`, "bad_state");
  }
}
