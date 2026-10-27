import { JOB_STATUSES, STATUS_LABELS, type JobStatus } from "@/lib/jobs/state-machine";
import { cn } from "@/lib/utils";

interface Event {
  status: string;
  note: string | null;
  createdAt: Date;
}

/** Vertical lifecycle timeline: done, current and upcoming steps with the event note and time. */
export function JobTimeline({ status, events }: { status: JobStatus; events: Event[] }) {
  const current = JOB_STATUSES.indexOf(status);
  return (
    <ol aria-label="Job progress" className="space-y-0">
      {JOB_STATUSES.map((s, i) => {
        const ev = [...events].reverse().find((e) => e.status === s);
        const done = i < current || (i === current && status === "payout_released");
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
