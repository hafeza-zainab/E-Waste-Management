import vm from "node:vm";
import type { BrowserContext } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { mockTourAudio, narrationSequenceDifferences, type TourAudioSnapshot } from "../scripts/tour-audio-mock";
import { TourNarrator } from "@/lib/tour/narrator";
import { chaptersFor, narrationId } from "@/lib/tour/script";
import manifest from "../public/tour/audio/manifest.json";

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
async function document(local = storage(), session = storage()) {
  let content = "";
  let now = 0;
  let timer = 0;
  const callbacks = new Map<number, () => void>();
  await mockTourAudio({ addInitScript: async (script: { content: string }) => { content = script.content; } } as unknown as BrowserContext);
  const sandbox: Record<string, unknown> = {
    localStorage: local, sessionStorage: session,
    performance: { now: () => now },
    setInterval: (callback: () => void) => { callbacks.set(++timer, callback); return timer; },
    clearInterval: (id: number) => { callbacks.delete(id); },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  // Match a browser/foreign-realm rejection that is NOT a host Error instance.
  vm.runInContext('globalThis.DOMException = class DOMException { constructor(message, name) { this.message = message; this.name = name; } };', context);
  vm.runInContext(content, context);
  const browser = sandbox as unknown as { Audio: new () => HTMLAudioElement; __tourAudio: TourAudioSnapshot };
  return { content, local, session, context, browser, advance: (ms: number) => { now += ms; for (const callback of [...callbacks.values()]) callback(); } };
}

describe("serialized production browser audio mock", () => {
  it("installs __name before the mock and supplies it to later serialized browser callbacks", async () => {
    const d = await document();
    expect(d.content.startsWith("window.__name =")).toBe(true);
    expect(d.browser.Audio.name).toBe("RecordedAudio");
    expect(vm.runInContext('typeof __name(() => 1, "callback")', d.context)).toBe("function");
  });
  it("uses the test's exact blocking flag to reject and expose the app's enable-sound state", async () => {
    const d = await document();
    d.local.setItem("reloop_test_audio_blocked", "1");
    let buttonVisible = false;
    const narrator = new TourNarrator(manifest, () => { buttonVisible = narrator.settings.blocked; }, () => new d.browser.Audio(), d.local, vi.fn());
    narrator.configure(); narrator.unlock(); await Promise.resolve();
    expect(d.browser.__tourAudio.attempts[0].allowed).toBe(false);
    expect(buttonVisible).toBe(true);
    expect(narrator.waiting).toBe(false);
  });
  it("does not throw from mock play when either browser storage getter is denied", async () => {
    const d = await document();
    vm.runInContext(`for (const kind of ['localStorage', 'sessionStorage']) Object.defineProperty(window, kind, { get() { throw new DOMException('Storage denied', 'SecurityError'); } });`, d.context);
    const audio = new d.browser.Audio();
    audio.src = "/tour/audio/problem.problem.mp3";
    await expect(audio.play()).resolves.toBeUndefined();
    audio.pause();
    d.browser.__tourAudio.blocked = true;
    await expect(audio.play()).rejects.toMatchObject({ name: "NotAllowedError" });
  });
  it("reinstalls the helper after reload, shows the blocked state and retries the current clip at zero", async () => {
    const first = await document();
    const before = new TourNarrator(manifest, vi.fn(), () => new first.browser.Audio(), first.local, vi.fn());
    before.begin("problem.problem"); await Promise.resolve();
    first.advance(500);
    first.session.setItem("reloop_test_audio_blocked", "1");
    const reloaded = await document(first.local, first.session);
    let buttonVisible = false;
    const narrator = new TourNarrator(manifest, () => { buttonVisible = narrator.settings.blocked; }, () => new reloaded.browser.Audio(), reloaded.local, vi.fn());
    narrator.configure(); narrator.begin("agent.goal"); await Promise.resolve();
    expect(buttonVisible).toBe(true);
    expect(reloaded.browser.__tourAudio.played).toEqual([]);
    reloaded.session.removeItem("reloop_test_audio_blocked");
    narrator.enableSound(); await Promise.resolve();
    expect(buttonVisible).toBe(false);
    expect(reloaded.browser.__tourAudio.played).toEqual(["agent.goal"]);
    expect(reloaded.browser.__tourAudio.attempts.at(-1)).toEqual({ id: "agent.goal", allowed: true, start: 0 });
  });
  it("excludes silent unlock and records exactly one start per available home-tour step, including slates", async () => {
    const d = await document();
    const narrator = new TourNarrator(manifest, vi.fn(), () => new d.browser.Audio(), d.local, vi.fn());
    const available = new Set(manifest.steps.map(e => e.id));
    const expected = chaptersFor("/").flatMap(c => c.steps.flatMap(s => narrationId(s) ? [narrationId(s)!] : [])).filter(id => available.has(id));
    narrator.unlock(); await Promise.resolve();
    expect(d.browser.__tourAudio.played).toEqual([]);
    for (const id of expected) {
      narrator.begin(id); await Promise.resolve();
      d.advance(30000); narrator.stop();
    }
    expect(d.browser.__tourAudio.played).toEqual(expected);
    expect(narrationSequenceDifferences(expected, d.browser.__tourAudio.played).ok).toBe(true);
    for (const id of ["paypal-slate", "paypal-slate-end"]) if (available.has(id)) expect(d.browser.__tourAudio.played.filter(played => played === id)).toHaveLength(1);
  });
  it("diagnoses skips, doubled steps and order errors without weakening the exact sequence check", () => {
    expect(narrationSequenceDifferences(["a", "b"], [])).toMatchObject({ ok: false, missing: ["a", "b"] });
    expect(narrationSequenceDifferences(["a", "b"], ["a", "a", "b"])).toMatchObject({ ok: false, extra: ["a"] });
    expect(narrationSequenceDifferences(["a", "b"], ["b", "a"])).toMatchObject({ ok: false, missing: [], extra: [], firstMismatch: { index: 0, expected: "a", played: "b" } });
  });
});
