import { afterEach, describe, expect, it, vi } from "vitest";
import { createTourStorage, tourStateStorage } from "@/lib/tour/storage";
import { TourNarrator } from "@/lib/tour/narrator";
import { loadState, STATE_KEY } from "@/lib/tour/controller";

const denied = () => Object.assign(new Error("Access is denied for this document"), { name: "SecurityError" });
afterEach(() => vi.unstubAllGlobals());

describe("tour storage when privacy settings deny access", () => {
  it("catches property-access SecurityError for reads, writes and removal", () => {
    const storage = createTourStorage(() => { throw denied(); });
    expect(storage.getItem("state")).toBeNull();
    expect(() => storage.setItem("state", "current step")).not.toThrow();
    expect(storage.getItem("state")).toBe("current step");
    expect(() => storage.removeItem("state")).not.toThrow();
    expect(storage.getItem("state")).toBeNull();
  });
  it("does not lose an in-memory update to stale storage after a write fails", () => {
    let blocked = false;
    const backing = new Map<string, string>();
    const native = {
      getItem(key: string) { if (blocked) throw denied(); return backing.get(key) ?? null; },
      setItem(key: string, value: string) { if (blocked) throw denied(); backing.set(key, value); },
      removeItem(key: string) { if (blocked) throw denied(); backing.delete(key); },
    };
    const storage = createTourStorage(() => native);
    storage.setItem("state", "old step");
    blocked = true;
    storage.setItem("state", "new step");
    blocked = false;
    expect(storage.getItem("state")).toBe("new step");
    storage.removeItem("state");
    expect(storage.getItem("state")).toBeNull();
  });
  it("keeps the narrator working with defaults when localStorage throws SecurityError", async () => {
    const browser = Object.defineProperty({}, "localStorage", { get() { throw denied(); } }) as Window;
    const storage = createTourStorage(() => browser.localStorage);
    const audio = { src: "", currentTime: 0, volume: 1, muted: false, playbackRate: 1, preservesPitch: false, pause: vi.fn(), play: vi.fn(() => Promise.resolve()), onended: null, onerror: null };
    const narrator = new TourNarrator({ steps: [{ id: "step", file: "public/tour/audio/step.mp3", duration: 2 }] }, vi.fn(), () => audio as unknown as HTMLAudioElement, storage, vi.fn());
    expect(() => narrator.configure()).not.toThrow();
    expect(narrator.settings).toMatchObject({ enabled: true, volume: 1 });
    narrator.begin("step"); await Promise.resolve();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(() => { narrator.setVolume(0.4); narrator.setEnabled(false); narrator.configure(); }).not.toThrow();
    expect(narrator.settings).toMatchObject({ enabled: false, volume: 0.4 });
    narrator.setEnabled(true); narrator.begin("step"); await Promise.resolve();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.volume).toBe(0.4);
    narrator.stop();
  });
  it("retains and clears current tour state in memory when sessionStorage is unavailable", () => {
    vi.stubGlobal("window", Object.defineProperty({}, "sessionStorage", { get() { throw denied(); } }));
    tourStateStorage.setItem(STATE_KEY, JSON.stringify({ runId: "memory-tour", chapter: 1, step: 2 }));
    expect(loadState()).toMatchObject({ runId: "memory-tour", chapter: 1, step: 2 });
    tourStateStorage.removeItem(STATE_KEY);
    expect(loadState()).toBeNull();
  });
});
