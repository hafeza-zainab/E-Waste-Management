"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of the PayPal button on guided-demo quotes. It never loads or calls PayPal. The one button posts to
 * /api/tour/pay, which only accepts a tour job of the caller's own tour session and marks it TOUR-SIMULATED.
 */
export function TourPayStub({ jobId }: { jobId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "paid">("idle");
  const pay = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/tour/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Tour payment step failed.");
      setState("paid");
    } catch (e) {
      setState("idle");
      toast.error(e instanceof Error ? e.message : "Tour payment step failed.");
    }
  };
  return (
    <div className="space-y-3 rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <Badge tone="warn">Tour simulation</Badge>
        <span data-tour="paypal-button">PayPal checkout button (not loaded in the guided demo)</span>
      </p>
      <p>In the real flow the PayPal button sits here and holds the money. The guided demo never loads or calls PayPal.</p>
      {state !== "paid" ? (
        <Button data-tour="tour-pay" variant="outline" onClick={pay} disabled={state === "busy"}>
          {state === "busy" ? "Marking as held…" : "Tour step: mark as held (TOUR-SIMULATED)"}
        </Button>
      ) : (
        <p role="status" className="space-y-1">
          <strong>Held (TOUR-SIMULATED).</strong>{" "}
          <Link data-tour="job-link" className="inline-flex min-h-11 items-center font-semibold underline" href={`/jobs/${jobId}`}>View the job</Link>
        </p>
      )}
    </div>
  );
}
