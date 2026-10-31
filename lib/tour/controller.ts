import { installPaypalGuard } from "./paypal-client-guard";
import audioManifest from "../../public/tour/audio/manifest.json";
import { TourNarrator, type NarrationSettings } from "./narrator";
import { ChapterSkip, SPEEDS, TargetMissing, TourAbort, TourRunner } from "./runner";
import { CHAPTERS, captionFor, chaptersFor, RETURN_PATHS, type Chapter, type ReturnTo, type Step, uiText } from "./script";

/**
 * Runs the guided demo in the browser. It drives the REAL app: it finds elements by `data-tour` attributes only,
 * and clicks real buttons with element.click(). Those clicks are synthetic (isTrusted=false); that is fine because
 * none of our handlers check isTrusted, and it is how the tour stays in sync with the product. Do not add isTrusted
 * checks to the app's handlers without updating the tour.
 */

export const STATE_KEY = "reloop_tour_state";
export const FLAG_COOKIE = "reloop_tour_on";
export const STALE_MS = 20_000;
export const OPEN_GUIDE_EVENT = "reloop:open-demo-guide";
export const START_EVENT = "reloop:start-tour";

export interface TourState {
  runId: string;
  chapter: number;
  step?: number;
  recording?: boolean;
  narrationOff?: boolean;
  startedAt: number;
  pausedTotalMs: number;
  speed: number;
  heartbeat: number;
  job?: { id: string; techId: string; techName: string };
  /** Where the tour sends the visitor when it ends or is stopped. */
  returnTo: ReturnTo;
  /** True for the home-page tour: the visitor's real session is left exactly as it was (the tour never touches it at all). */
  preserveSession: boolean;
  seededTechId: string | null;
  done: string[];
  failures: number;
}

export interface TourView {
  status: "idle" | "running" | "paused" | "ended" | "closing";
  chapterIndex: number;
  chapterCount: number;
  title: string;
  caption: string;
  position: "top" | "bottom";
  elapsedMs: number;
  speed: number;
  pausedBy: "user" | "button" | null;
  showEndActions: boolean;
  /** Set while the tour-only identity overlay is switched, e.g. "Technician (tour)". */
  viewingAs: string | null;
  narration: NarrationSettings;
  slate: "paypal-slate" | "paypal-slate-end" | null;
}

const IDLE: TourView = { status: "idle", chapterIndex: 0, chapterCount: CHAPTERS.length, title: "", caption: "", position: "bottom", elapsedMs: 0, speed: 1, pausedBy: null, showEndActions: false, viewingAs: null, narration: { enabled: true, volume: 1, blocked: false, forcedOff: false }, slate: null };
const PRODUCES: Record<string, string> = { agent: "job", control: "paid", technician: "completed" };

export const loadState = (): TourState | null => {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch {
    return null;
  }
};
const saveState = (s: TourState | null) => {
  try {
    if (s) sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* storage unavailable: the tour still runs, it just cannot resume after a reload */
  }
};
const hasFlagCookie = () => typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === `${FLAG_COOKIE}=1`);
const reducedMotion = () => document.documentElement.dataset.tourRecording === "true" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

const setNative = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value); // React tracks the native setter
};

export interface Deps {
  push: (path: string) => void;
  /** Re-renders server components (header, dashboards) after the tour identity or the tour session changes. */
  refresh: () => void;
  notify: (message: string) => void;
}

class TourController {
  private view: TourView = IDLE;
  private listeners = new Set<() => void>();
  private runner = new TourRunner();
  private state: TourState | null = null;
  private deps: Deps = { push: (p) => location.assign(p), refresh: () => {}, notify: () => {} };
  private returnTo: ReturnTo = "/";
  private ring: HTMLDivElement | null = null;
  private ringTarget: Element | null = null;
  private raf = 0;
  private timers: number[] = [];
  private uninstallGuard: (() => void) | null = null;
  private pauseStart = 0;
  private endResolve: ((how: "finish" | "real") => void) | null = null;
  private running = false;
  private slateHold: number | undefined;
  private narrator = new TourNarrator(audioManifest, () => this.emit({ narration: { ...this.narrator.settings } }), undefined, {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
  });

  setSlateHold(seconds?: number) { this.slateHold = seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined; }
  setNarration(enabled: boolean) { this.narrator.setEnabled(enabled); }
  setVolume(volume: number) { this.narrator.setVolume(volume); }
  enableSound() { this.narrator.enableSound(); }
  private configureNarration(s?: TourState | null) {
    const params = new URLSearchParams(location.search);
    const recording = params.get("record") === "1" || s?.recording === true;
    document.documentElement.dataset.tourRecording = String(recording);
    this.narrator.configure(params.get("narration") === "off" || s?.narrationOff === true);
  }

  configure(deps: Deps) {
    this.deps = deps;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getView = () => this.view;
  getServerView = () => IDLE;
  private emit(patch: Partial<TourView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- entry points ---------------------------------------------------------------------------------------

  /** Called once per full page load. Resumes a fresh run, or cleans up an interrupted one. */
  async bootstrap() {
    if (this.running) return;
    const s = loadState();
    this.configureNarration(s);
    const flag = hasFlagCookie();
    if (s && flag && Date.now() - s.heartbeat < STALE_MS) {
      this.state = s;
      this.returnTo = RETURN_PATHS.includes(s.returnTo) ? s.returnTo : "/";
      void this.loop();
    } else if (s || flag) {
      // An interrupted run: state is stale or lost (tab closed, storage cleared) but the server still has a session.
      await this.cleanupServer(s?.runId);
      saveState(null);
      this.deps.refresh();
      this.deps.notify(uiText("cleaned"));
    }
  }

  async start(returnTo: ReturnTo = "/") {
    if (this.running) return;
    if (!RETURN_PATHS.includes(returnTo)) returnTo = "/";
    this.configureNarration();
    this.narrator.unlock();
    let runId: string;
    let seededTechId: string | null = null;
    try {
      const res = await fetch("/api/tour/start", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The guided demo could not start.");
      const body = (await res.json()) as { runId: string; seededTechId?: string | null };
      runId = body.runId;
      seededTechId = body.seededTechId ?? null;
    } catch (e) {
      this.deps.notify(e instanceof Error ? e.message : "The guided demo could not start.");
      return;
    }
    this.state = { runId, chapter: 0, step: 0, recording: document.documentElement.dataset.tourRecording === "true", narrationOff: this.narrator.settings.forcedOff, startedAt: Date.now(), pausedTotalMs: 0, speed: 1, heartbeat: Date.now(), returnTo, preserveSession: returnTo === "/", seededTechId, done: [], failures: 0 };
    this.returnTo = returnTo;
    this.deps.refresh(); // the header now shows the tour identity instead of the visitor's account
    saveState(this.state);
    void this.loop();
  }

  // ---- controls -------------------------------------------------------------------------------------------

  pause(by: "user" | "button" = "button") {
    if (this.view.status !== "running") return;
    this.runner.pause();
    this.pauseStart = Date.now();
    this.emit({ status: "paused", pausedBy: by });
  }
  resume() {
    if (this.view.status !== "paused") return;
    if (this.state && this.pauseStart) this.state.pausedTotalMs += Date.now() - this.pauseStart;
    this.pauseStart = 0;
    this.runner.resume();
    this.emit({ status: "running", pausedBy: null });
  }
  skipChapter() {
    if (this.view.status === "paused") {
      if (this.state && this.pauseStart) this.state.pausedTotalMs += Date.now() - this.pauseStart;
      this.pauseStart = 0;
      this.emit({ status: "running", pausedBy: null });
    }
    this.runner.skipChapter();
  }
  setSpeed(speed: number) {
    if (!(SPEEDS as readonly number[]).includes(speed)) return;
    this.runner.setSpeed(speed);
    if (this.state) this.state.speed = speed;
    this.emit({ speed });
  }
  async stop() {
    if (!this.running && this.view.status === "idle") return;
    this.runner.abort();
    this.endResolve?.("finish");
    await this.teardown(true, uiText("stopped"));
    this.leave();
  }
  /** Back to where the tour started, and re-render so the header shows the visitor's real account again. */
  private leave() {
    this.deps.push(this.returnTo);
    this.deps.refresh();
  }
  /** Closing buttons on the last chapter. */
  finish() {
    this.narrator.stop();
    this.endResolve?.("finish");
  }
  tryReal() {
    this.narrator.stop();
    this.endResolve?.("real");
  }
  closeMessage() {
    this.emit({ ...IDLE });
    this.leave();
  }

  // ---- main loop ------------------------------------------------------------------------------------------

  private async loop() {
    const state = this.state!;
    const chapters = chaptersFor(state.returnTo);
    this.running = true;
    this.runner = new TourRunner(undefined, undefined, this.narrator);
    this.runner.setSpeed(state.speed);
    this.uninstallGuard = installPaypalGuard(window, () => {});
    this.ensureRing();
    this.attachUserGuards();
    this.timers.push(window.setInterval(() => this.heartbeat(), 1000));
    this.emit({ ...IDLE, narration: { ...this.narrator.settings }, status: "running", speed: state.speed, chapterIndex: state.chapter, chapterCount: chapters.length, title: chapters[state.chapter]?.title ?? "" });

    let how: "finish" | "real" | null = null;
    try {
      for (let i = state.chapter; i < chapters.length; i++) {
        const chapter = chapters[i];
        const firstStep = i === state.chapter ? (state.step ?? 0) : 0;
        state.chapter = i;
        state.step = firstStep;
        saveState(state);
        this.emit({ chapterIndex: i, title: chapter.title });
        if (chapter.needs?.some((n) => !state.done.includes(n))) {
          console.warn(`[tour] skipping "${chapter.title}": an earlier chapter did not finish`);
          continue;
        }
        try {
          for (let j = firstStep; j < chapter.steps.length; j++) {
            const step = chapter.steps[j];
            state.step = j;
            saveState(state);
            const r = await this.exec(step, chapter);
            await this.runner.finishNarration();
            this.narrator.stop();
            this.emit({ slate: null });
            state.step = j + 1;
            saveState(state);
            if (r) how = r;
          }
          const flag = PRODUCES[chapter.id];
          if (flag && !state.done.includes(flag)) state.done.push(flag);
          state.step = 0;
          state.chapter = i + 1;
          saveState(state);
        } catch (e) {
          if (e instanceof ChapterSkip) {
            this.narrator.stop();
            this.emit({ slate: null });
            state.step = 0; state.chapter = i + 1; saveState(state);
            console.warn(`[tour] chapter skipped: ${chapter.title}`);
            continue;
          }
          if (e instanceof TargetMissing) {
            this.narrator.stop();
            this.emit({ slate: null });
            state.step = 0; state.chapter = i + 1;
            state.failures += 1;
            console.warn(`[tour] ${e.message} (chapter "${chapter.title}")`);
            if (state.failures >= 2) {
              await this.teardown(true, uiText("ended"), "ended");
              return;
            }
            continue;
          }
          throw e;
        }
      }
      if (state.failures > 0 && how === null) how = "finish";
      await this.teardown(true, "", "idle");
      this.leave();
      if (how === "real") window.setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_GUIDE_EVENT)), 600);
    } catch (e) {
      if (e instanceof TourAbort) return; // stop() already cleaned up
      console.error("[tour] unexpected error", e);
      await this.teardown(true, uiText("ended"), "ended");
    }
  }

  private async exec(step: Step, chapter: Chapter): Promise<"finish" | "real" | null> {
    const r = this.runner;
    const job = this.state?.job;
    const speaking = (key: string | undefined, el: Element | null) => {
      if (key) {
        this.emit({ caption: captionFor(key), position: this.positionFor(el) });
        this.narrator.begin(key);
      }
    };
    switch (step.t) {
      case "slate": {
        this.setRing(null);
        this.emit({ caption: captionFor(step.cap), slate: step.id, position: "bottom" });
        const leadSlate = step.id === "paypal-slate";
        this.narrator.begin(step.id, leadSlate && this.slateHold === undefined ? 3000 : 400);
        await r.wait((leadSlate && this.slateHold !== undefined ? this.slateHold * 1000 : step.ms) * r.speed);
        return null;
      }
      case "nav": {
        const path = step.to === "$jobPath" ? `/jobs/${job?.id ?? ""}` : step.to === "$seededTechPath" ? this.seededTechPath() : "/";
        if (`${location.pathname}${location.search}` !== path) this.deps.push(path);
        if (!(await r.until(() => `${location.pathname}${location.search}` === path, 10_000))) throw new TargetMissing(path);
        await r.wait(600);
        return null;
      }
      case "wait": {
        if (!(await r.until(() => this.find(step.target), step.timeoutMs ?? 15_000))) throw new TargetMissing(step.target);
        return null;
      }
      case "role": {
        // Switch the tour-only overlay. The visitor's real session cookie is never sent a Set-Cookie by this call.
        speaking(step.cap, this.find(step.target));
        const techId = step.role === "technician" ? job?.techId : undefined;
        const res = await fetch("/api/tour/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: step.role, techId }) });
        if (!res.ok) throw new TargetMissing("tour role");
        this.emit({ viewingAs: step.role === "technician" ? `Technician (tour)${job?.techName ? `: ${job.techName}` : ""}` : "Owner (tour)" });
        this.deps.refresh();
        await r.wait(1800);
        return null;
      }
      case "capture": {
        const card = this.find("quote-card");
        const id = card?.getAttribute("data-job-id");
        if (!card || !id) throw new TargetMissing("quote-card");
        this.state!.job = { id, techId: card.getAttribute("data-tech-id") ?? "", techName: card.getAttribute("data-tech-name") ?? "" };
        saveState(this.state);
        return null;
      }
      case "end": {
        const el = document.querySelector('[data-tour="tour-bar"]');
        speaking(step.cap, el);
        this.setRing(null);
        await r.finishNarration();
        this.emit({ showEndActions: true, position: "bottom" });
        const how = await new Promise<"finish" | "real">((resolve) => (this.endResolve = resolve));
        if (this.runner.aborted) throw new TourAbort(); // Stop pressed: stop() already cleaned up
        return how;
      }
      default:
        break;
    }

    const el = await r.until(() => this.find(step.target), 15_000);
    if (!el) {
      if ("optional" in step && step.optional) {
        console.warn(`[tour] optional target missing, step skipped: ${step.target}`);
        return null;
      }
      throw new TargetMissing(step.target);
    }
    if ("cap" in step && step.cap) this.emit({ caption: captionFor(step.cap), position: this.positionFor(el) });
    el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    await r.wait(reducedMotion() ? 100 : 450);
    this.setRing(el);
    // Re-evaluate the caption position now that the target is scrolled into view.
    if ("cap" in step) speaking(step.cap, el);

    switch (step.t) {
      case "say":
        await r.wait(step.ms);
        break;
      case "click":
        await r.wait(step.ms ?? 900);
        await r.finishNarration();
        (el as HTMLElement).click();
        await r.wait(350);
        break;
      case "type": {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        input.focus();
        setNative(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (let i = 1; i <= step.text.length; i++) {
          setNative(input, step.text.slice(0, i));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await r.wait(28);
        }
        await r.wait(600);
        break;
      }
      case "upload": {
        const res = await fetch(step.url);
        if (!res.ok) throw new TargetMissing(step.url);
        const file = new File([await res.blob()], "tour-proof.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        (el as HTMLInputElement).files = dt.files;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        await r.wait(1800);
        break;
      }
    }
    void chapter;
    return null;
  }

  // ---- DOM helpers ----------------------------------------------------------------------------------------

  /** Finds a target by data-tour name only. "name@job" narrows to the element inside the tour job's own card/form. */
  private find(name: string): Element | null {
    const forJob = name.endsWith("@job");
    const base = forJob ? name.slice(0, -4) : name;
    for (const el of Array.from(document.querySelectorAll(`[data-tour="${base}"]`))) {
      if (!el.getClientRects().length) continue;
      if (forJob && el.closest("[data-job-id]")?.getAttribute("data-job-id") !== this.state?.job?.id) continue;
      return el;
    }
    return null;
  }

  private seededTechPath() {
    // The seeded technician with a verified record, as chosen by the server when the tour started.
    const id = this.state?.seededTechId;
    if (!id) throw new TargetMissing("seeded technician");
    return `/tech/${id}`;
  }

  private positionFor(el: Element | null): "top" | "bottom" {
    if (!el) return "bottom";
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 > window.innerHeight * 0.75 ? "top" : "bottom";
  }

  private ensureRing() {
    if (this.ring) return;
    const ring = document.createElement("div");
    ring.setAttribute("data-tour-ring", "");
    ring.setAttribute("aria-hidden", "true");
    ring.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;display:none;border:3px solid #f59e0b;border-radius:10px;box-shadow:0 0 0 4px rgba(245,158,11,.35)";
    if (!reducedMotion()) ring.style.transition = "all 180ms ease-out";
    document.body.appendChild(ring);
    this.ring = ring;
    const place = () => {
      if (this.ringTarget && this.ring) {
        if (!this.ringTarget.isConnected) this.ring.style.display = "none";
        else {
          const r = this.ringTarget.getBoundingClientRect();
          Object.assign(this.ring.style, { display: "block", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
        }
      }
      this.raf = requestAnimationFrame(place);
    };
    this.raf = requestAnimationFrame(place);
  }
  private setRing(el: Element | null) {
    this.ringTarget = el;
    if (!el && this.ring) this.ring.style.display = "none";
  }

  private userGuard = (e: Event) => {
    // A real person clicked or typed into the page: stop fighting them. (Tour clicks are untrusted, so they never land here.)
    if (!e.isTrusted || this.view.status !== "running") return;
    if ((e.target as Element | null)?.closest?.('[data-tour="tour-bar"]')) return;
    if (e instanceof KeyboardEvent && e.key === "Escape") return;
    this.pause("user");
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.view.status !== "idle") void this.stop();
  };
  private attachUserGuards() {
    document.addEventListener("pointerdown", this.userGuard, true);
    document.addEventListener("keydown", this.userGuard, true);
    document.addEventListener("keydown", this.onKey, true);
  }
  private detachUserGuards() {
    document.removeEventListener("pointerdown", this.userGuard, true);
    document.removeEventListener("keydown", this.userGuard, true);
    document.removeEventListener("keydown", this.onKey, true);
  }

  private heartbeat() {
    const s = this.state;
    if (!s) return;
    s.heartbeat = Date.now();
    saveState(s);
    const paused = this.view.status === "paused" && this.pauseStart ? Date.now() - this.pauseStart : 0;
    this.emit({ elapsedMs: Date.now() - s.startedAt - s.pausedTotalMs - paused });
  }

  // ---- cleanup --------------------------------------------------------------------------------------------

  private async cleanupServer(runId?: string) {
    try {
      await fetch("/api/tour/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runId ? { runId } : {}), keepalive: true });
    } catch {
      console.warn("[tour] cleanup request failed; the server purges tour data older than 2 hours on the next start");
    }
  }

  private async teardown(cleanup: boolean, message: string, status: "idle" | "ended" = "idle") {
    this.narrator.stop();
    const runId = this.state?.runId;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    cancelAnimationFrame(this.raf);
    this.ring?.remove();
    this.ring = null;
    this.ringTarget = null;
    this.detachUserGuards();
    this.uninstallGuard?.();
    this.uninstallGuard = null;
    if (cleanup) await this.cleanupServer(runId);
    saveState(null);
    this.state = null;
    this.running = false;
    this.endResolve = null;
    this.view = { ...IDLE, status: status === "ended" ? "ended" : "idle", caption: status === "ended" ? message : "" };
    this.listeners.forEach((l) => l());
    if (status === "idle" && message) this.deps.notify(message);
  }
}

export const tour = new TourController();
