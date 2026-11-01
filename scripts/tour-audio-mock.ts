import type { BrowserContext, Page } from "playwright-core";
import manifest from "../public/tour/audio/manifest.json";

/** Production browser checks use recorded durations, but never access the machine's speakers. */
export async function mockTourAudio(context: BrowserContext, scale = 1) {
  await context.addInitScript(({ durations, scale }) => {
    const state = window as unknown as { __tourAudio: { played: string[]; active: number; blocked: boolean }; Audio: typeof Audio };
    state.__tourAudio = { played: [], active: 0, blocked: false };
    class RecordedAudio {
      src = ""; currentTime = 0; muted = false; volume = 1; playbackRate = 1; preservesPitch = true;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private timer: ReturnType<typeof setInterval> | undefined;
      private last = 0;
      play() {
        if (state.__tourAudio.blocked || localStorage.getItem("reloop_test_audio_blocked") === "1" || sessionStorage.getItem("reloop_test_audio_blocked") === "1") return Promise.reject(new DOMException("Autoplay blocked by test", "NotAllowedError"));
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
  }, { durations: Object.fromEntries(manifest.steps.map(e => [e.id, e.duration])), scale });
}
export const audioSnapshot = (page: Page) => page.evaluate(() => (window as unknown as { __tourAudio: { played: string[]; active: number; blocked: boolean } }).__tourAudio);
