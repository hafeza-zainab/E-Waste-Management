import { JOB_STATUSES, STATUS_LABELS, type JobStatus } from "@/lib/jobs/state-machine";
import { cn } from "@/lib/utils";

interface Event {
  status: string;
  note: string | null;
  createdAt: Date;
}

/** Vertical lifecycle timeline: done, current and upcoming steps with the event note and time. */
export function JobTimeline({ status, events }: { status: JobStatus; events: Event[] }) {
  // Off-path states (failed/cancelled/expired) show the last happy-path step reached, plus a note below.
  const reached = JOB_STATUSES.includes(status)
    ? status
    : status === "payout_failed"
      ? "customer_confirmed"
      : ([...events].reverse().find((e) => JOB_STATUSES.includes(e.status as JobStatus) && e.status !== status)?.status as JobStatus | undefined) ?? "quoted";
  const current = JOB_STATUSES.indexOf(reached);
  return (
    <ol aria-label="Job progress" className="space-y-0">
      {JOB_STATUSES.map((s, i) => {
        const ev = [...events].reverse().find((e) => e.status === s);
        const done = i < current || (i === current && status === "payout_released");
        const offPathHere = i === current && !JOB_STATUSES.includes(status) && status !== "payout_failed";
        const isCurrent = i === current && !done;
        return (
          <li key={s} className="flex gap-3" aria-current={isCurrent ? "step" : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                  done && "border-accent bg-accent text-white",
                  isCurrent && "border-primary bg-primary text-white ring-4 ring-primary-soft",
                  !done && !isCurrent && "border-border bg-card text-muted",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              {i < JOB_STATUSES.length - 1 && <span className={cn("w-0.5 flex-1 min-h-6", i < current ? "bg-accent" : "bg-border")} />}
            </div>
            <div className="pb-5">
              <p className={cn("font-semibold", !done && !isCurrent && "text-muted")}>{STATUS_LABELS[s]}</p>
              {offPathHere && <p className="text-sm font-semibold text-danger">Stopped: {STATUS_LABELS[status]}</p>}
              {i === current && status === "payout_failed" && <p className="text-sm font-semibold text-danger">Payout failed, retry available</p>}
              {ev && (
                <p className="text-sm text-muted">
                  {ev.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  {ev.note ? ` · ${ev.note}` : ""}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
