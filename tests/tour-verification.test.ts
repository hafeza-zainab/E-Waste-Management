import { describe, expect, it } from "vitest";
import { browserDiagnostics, paypalRequests, scriptedTourMs } from "../scripts/tour-verification";
import { chaptersFor, narrationId, TOUR_TARGET_MS } from "../lib/tour/script";
import manifest from "../public/tour/audio/manifest.json";

describe("2:30 guided tour", () => {
  it("fits the recorded audio and scripted actions inside 2:30 with at least 12 seconds for network waits, at either entry point", () => {
    for (const entry of ["/", "/signup"] as const) {
      expect(scriptedTourMs(manifest, entry) + 12_000, entry).toBeLessThanOrEqual(TOUR_TARGET_MS);
    }
  });
  it("keeps approval, both slates, payment simulation, technician proof, owner confirmation, safety and impact", () => {
    const chapters = chaptersFor("/");
    const steps = chapters.flatMap(chapter => chapter.steps);
    const targets = steps.flatMap(step => "target" in step ? [step.target] : []);
    for (const target of ["approve", "tour-pay", "accept@job", "start@job", "proof-photo@job", "complete@job", "confirm", "safety-stop", "impact-stats"]) expect(targets).toContain(target);
    expect(steps.filter(step => step.t === "slate").map(step => step.id)).toEqual(["paypal-slate", "paypal-slate-end"]);
    for (const id of ["control.gate", "control.tourpay", "payout.paid", "safety.stop"]) expect(steps.map(narrationId)).toContain(id);
    expect(steps.find(step => step.t === "type" && step.target === "goal")?.narration).toBe(false);
  });
});

describe("tour failure diagnostics", () => {
  it("prints the first console error with its type and every PayPal-bound URL", () => {
    const requests = ["http://localhost:3410/", "https://www.paypal.com/sdk/js?client-id=dummy", "https://www.paypalobjects.com/script.js", "http://localhost:3410/api/paypal/create"];
    const result = browserDiagnostics({ requests, consoleErrors: ["pageerror: Unhandled NotAllowedError: blocked", "console.error: later failure"] });
    expect(result).toContain("pageerror: Unhandled NotAllowedError: blocked");
    expect(result).not.toContain("later failure");
    for (const url of requests.slice(1)) expect(result).toContain(url);
  });
  it("distinguishes a clean console from a network-only failure and matches host boundaries", () => {
    expect(browserDiagnostics({ requests: ["https://sandbox.paypal.com/checkoutnow"], consoleErrors: [] })).toContain('first console error: "<none>"');
    expect(paypalRequests(["https://paypal.com.example.org/file", "https://example.org/paypal.com", "https://notpaypal.com/"])).toEqual([]);
    expect(browserDiagnostics({ requests: [], consoleErrors: ["console.error: failed resource"] })).toContain("PayPal URLs: []");
  });
});
