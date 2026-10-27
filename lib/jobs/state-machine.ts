export const ALL_STATUSES = [
  "quoted",
  "paid",
  "accepted",
  "in_progress",
  "completed",
  "customer_confirmed",
  "payout_released",
  "payout_failed",
  "cancelled",
  "authorization_expired",
] as const;
export type JobStatus = (typeof ALL_STATUSES)[number];

/** The happy path, in order. Drives the timeline. */
export const JOB_STATUSES = ALL_STATUSES.slice(0, 7) as readonly JobStatus[];

export type Actor = "owner" | "technician" | "system";

interface Rule {
  from: JobStatus;
  to: JobStatus;
  actors: readonly Actor[];
}

/** The single table of legal transitions and who may perform each. Anything not listed is rejected. */
export const TRANSITIONS: readonly Rule[] = [
  { from: "quoted", to: "paid", actors: ["system"] }, // PayPal authorization succeeded
  { from: "quoted", to: "cancelled", actors: ["owner"] },
  { from: "paid", to: "accepted", actors: ["technician"] },
  { from: "paid", to: "cancelled", actors: ["owner", "technician"] }, // owner cancels / technician declines
  { from: "accepted", to: "in_progress", actors: ["technician"] },
  { from: "in_progress", to: "completed", actors: ["technician"] },
  { from: "completed", to: "customer_confirmed", actors: ["owner"] }, // only after a successful capture
  { from: "customer_confirmed", to: "payout_released", actors: ["system"] },
  { from: "customer_confirmed", to: "payout_failed", actors: ["system"] },
  { from: "payout_failed", to: "payout_released", actors: ["system"] }, // idempotent retry
  { from: "payout_released", to: "payout_failed", actors: ["system"] }, // PayPal later reports the item failed/returned
  // The authorization can lapse or be voided at any point before capture.
  { from: "paid", to: "authorization_expired", actors: ["system"] },
  { from: "accepted", to: "authorization_expired", actors: ["system"] },
  { from: "in_progress", to: "authorization_expired", actors: ["system"] },
  { from: "completed", to: "authorization_expired", actors: ["system"] },
];

export function isJobStatus(v: string): v is JobStatus {
  return (ALL_STATUSES as readonly string[]).includes(v);
}

/** Next step on the happy path (null at the end). */
export function nextStatus(from: JobStatus): JobStatus | null {
  const i = JOB_STATUSES.indexOf(from);
  return i >= 0 ? (JOB_STATUSES[i + 1] ?? null) : null;
}

/** With `actor`, checks that role too; without, only that the transition exists. */
export function canTransition(from: JobStatus, to: JobStatus, actor?: Actor): boolean {
  return TRANSITIONS.some((r) => r.from === from && r.to === to && (!actor || r.actors.includes(actor)));
}

export function assertTransition(from: string, to: string, actor?: Actor): asserts from is JobStatus {
  if (!isJobStatus(from) || !isJobStatus(to) || !canTransition(from, to, actor)) {
    throw new Error(`Illegal job transition: ${from} -> ${to}${actor ? ` by ${actor}` : ""}`);
  }
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  quoted: "Quoted",
  paid: "Paid (held)",
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  customer_confirmed: "Confirmed",
  payout_released: "Payout released",
  payout_failed: "Payout failed",
  cancelled: "Cancelled",
  authorization_expired: "Authorization expired",
};
