"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OPEN_GUIDE_EVENT, START_EVENT, tour } from "@/lib/tour/controller";
import { SPEEDS } from "@/lib/tour/runner";
import { uiText, type ReturnTo } from "@/lib/tour/script";

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const base = "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-50";
const btn = `${base} border-white/40 text-white hover:bg-white/15`;
const btnPrimary = `${base} border-amber-400 bg-amber-400 text-slate-950 hover:bg-amber-300`;

/** Mounted once in the root layout so it survives client-side navigation. Hard reloads resume or clean up via bootstrap(). */
export function TourHost({ slateHold }: { slateHold?: number }) {
  const router = useRouter();
  const v = useSyncExternalStore(tour.subscribe, tour.getView, tour.getServerView);

  useEffect(() => {
    tour.setSlateHold(slateHold);
    tour.configure({ push: (p) => router.push(p), refresh: () => router.refresh(), notify: (m) => toast(m) });
    void tour.bootstrap();
    const onStart = (e: Event) => void tour.start(((e as CustomEvent<ReturnTo | undefined>).detail ?? "/") as ReturnTo);
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [router, slateHold]);

  if (v.status === "idle") return null;
  const active = v.status === "running" || v.status === "paused";
  const place = v.position === "top" ? "top-0 pt-[env(safe-area-inset-top,0px)]" : "bottom-0 pb-[env(safe-area-inset-bottom,0px)]";

  return (
    <div data-tour="tour-bar" className={`fixed inset-x-0 z-[2147483001] ${place} border-y-2 border-amber-400 bg-slate-950 px-3 py-3 text-white shadow-2xl`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        {v.slate && (
          <div data-tour="paypal-slate-banner" data-slate-id={v.slate} role="region" aria-label="Video editor cut point" className="w-full rounded-lg border-4 border-cyan-200 bg-cyan-950 p-5 text-center text-cyan-50">
            <p className="text-2xl font-extrabold sm:text-4xl">{v.caption}</p>
            {v.slate === "paypal-slate" && <p className="mt-2 text-lg font-semibold">Real sandbox checkout, capture and payout</p>}
            <p className="mt-2 text-sm">Editor placeholder · guided demo only · no PayPal call</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200">
          <span className="rounded-full bg-amber-400 px-2 py-0.5 font-bold text-slate-950">Guided demo running</span>
          {active && (
            <>
              <span>Chapter {v.chapterIndex + 1} of {v.chapterCount}: {v.title}</span>
              <span aria-hidden className="flex gap-1">
                {Array.from({ length: v.chapterCount }, (_, i) => <span key={i} className={`h-2 w-2 rounded-full ${i <= v.chapterIndex ? "bg-amber-400" : "bg-slate-600"}`} />)}
              </span>
              <span aria-label="Elapsed time">{fmt(v.elapsedMs)} elapsed</span>
              <span>Scripted demo run. PayPal is never called.</span>
              {v.viewingAs && <span data-tour="viewing-as" className="rounded-full border border-amber-400 px-2 py-0.5 font-semibold text-amber-200">Viewing as: {v.viewingAs}</span>}
            </>
          )}
        </div>
        <p role="status" aria-live="polite" className="text-base font-semibold leading-snug sm:text-lg">
          {v.status === "ended" ? v.caption : v.status === "paused" ? (v.pausedBy === "user" ? uiText("pausedByUser") : uiText("paused")) : v.caption || "Starting the guided demo…"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {active && (
            <>
              <button type="button" className={btn} aria-label="Narration" aria-pressed={v.narration.enabled && !v.narration.forcedOff} disabled={v.narration.forcedOff} onClick={() => tour.setNarration(!v.narration.enabled)}>
                Narration {v.narration.enabled && !v.narration.forcedOff ? "on" : "off"}
              </button>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <span>Narration volume</span>
                <input aria-label="Narration volume" type="range" min="0" max="1" step="0.05" value={v.narration.volume} onChange={e => tour.setVolume(Number(e.target.value))} className="w-24 accent-amber-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300" />
              </label>
              {v.narration.blocked && !v.narration.forcedOff && v.narration.enabled && <button type="button" className={btnPrimary} onClick={() => tour.enableSound()}>Tap to enable sound</button>}
            </>
          )}
          {v.status === "ended" && <button type="button" className={btn} onClick={() => tour.closeMessage()}>Close</button>}
          {active && !v.showEndActions && (
            <>
              {v.status === "paused" ? (
                <button type="button" className={btnPrimary} onClick={() => tour.resume()}>Resume</button>
              ) : (
                <button type="button" className={btn} onClick={() => tour.pause("button")}>Pause</button>
              )}
              <button type="button" className={btn} onClick={() => tour.skipChapter()}>Skip chapter</button>
              <label className="flex items-center gap-2 text-sm">
                <span>Speed</span>
                <select value={v.speed} onChange={(e) => tour.setSpeed(Number(e.target.value))} className="min-h-11 rounded-lg border border-white/40 bg-slate-900 px-2 text-white">
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
                </select>
              </label>
              <button type="button" className={btn} onClick={() => void tour.stop()}>Stop (Esc)</button>
            </>
          )}
          {v.showEndActions && (
            <>
              <button type="button" className={btnPrimary} onClick={() => tour.tryReal()}>Try the real sandbox checkout</button>
              <button type="button" className={btn} onClick={() => tour.finish()}>Finish</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Entry point on the home page (returnTo "/": the visitor's session is left exactly as it was) and the signup page
 * (returnTo "/signup"). Rendered only where the tour is enabled (DEMO_ACTIONS=true).
 */
export function StartTourButton({ className, returnTo = "/" }: { className?: string; returnTo?: ReturnTo }) {
  return (
    <button type="button" data-tour="start-tour" data-return-to={returnTo} className={className} onClick={() => window.dispatchEvent(new CustomEvent<ReturnTo>(START_EVENT, { detail: returnTo }))}>
      ▶ Run guided demo (about 2 min 30 sec)
    </button>
  );
}

export { OPEN_GUIDE_EVENT };
