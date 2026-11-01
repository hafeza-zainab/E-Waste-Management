import type { BrowserContext, Page } from "playwright-core";
import manifest from "../public/tour/audio/manifest.json";

export interface TourAudioSnapshot { played: string[]; active: number; blocked: boolean; attempts: { id: string; allowed: boolean; start: number }[] }

/** Production browser checks use recorded durations, but never access the machine's speakers. */
export async function mockTourAudio(context: BrowserContext, scale = 1) {
  const install = ({ durations, scale }: { durations: Record<string, number>; scale: number }) => {
    const state = window as unknown as { __tourAudio: TourAudioSnapshot; Audio: typeof Audio };
    state.__tourAudio = { played: [], active: 0, blocked: false, attempts: [] };
    const storedBlock = (kind: "localStorage" | "sessionStorage") => {
      try { return window[kind].getItem("reloop_test_audio_blocked") === "1"; }
      catch { return false; }
    };
    class RecordedAudio {
      src = ""; currentTime = 0; muted = false; volume = 1; playbackRate = 1; preservesPitch = true;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private timer: ReturnType<typeof setInterval> | undefined;
      private last = 0;
      play() {
        const id = this.src.split("/").pop()!.replace(/\.mp3$/, "");
        const blocked = state.__tourAudio.blocked || storedBlock("localStorage") || storedBlock("sessionStorage");
        state.__tourAudio.attempts.push({ id, allowed: !blocked, start: this.currentTime });
        if (blocked) return Promise.reject(new DOMException("Autoplay blocked by test", "NotAllowedError"));
        if (this.timer !== undefined) return Promise.resolve();
        if (!this.muted && this.volume > 0) state.__tourAudio.played.push(this.src.split("/").pop()!.replace(/\.mp3$/, ""));
        state.__tourAudio.active++;
        this.last = performance.now();
        this.timer = setInterval(() => {
          const now = performance.now();
          this.currentTime += (now - this.last) / 1000 * this.playbackRate;
          this.last = now;
          const id = this.src.split("/").pop()!.replace(/\.mp3$/, "");
          if (this.currentTime >= (durations[id] ?? 1) * scale) { this.pause(); this.onended?.(); }
        }, 25);
        return Promise.resolve();
      }
      pause() {
        if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; state.__tourAudio.active--; }
      }
    }
    state.Audio = RecordedAudio as unknown as typeof Audio;
  };
  // tsx keepNames inserts __name calls INSIDE serialized callbacks/classes.
  // Install the helper and mock in ONE string script: Playwright does not
  // guarantee ordering between separately registered init scripts. This also
  // supplies __name for later page.evaluate callbacks in both verifiers.
  await context.addInitScript({ content: `window.__name = (target) => target;\n(${install.toString()})(${JSON.stringify({ durations: Object.fromEntries(manifest.steps.map(e => [e.id, e.duration])), scale })});` });
}
export const audioSnapshot = (page: Page) => page.evaluate(() => (window as unknown as { __tourAudio: TourAudioSnapshot }).__tourAudio);

export function narrationSequenceDifferences(expected: string[], played: string[]) {
  const count = (ids: string[]) => ids.reduce<Record<string, number>>((counts, id) => { counts[id] = (counts[id] ?? 0) + 1; return counts; }, {});
  const wanted = count(expected);
  const heard = count(played);
  const missing = Object.keys(wanted).filter(id => (heard[id] ?? 0) < wanted[id]);
  const extra = Object.keys(heard).filter(id => heard[id] > (wanted[id] ?? 0));
  const index = expected.findIndex((id, i) => played[i] !== id);
  const firstMismatch = index >= 0 ? { index, expected: expected[index], played: played[index] ?? "<none>" }
    : played.length > expected.length ? { index: expected.length, expected: "<end>", played: played[expected.length] } : null;
  return { ok: firstMismatch === null, missing, extra, firstMismatch };
}
