"use client";
import { useEffect, useRef } from "react";
import { OPEN_GUIDE_EVENT, START_EVENT } from "@/lib/tour/controller";

interface Props {
  buyerEmail?: string;
  buyerNote?: string;
  /** Demo accounts shown in the drawer (env NEXT_PUBLIC_DEMO_OWNER_EMAIL / _TECH_EMAIL / _PASSWORD_NOTE). The password itself is in the README. */
  ownerEmail?: string;
  techEmail?: string;
  passwordNote?: string;
  /** The guided tour is available (DEMO_ACTIONS=true). */
  tourEnabled?: boolean;
}

const TRY_IT = [
  "Agent: pick “Cracked phone screen” and watch it reject a pricier part for the $60 budget.",
  "Approve the quote, then pay in the PayPal popup with the sandbox buyer below. “Continue to PayPal in this tab” works if the popup is blocked.",
  "Log in as the demo technician (accept, start, complete with a photo), then as the demo owner (confirm the repair). Use two browsers or a private window to be both at once.",
  "Agent: “Swollen laptop battery” shows the safety gate refusing DIY.",
];

/** Judge help panel: a native <dialog> (focus trap, Esc to close) opened from a fixed button. Shown only on demo deployments. */
export function DemoGuide({ buyerEmail, buyerNote, ownerEmail, techEmail, passwordNote, tourEnabled }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // The guided demo's last step opens this panel so the test-buyer details are one click away.
    const open = () => ref.current?.showModal();
    window.addEventListener(OPEN_GUIDE_EVENT, open);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, open);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="fixed bottom-4 right-4 z-40 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-lg hover:bg-primary-hover"
      >
        Demo guide
      </button>
      <dialog ref={ref} aria-labelledby="demo-guide-title" data-tour="demo-guide" className="m-auto max-h-[90vh] w-[min(32rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground backdrop:bg-black/40">
        <div className="flex items-start justify-between gap-3">
          <h2 id="demo-guide-title" className="text-xl font-bold">Demo guide</h2>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-11 min-w-11 rounded-lg border border-border px-3" aria-label="Close demo guide">✕</button>
        </div>
        {tourEnabled && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Fastest way: let the app show itself</p>
            <p className="mt-1">A narrated, hands-off walkthrough of the real app (about 3 minutes). It never calls PayPal; everything it creates is labelled and deleted when it ends.</p>
            <button
              type="button"
              className="mt-2 min-h-11 rounded-lg bg-amber-500 px-4 font-semibold text-slate-950 hover:bg-amber-400"
              onClick={() => {
                ref.current?.close();
                window.dispatchEvent(new CustomEvent(START_EVENT, { detail: "/" }));
              }}
            >
              ▶ Run guided demo
            </button>
          </div>
        )}
        <h3 className="mt-4 font-semibold">Try it yourself</h3>
        <ol className="mt-1 list-decimal space-y-2 pl-5 text-sm">
          {TRY_IT.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <div className="mt-4 rounded-lg bg-primary-soft p-3 text-sm" data-tour="demo-accounts">
          <p className="font-semibold">Demo accounts</p>
          <p>Owner: <code className="break-all">{ownerEmail || "see the README"}</code></p>
          <p>Technician: <code className="break-all">{techEmail || "see the README"}</code></p>
          <p>{passwordNote || "The password is in the README, not in this page."}</p>
          <p className="mt-1">Or skip all of that: <strong>Continue as guest (demo)</strong> on the sign-up or log-in page.</p>
        </div>
        <div className="mt-4 rounded-lg bg-primary-soft p-3 text-sm">
          <p className="font-semibold">PayPal sandbox buyer</p>
          {buyerEmail ? <p>Email: <code className="break-all">{buyerEmail}</code></p> : <p>Email: see the README.</p>}
          {buyerNote && <p>{buyerNote}</p>}
          <p>The password is in the README, not in this page.</p>
        </div>
        <p className="mt-3 text-xs text-muted">Everything here is a sandbox demo. Items tagged SIMULATED or Tour simulation never touched PayPal.</p>
      </dialog>
    </>
  );
}
