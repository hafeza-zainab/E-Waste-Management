"use client";
import { useRef } from "react";

interface Props {
  buyerEmail?: string;
  buyerNote?: string;
}

const STEPS = [
  "Click Agent in the menu and pick the “Cracked phone screen” example. Watch each step: the budget ($60) makes it reject the pricier part and find a cheaper one.",
  "Press “Approve and continue to PayPal”. Pay with the sandbox buyer below (no real money moves). “Continue to PayPal in this tab” works if the popup is blocked.",
  "Use the Demo role switch in the header: become the Technician, accept the job, mark it in progress, then complete it with a proof photo. Switch back to Owner and press “Confirm repair is done”: the payment is captured and the technician paid (IDs are shown).",
  "Try “Swollen laptop battery” in the agent: the safety gate refuses DIY and routes to a technician. “Dead TV” routes to recycling.",
  "Open the technician’s verified profile (and its CV PDF), Donate (then download the certificate), and Impact.",
];

/** Judge help panel: a native <dialog> (focus trap, Esc to close) opened from a fixed button. Shown only on demo deployments. */
export function DemoGuide({ buyerEmail, buyerNote }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="fixed bottom-4 right-4 z-40 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-lg hover:bg-primary-hover"
      >
        Demo guide
      </button>
      <dialog ref={ref} aria-labelledby="demo-guide-title" className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-5 text-foreground backdrop:bg-black/40">
        <div className="flex items-start justify-between gap-3">
          <h2 id="demo-guide-title" className="text-xl font-bold">Demo guide: 5 steps</h2>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-11 min-w-11 rounded-lg border border-border px-3" aria-label="Close demo guide">✕</button>
        </div>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <div className="mt-4 rounded-lg bg-primary-soft p-3 text-sm">
          <p className="font-semibold">PayPal sandbox buyer</p>
          {buyerEmail ? <p>Email: <code className="break-all">{buyerEmail}</code></p> : <p>Email: see the README.</p>}
          {buyerNote && <p>{buyerNote}</p>}
          <p>The password is in the README, not in this page.</p>
        </div>
        <p className="mt-3 text-xs text-muted">Everything here is a sandbox demo. Items tagged SIMULATED never touched PayPal.</p>
      </dialog>
    </>
  );
}
