import { chaptersFor, narrationId, TOUR_TIMING, type ReturnTo } from "../lib/tour/script";
import type { NarrationManifest } from "../lib/tour/narrator";

/** Scripted 1x time; excludes server latency, target waits, pauses and user decisions. */
export function scriptedTourMs(manifest: NarrationManifest, returnTo: ReturnTo = "/") {
  const durations = new Map(manifest.steps.map(entry => [entry.id, entry.duration * 1000]));
  return chaptersFor(returnTo).flatMap(chapter => chapter.steps).reduce((total, step) => {
    const id = narrationId(step);
    const duration = id ? durations.get(id) ?? 0 : 0;
    const audio = duration ? duration + (step.t === "slate" && step.id === "paypal-slate" ? 3000 : 400) : 0;
    if (step.t === "wait" || step.t === "capture") return total;
    if (step.t === "nav") return total + TOUR_TIMING.settle;
    if (step.t === "slate") return total + Math.max(step.ms, audio);
    if (step.t === "end") return total + audio;
    if (step.t === "role") return total + Math.max(TOUR_TIMING.action, audio);
    const action = step.t === "say" ? step.ms : step.t === "click" ? step.ms ?? 900
      : step.t === "type" ? step.text.length * TOUR_TIMING.character + TOUR_TIMING.settle : TOUR_TIMING.action;
    return total + TOUR_TIMING.scroll + Math.max(action, audio) + (step.t === "click" ? TOUR_TIMING.afterClick : 0);
  }, 0);
}

export const paypalRequests = (urls: string[]) => urls.filter(url => {
  const parsed = new URL(url);
  return /(^|\.)paypal(objects)?\.com$/i.test(parsed.hostname) || parsed.pathname.startsWith("/api/paypal");
});

export function browserDiagnostics(seen: { requests: string[]; consoleErrors: string[] }) {
  return `first console error: ${JSON.stringify(seen.consoleErrors[0] ?? "<none>")}; PayPal URLs: ${JSON.stringify(paypalRequests(seen.requests))}`;
}
