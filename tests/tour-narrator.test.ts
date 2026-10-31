import { describe, expect, it, vi } from "vitest";
import { NARRATION_KEY, TourNarrator, narrationRate, narrationWait, selectAudio } from "@/lib/tour/narrator";
import { ChapterSkip, TourAbort, TourRunner } from "@/lib/tour/runner";

const manifest = { steps: [
  { id: "one", file: "public/tour/audio/one.mp3", duration: 2 },
  { id: "two", file: "public/tour/audio/two.mp3", duration: 1 },
] };
class FakeAudio {
  src = ""; currentTime = 0; volume = 1; muted = false; playbackRate = 1; preservesPitch = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playing = false;
  blocked = false;
  play = vi.fn(() => {
    if (this.blocked) return Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    this.playing = true; return Promise.resolve();
  });
  pause = vi.fn(() => { this.playing = false; });
  advance(ms: number) {
    if (!this.playing) return;
    this.currentTime += ms / 1000 * this.playbackRate;
    const duration = this.src.endsWith("two.mp3") ? 1 : 2;
    if (this.currentTime >= duration) { this.playing = false; this.onended?.(); }
  }
}
const fixture = () => {
  const audio = new FakeAudio();
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const warn = vi.fn();
  const narrator = new TourNarrator(manifest, vi.fn(), () => audio as unknown as HTMLAudioElement, store, warn);
  return { audio, data, store, warn, narrator };
};

describe("recorded tour narration", () => {
  it("selects an exact manifest ID and restricts playback to its same-origin MP3", () => {
    expect(selectAudio(manifest, "one")?.duration).toBe(2);
    expect(selectAudio(manifest, "unknown")).toBeUndefined();
    expect(selectAudio({ steps: [{ id: "one", file: "https://example.com/one.mp3", duration: 2 }] }, "one")).toBeUndefined();
    const { narrator, audio } = fixture();
    narrator.begin("one");
    expect(audio.src).toBe("/tour/audio/one.mp3");
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
  it("continues silently and warns once for absent or failed files", () => {
    const { narrator, audio, warn } = fixture();
    narrator.begin("missing"); narrator.begin("missing");
    expect(audio.play).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    narrator.begin("one"); audio.onerror?.();
    expect(narrator.waiting).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it("computes max(existing wait, speech plus 400ms), with capped pitch-preserving speed", () => {
    expect(narrationWait(3000, 2)).toBe(3000);
    expect(narrationWait(1000, 2)).toBe(2400);
    expect(narrationWait(6000, 2, 2)).toBe(3000);
    expect(narrationRate(2)).toBe(1.5);
    const { narrator, audio } = fixture();
    narrator.begin("one"); narrator.setSpeed(2);
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.preservesPitch).toBe(true);
  });
  it("runner waits overlap narration and add the tail only once", async () => {
    for (const stepWait of [1000, 3000]) {
      const { narrator, audio } = fixture();
      let elapsed = 0;
      const runner = new TourRunner(async ms => { elapsed += ms; audio.advance(ms); }, 50, narrator);
      narrator.begin("one");
      await runner.wait(stepWait);
      await runner.finishNarration();
      expect(elapsed).toBeGreaterThanOrEqual(narrationWait(stepWait, 2) - 50);
      expect(elapsed).toBeLessThanOrEqual(narrationWait(stepWait, 2) + 50);
    }
  });
  it("persists mute and volume, and URL off overrides saved on", () => {
    const { narrator, store, audio, data } = fixture();
    narrator.configure(); narrator.setEnabled(false); narrator.setVolume(0.35);
    expect(JSON.parse(data.get(NARRATION_KEY)!)).toEqual({ enabled: false, volume: 0.35 });
    const reloaded = new TourNarrator(manifest, undefined, () => audio as unknown as HTMLAudioElement, store);
    reloaded.configure();
    expect(reloaded.settings.enabled).toBe(false);
    expect(reloaded.settings.volume).toBe(0.35);
    reloaded.begin("one"); expect(audio.play).not.toHaveBeenCalled();
    reloaded.setEnabled(true); reloaded.configure(true); reloaded.begin("one");
    expect(audio.play).not.toHaveBeenCalled();
    reloaded.configure(false); reloaded.setVolume(0); reloaded.begin("one");
    expect(audio.play).not.toHaveBeenCalled();
  });
  it("pause freezes audio and resume continues without resetting the sentence", async () => {
    const { narrator, audio } = fixture();
    const runner = new TourRunner(undefined, undefined, narrator);
    narrator.begin("one"); await Promise.resolve(); audio.advance(500);
    runner.pause(); const position = audio.currentTime;
    audio.advance(1000); expect(audio.currentTime).toBe(position);
    runner.resume(); await Promise.resolve();
    expect(audio.currentTime).toBe(position);
    expect(audio.playing).toBe(true);
  });
  it("skip and stop cancel immediately and reset the audio, including while paused", async () => {
    for (const operation of ["skipChapter", "abort"] as const) {
      const { narrator, audio } = fixture();
      const runner = new TourRunner(undefined, undefined, narrator);
      narrator.begin("one"); await Promise.resolve(); audio.advance(500); runner.pause();
      runner[operation]();
      expect(audio.playing).toBe(false); expect(audio.currentTime).toBe(0); expect(narrator.waiting).toBe(false);
      expect(() => runner.check()).toThrow(operation === "abort" ? TourAbort : ChapterSkip);
    }
  });
  it("starts a restored current step at zero and never queues earlier steps", async () => {
    const before = fixture(); before.narrator.begin("one"); await Promise.resolve(); before.audio.advance(500);
    const after = fixture(); after.narrator.configure(); after.narrator.begin("two");
    expect(after.audio.src).toBe("/tour/audio/two.mp3");
    expect(after.audio.currentTime).toBe(0);
    expect(after.audio.play).toHaveBeenCalledTimes(1);
  });
  it("blocked autoplay is nonfatal, suppresses later playback until a gesture, then restarts only the current line", async () => {
    const { narrator, audio } = fixture(); audio.blocked = true;
    narrator.begin("one"); await Promise.resolve();
    expect(narrator.settings.blocked).toBe(true); expect(narrator.waiting).toBe(false);
    narrator.begin("two"); expect(audio.play).toHaveBeenCalledTimes(1);
    audio.blocked = false; narrator.enableSound(); await Promise.resolve();
    expect(narrator.settings.blocked).toBe(false); expect(audio.src).toBe("/tour/audio/two.mp3");
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it("a stalled recording cannot hang the tour", () => {
    const { narrator, warn } = fixture(); narrator.begin("one"); narrator.tick(15000);
    expect(narrator.waiting).toBe(false); expect(warn).toHaveBeenCalledTimes(1);
  });
});
