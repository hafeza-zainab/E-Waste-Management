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
  it("resumes a pending play interrupted by Pause without losing the active sentence", async () => {
    const { narrator, audio, warn } = fixture();
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let rejectPlay!: (error: Error) => void;
      audio.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
      narrator.begin("one"); audio.currentTime = 0.5;
      narrator.pause();
      rejectPlay(Object.assign(new Error("The play() request was interrupted by a call to pause()."), { name: "AbortError" }));
      await Promise.resolve();
      expect(narrator.waiting).toBe(true);
      expect(audio.currentTime).toBe(0.5);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("step=one phase=play AbortError"));
      narrator.resume(); await Promise.resolve();
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(audio.playing).toBe(true);
    } finally { diagnostic.mockRestore(); }
  });
  it("retries a failed gesture unlock on the same element and does not unlock again after success", async () => {
    const audio = new FakeAudio();
    const makeAudio = vi.fn(() => audio as unknown as HTMLAudioElement);
    const narrator = new TourNarrator(manifest, undefined, makeAudio);
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      audio.blocked = true; narrator.unlock(); await Promise.resolve();
      expect(narrator.settings.blocked).toBe(true);
      audio.blocked = false; narrator.unlock(); await Promise.resolve();
      expect(narrator.settings.blocked).toBe(false);
      expect(makeAudio).toHaveBeenCalledTimes(1);
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(audio.volume).toBe(1);
      narrator.unlock();
      expect(audio.play).toHaveBeenCalledTimes(2);
      narrator.begin("one"); await Promise.resolve();
      narrator.configure(); narrator.begin("two"); await Promise.resolve();
      expect(makeAudio).toHaveBeenCalledTimes(1);
      expect(audio.src).toBe("/tour/audio/two.mp3");
    } finally { diagnostic.mockRestore(); }
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
  it("after reload, a browser-shaped NotAllowedError shows recovery state and a tap restarts the current audio at zero", async () => {
    const previous = fixture();
    previous.narrator.begin("one"); await Promise.resolve();
    previous.audio.advance(500);
    const audio = new FakeAudio();
    const warn = vi.fn();
    const makeAudio = vi.fn(() => audio as unknown as HTMLAudioElement);
    let soundButtonVisible = false;
    // A new document gets a new narrator and Audio, with preferences but no
    // inherited activation. Use a DOMException-shaped non-Error rejection.
    const reloaded = new TourNarrator(manifest, () => {
      soundButtonVisible = reloaded.settings.blocked && reloaded.settings.enabled && !reloaded.settings.forcedOff;
    }, makeAudio, previous.store, warn);
    reloaded.configure();
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError", message: "User activation required" });
    reloaded.begin("two"); await Promise.resolve();
    expect(soundButtonVisible).toBe(true);
    expect(reloaded.waiting).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("step=two phase=play NotAllowedError"));
    reloaded.enableSound(); await Promise.resolve();
    expect(soundButtonVisible).toBe(false);
    expect(audio.src).toBe("/tour/audio/two.mp3");
    expect(audio.currentTime).toBe(0);
    expect(audio.playing).toBe(true);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(makeAudio).toHaveBeenCalledTimes(1);
  });
  it("a rejected manual retry releases the runner and continues silently without an automatic retry loop", async () => {
    const { narrator, audio, warn } = fixture();
    const denied = { name: "NotAllowedError", message: "Still blocked" };
    audio.play.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
    narrator.begin("one"); await Promise.resolve();
    narrator.enableSound(); await Promise.resolve();
    expect(narrator.waiting).toBe(false);
    expect(narrator.settings.blocked).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    let ticks = 0;
    const runner = new TourRunner(async () => { ticks++; }, 50, narrator);
    await runner.finishNarration();
    expect(ticks).toBe(0);
    narrator.begin("two"); await runner.wait(100);
    expect(ticks).toBe(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it("recognizes a synchronous NotAllowedError and logs the original step for a stale rejection", async () => {
    const { narrator, audio, warn } = fixture();
    audio.play.mockImplementationOnce(() => { throw { name: "NotAllowedError", message: "Blocked synchronously" }; });
    narrator.begin("one");
    expect(narrator.settings.blocked).toBe(true);
    expect(narrator.waiting).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    let rejectPlay!: (reason: unknown) => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
    narrator.enableSound();
    narrator.begin("two"); await Promise.resolve();
    rejectPlay({ name: "AbortError", message: "Interrupted by next source" });
    await Promise.resolve();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("step=one phase=play AbortError"));
    expect(audio.src).toBe("/tour/audio/two.mp3");
    expect(audio.playing).toBe(true);
    expect(narrator.settings.blocked).toBe(false);
  });
});
