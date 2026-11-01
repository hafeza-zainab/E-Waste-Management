import { describe, expect, it } from "vitest";
import { browserDiagnostics, paypalRequests, scriptedTourMs } from "../scripts/tour-verification";
import { chaptersFor, narrationId, TOUR_TARGET_MS } from "../lib/tour/script";
import manifest from "../public/tour/audio/manifest.json";
import { agentRunPath } from "../lib/agent/run-url";

describe("2:45 guided tour", () => {
  it("fits the recorded audio and scripted actions inside 2:45 with at least 12 seconds for network waits, at either entry point", () => {
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
  it("keeps a mandatory narrated swollen-battery safety chapter before impact at both entry points", () => {
    for (const entry of ["/", "/signup"] as const) {
      const chapters = chaptersFor(entry);
      const index = chapters.findIndex(chapter => chapter.id === "safety");
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(chapters.findIndex(chapter => chapter.id === "proof"));
      const stop = chapters[index].steps.find(step => narrationId(step) === "safety.stop");
      expect(stop).toMatchObject({ t: "say", target: "safety-stop" });
      expect(stop && "optional" in stop && stop.optional).not.toBe(true);
      expect(manifest.steps.find(audio => audio.id === "safety.stop")?.file).toBe("public/tour/audio/safety.stop.mp3");
    }
  });
});

describe("agent reload URL", () => {
  it("preserves the run so the server can restore its trace and quote after reload", () => {
    expect(agentRunPath("http://localhost/agent", "run-123")).toBe("/agent?run=run-123");
    expect(agentRunPath("http://localhost/agent?record=1&narration=off#trace", "run-123")).toBe("/agent?record=1&narration=off&run=run-123#trace");
    expect(agentRunPath("http://localhost/agent?run=old", "new")).toBe("/agent?run=new");
  });
  it("does not send a user back to the agent if they navigated away while a stream was starting", () => {
    expect(agentRunPath("http://localhost/impact", "run-123")).toBeNull();
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
