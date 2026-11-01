/** Recorded, same-origin audio only. No browser or hosted speech synthesis. */
export interface AudioEntry { id: string; file: string; duration: number }
export interface NarrationManifest { steps: AudioEntry[] }
export const NARRATION_KEY = "reloop_tour_narration";
export const narrationRate = (speed: number) => Math.min(1.5, Math.max(1, speed));
export const narrationWait = (stepMs: number, seconds: number, speed = 1, padding = 400) =>
  Math.max(stepMs / speed, seconds * 1000 / narrationRate(speed) + padding);
export function selectAudio(manifest: NarrationManifest, id: string) {
  return manifest.steps.find(e => e.id === id && e.file === `public/tour/audio/${id}.mp3` && Number.isFinite(e.duration) && e.duration > 0);
}
type Store = Pick<Storage, "getItem" | "setItem">;
// Browser DOMExceptions and errors from another realm need not inherit this
// document's Error constructor. Autoplay policy is identified by its name.
function playError(error: unknown) {
  const object = error !== null && typeof error === "object" ? error : {};
  return {
    name: "name" in object && typeof object.name === "string" ? object.name : "UnknownError",
    message: "message" in object && typeof object.message === "string" ? object.message : "Audio playback failed",
  };
}
export interface NarrationSettings { enabled: boolean; volume: number; blocked: boolean; forcedOff: boolean }

export class TourNarrator {
  settings: NarrationSettings = { enabled: true, volume: 1, blocked: false, forcedOff: false };
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private entry: AudioEntry | undefined;
  private active = false;
  private paused = false;
  private pending = false;
  private padding = 0;
  private tail = 400;
  private stalled = 0;
  private position = 0;
  private token = 0;
  private speed = 1;
  private warned = new Set<string>();
  constructor(
    private manifest: NarrationManifest,
    private changed: () => void = () => {},
    private makeAudio: () => HTMLAudioElement = () => new Audio(),
    private storage?: Store,
    private warn: (message: string) => void = message => { if (process.env.NODE_ENV !== "production") console.warn(message); },
  ) {}
  configure(forcedOff = false) {
    this.paused = false;
    try {
      const stored = JSON.parse(this.storage?.getItem(NARRATION_KEY) ?? "null");
      if (stored && typeof stored.enabled === "boolean") this.settings.enabled = stored.enabled;
      if (stored && typeof stored.volume === "number" && Number.isFinite(stored.volume)) this.settings.volume = Math.max(0, Math.min(1, stored.volume));
    } catch { /* Storage is optional. */ }
    this.settings.forcedOff = forcedOff;
    this.changed();
  }
  private persist() {
    try { this.storage?.setItem(NARRATION_KEY, JSON.stringify({ enabled: this.settings.enabled, volume: this.settings.volume })); } catch { /* private browsing */ }
    this.changed();
  }
  setEnabled(enabled: boolean) {
    this.settings.enabled = enabled;
    if (!enabled) this.stop();
    this.persist();
  }
  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.settings.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) this.audio.volume = this.settings.volume;
    this.persist();
  }
  setSpeed(speed: number) {
    this.speed = speed;
    if (this.audio) { this.audio.playbackRate = narrationRate(speed); this.audio.preservesPitch = true; }
  }
  /** Called synchronously from the start click, before any server request. Reuse this unlocked element. */
  unlock() {
    if (!this.settings.enabled || this.settings.forcedOff || this.unlocked) return;
    const first = this.manifest.steps.find(e => selectAudio(this.manifest, e.id));
    if (!first) return;
    try {
      const audio = this.audio ??= this.makeAudio();
      const token = ++this.token;
      audio.src = first.file.replace(/^public/, "");
      audio.muted = false;
      audio.volume = 0;
      void audio.play().then(() => {
        if (token !== this.token) return;
        audio.pause(); audio.currentTime = 0; audio.volume = this.settings.volume;
        this.unlocked = true; this.settings.blocked = false; this.changed();
      }, (error: unknown) => {
        this.logPlayError("unlock", error, first.id);
        if (token !== this.token) return;
        audio.volume = this.settings.volume;
        this.settings.blocked = playError(error).name === "NotAllowedError";
        this.changed();
      });
    } catch (error) { this.logPlayError("unlock", error, first.id); this.settings.blocked = playError(error).name === "NotAllowedError"; this.changed(); }
  }
  begin(id: string, tail = 400) {
    this.stop();
    this.entry = selectAudio(this.manifest, id);
    if (!this.settings.enabled || this.settings.forcedOff || this.settings.volume === 0) return;
    if (!this.entry) { this.missing(id); return; }
    if (this.settings.blocked) return;
    try {
      const audio = this.audio ??= this.makeAudio();
      audio.src = this.entry.file.replace(/^public/, "");
      audio.currentTime = 0; audio.muted = false; audio.volume = this.settings.volume;
      this.setSpeed(this.speed);
      this.tail = tail; this.active = true; this.position = 0; this.stalled = 0;
      audio.onended = () => { this.active = false; this.padding = this.tail; };
      audio.onerror = () => { this.missing(id); this.stop(); };
      this.play();
    } catch { this.missing(id); this.stop(); }
  }
  private missing(id: string) {
    if (!this.warned.has(id)) { this.warned.add(id); this.warn(`[tour] recorded narration unavailable: ${id}; continuing silently`); }
  }
  private logPlayError(phase: "unlock" | "play", error: unknown, step: string) {
    const { name, message } = playError(error);
    this.warn(`[tour] audio play() rejected: step=${step} phase=${phase} ${name}: ${message}`);
  }
  private play() {
    const audio = this.audio;
    if (!audio) return;
    const step = this.entry?.id ?? "unknown";
    const token = ++this.token;
    this.pending = true;
    try {
      void audio.play().then(() => {
        if (token !== this.token) return;
        this.pending = false;
        this.unlocked = true;
        if (this.paused || !this.active) audio.pause();
      }, (error: unknown) => {
        this.logPlayError("play", error, step);
        if (token !== this.token) return;
        this.pending = false;
        if (playError(error).name === "NotAllowedError") { this.unlocked = false; this.settings.blocked = true; this.changed(); }
        this.stop();
      });
    } catch (error) { this.logPlayError("play", error, step); this.pending = false; this.settings.blocked = playError(error).name === "NotAllowedError"; if (this.settings.blocked) this.unlocked = false; this.stop(); this.changed(); }
  }
  enableSound() {
    this.settings.blocked = false; this.changed();
    // Restart only the current sentence, never earlier steps.
    if (this.entry && !this.paused) this.begin(this.entry.id, this.tail);
  }
  pause() {
    this.paused = true;
    // pause() rejects an in-flight play() with AbortError. Ignore that stale
    // attempt without discarding the active sentence needed by Resume.
    this.token++; this.pending = false;
    this.audio?.pause();
  }
  resume() { this.paused = false; if (this.active && !this.settings.blocked) this.play(); }
  stop() {
    this.token++; this.audio?.pause();
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; try { this.audio.currentTime = 0; } catch { /* unloaded */ } }
    this.active = false; this.pending = false; this.padding = 0; this.paused = false;
  }
  /** Active-clock tick, called even during existing step waits so audio and action waits overlap. */
  tick(ms: number) {
    if (this.paused) return;
    if (!this.active) { this.padding = Math.max(0, this.padding - ms); return; }
    const position = this.audio?.currentTime ?? 0;
    if (position > this.position) this.stalled = 0;
    else this.stalled += ms;
    this.position = position;
    // A missing/stalled file or never-settling play() must not freeze the tour.
    if (this.stalled >= 15000) { this.missing(this.entry?.id ?? "unknown"); this.stop(); }
  }
  get waiting() { return this.active || this.pending || this.padding > 0; }
}
