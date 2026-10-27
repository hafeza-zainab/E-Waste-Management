export const JOB_STATUSES = [
  "quoted",
  "paid",
  "accepted",
  "in_progress",
  "completed",
  "customer_confirmed",
  "payout_released",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Strictly linear lifecycle. Each status has exactly one legal successor. */
const NEXT: Record<JobStatus, JobStatus | null> = {
  quoted: "paid",
  paid: "accepted",
  accepted: "in_progress",
  in_progress: "completed",
  completed: "customer_confirmed",
  customer_confirmed: "payout_released",
  payout_released: null,
};

export function isJobStatus(v: string): v is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(v);
}

export function nextStatus(from: JobStatus): JobStatus | null {
  return NEXT[from];
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return NEXT[from] === to;
}

export function assertTransition(from: string, to: string): asserts from is JobStatus {
  if (!isJobStatus(from) || !isJobStatus(to) || !canTransition(from, to)) {
    throw new Error(`Illegal job transition: ${from} -> ${to}`);
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
};
