import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-primary-soft text-primary-hover",
    good: "bg-green-100 text-green-800",
    warn: "bg-amber-100 text-amber-900",
    bad: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}
