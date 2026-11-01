/**
 * End-to-end check of the guided demo in a real browser against a PRODUCTION build. Run: npm run verify:tour
 * (needs `npm run build` first). It starts its own server on a throwaway database with PayPal credentials set to
 * dummy values (so the app is in "sandbox" mode and WOULD call PayPal if the tour ever did) and checks:
 *   - the whole tour finishes at 1280 px (measured at 1x speed) and at 412 px
 *   - zero requests to any paypal host or /api/paypal/*, no console errors, axe-clean caption bar
 *   - no isTour rows or uploaded files left behind
 *   - a reload mid-chapter resumes; an abandoned tour (tab closed / stale state) is cleaned on the next load
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { audioSnapshot, mockTourAudio, narrationSequenceDifferences } from "./tour-audio-mock";
import manifest from "../public/tour/audio/manifest.json";
import { captionFor, chaptersFor } from "../lib/tour/script";

const PORT = process.env.TOUR_PORT ?? "3410";
const BASE = `http://localhost:${PORT}`;
const root = process.cwd();
const bin = (p: string) => path.join(root, "node_modules", p);
const axeSource = readFileSync(bin("axe-core/axe.min.js"), "utf8");
const candidates = [
  process.env.EDGE_PATH, process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean) as string[];

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

async function main() {
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("No production build found. Run: npm run build");
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) throw new Error("No Edge/Chrome found. Set EDGE_PATH.");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reloop-tour-"));
  const dbUrl = `file:${path.join(tmp, "tour.db").replaceAll("\\", "/")}`;
  const uploads = path.join(tmp, "uploads");
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", DATABASE_URL: dbUrl, UPLOAD_DIR: uploads, PORT,
    DEMO_ACTIONS: "true", DEMO_MODE: "true", ANTHROPIC_API_KEY: "", PAYPAL_SIMULATE_APPROVAL: "false",
    PAYPAL_CLIENT_ID: "dummy-client-id", PAYPAL_CLIENT_SECRET: "dummy-secret", NEXT_PUBLIC_APP_URL: BASE,
  };
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: "pipe" });
    if (r.status !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  };
  run([bin("prisma/build/index.js"), "migrate", "deploy"]);
  run([bin("tsx/dist/cli.mjs"), "prisma/seed.ts"]);
  const server: ChildProcess = spawn(process.execPath, [bin("next/dist/bin/next"), "start", "-p", PORT], { cwd: root, env, stdio: "pipe" });
  const serverLog: string[] = [];
  server.stdout?.on("data", (d) => serverLog.push(String(d)));
  server.stderr?.on("data", (d) => serverLog.push(String(d)));
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  let browser: Browser | null = null;
  try {
    for (let i = 0; i < 60; i++) {
      if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    browser = await chromium.launch({ executablePath: exe, headless: true });

    const leftovers = async () => ({
      jobs: await prisma.job.count({ where: { isTour: true } }),
      devices: await prisma.device.count({ where: { isTour: true } }),
      runs: await prisma.agentRun.count({ where: { isTour: true } }),
      sessions: await prisma.tourRun.count(),
      files: existsSync(uploads) ? readdirSync(uploads).length : 0,
    });
    const clean = async () => Object.values(await leftovers()).every((n) => n === 0);
    const waitClean = async (ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await clean()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

    const newContext = async (width: number, height: number, mobile = false) => {
      const ctx = await browser!.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      await mockTourAudio(ctx);
      const seen = { requests: [] as string[], consoleErrors: [] as string[] };
      ctx.on("request", (r) => seen.requests.push(r.url()));
      ctx.on("page", (p) => {
        p.on("console", (m) => { if (m.type() === "error") seen.consoleErrors.push(m.text().slice(0, 200)); });
        p.on("pageerror", (e) => seen.consoleErrors.push(`pageerror ${e.message.slice(0, 200)}`));
      });
      return { ctx, seen };
    };
    const bar = (p: Page) => p.locator('[data-tour="tour-bar"]');
    const start = async (p: Page) => {
      await p.goto(BASE + "/", { waitUntil: "networkidle" });
      await p.locator('[data-tour="start-tour"]').click();
      await bar(p).waitFor({ timeout: 20000 });
    };
    const finishButton = (p: Page) => p.getByRole("button", { name: /^Finish$/ });
    const axeBar = async (p: Page, label: string) => {
      await p.evaluate(axeSource);
      const v = await p.evaluate(async () => {
        // @ts-expect-error axe is injected above
        const r = await axe.run('[data-tour="tour-bar"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
        return r.violations.filter((x: { impact: string }) => x.impact === "serious" || x.impact === "critical").map((x: { id: string }) => x.id);
      });
      check(v.length === 0, `axe: caption bar has no serious/critical violations (${label})${v.length ? `: ${v.join(", ")}` : ""}`);
    };
    const paypalRequests = (urls: string[]) => urls.filter((u) => /(^|\.)paypal(objects)?\.com/i.test(new URL(u).hostname) || new URL(u).pathname.startsWith("/api/paypal"));

    for (const vp of [{ name: "1280 px (1x speed)", w: 1280, h: 800, mobile: false, speed: "1" }, { name: "412 px mobile (2x speed)", w: 412, h: 915, mobile: true, speed: "2" }]) {
      console.log(`\nFull tour at ${vp.name}`);
      const { ctx, seen } = await newContext(vp.w, vp.h, vp.mobile);
      const page = await ctx.newPage();
      const t0 = Date.now();
      await start(page);
      check(await page.evaluate(() => typeof (window as unknown as { __name?: unknown }).__name === "function" && window.Audio.name === "RecordedAudio"), "browser helper and Audio mock installed before the app runs");
      if (vp.speed !== "1") await page.locator('[data-tour="tour-bar"] select').selectOption(vp.speed);
      let axed = false;
      const slates = new Set<string>();
      try {
        const deadline = Date.now() + 8 * 60_000;
        while (Date.now() < deadline) {
          if (await finishButton(page).isVisible().catch(() => false)) break;
          const slate = page.locator('[data-tour="paypal-slate-banner"]');
          if (await slate.isVisible()) {
            const id = await slate.getAttribute("data-slate-id");
            if (id && !slates.has(id)) { slates.add(id); await axeBar(page, id); }
          }
          if (!axed && /Chapter [3-9]/.test((await bar(page).innerText().catch(() => "")))) { await axeBar(page, vp.name); axed = true; }
          const text = await bar(page).innerText().catch(() => "");
          if (/Tour ended early/.test(text)) throw new Error(`the tour ended early: ${text.replace(/\s+/g, " ")}`);
          await page.waitForTimeout(500);
        }
        const took = Date.now() - t0;
        check(await finishButton(page).isVisible(), `tour reached its last chapter in ${mmss(took)} (${took} ms)`);
        if (vp.speed === "1") console.log(`  MEASURED narrated home tour at 1x: ${mmss(took)} (${took} ms); includes action waits, excludes final user decision.`);
        check(slates.has("paypal-slate") && slates.has("paypal-slate-end"), "both editor slate steps displayed");
        const played = (await audioSnapshot(page)).played;
        const available = new Set(manifest.steps.map(e => e.id));
        const expected = chaptersFor("/").flatMap(c => c.steps.flatMap(s => "cap" in s && s.cap ? ["id" in s ? s.id : s.cap] : [])).filter(id => available.has(id));
        const sequence = narrationSequenceDifferences(expected, played);
        check(sequence.ok, "recorded narration fires exactly once per available step, in order (including slates when generated)");
        if (!sequence.ok) console.log(`  Sequence diagnostics: ${JSON.stringify({ ...sequence, expected, played })}`);
        for (const id of ["paypal-slate", "paypal-slate-end"]) if (!available.has(id)) console.log(`  NOTE  ${id} audio is not generated yet; banner tested, narration remains silent until generation and rebuild.`);
        await axeBar(page, `${vp.name}, closing caption`);
        await finishButton(page).click();
        await page.waitForURL(`${BASE}/`, { timeout: 15000 });
        await bar(page).waitFor({ state: "detached", timeout: 15000 });
        check((await audioSnapshot(page)).active === 0, "Finish leaves no audio playing");
        pass("Finish returned to the landing page and removed the caption bar");
      } catch (e) {
        fail(`tour did not finish: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        await page.screenshot({ path: path.join(tmp, `fail-${vp.w}.png`) }).catch(() => {});
        console.log(`        screenshot: ${path.join(tmp, `fail-${vp.w}.png`)}`);
      }
      check(await waitClean(), `no isTour leftovers in the database or uploads (${JSON.stringify(await leftovers())})`);
      const pp = paypalRequests(seen.requests);
      check(pp.length === 0, `zero requests to PayPal hosts or /api/paypal/* (${seen.requests.length} requests seen${pp.length ? `; first: ${pp[0]}` : ""})`);
      check(seen.consoleErrors.length === 0, `no console errors${seen.consoleErrors.length ? `: ${seen.consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
      await ctx.close();
    }

    console.log("\nInterruptions");
    for (const mode of ["mute", "url-off", "blocked"] as const) {
      const { ctx, seen } = await newContext(1280, 800);
      if (mode !== "url-off") await ctx.addInitScript(mode => {
        if (mode === "mute") localStorage.setItem("reloop_tour_narration", JSON.stringify({ enabled: false, volume: 1 }));
        else localStorage.setItem("reloop_test_audio_blocked", "1");
      }, mode);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?record=1${mode === "url-off" ? "&narration=off" : ""}`, { waitUntil: "networkidle" });
      check(await page.evaluate(() => window.Audio.name === "RecordedAudio"), `${mode}: Audio mock installed`);
      await page.locator('[data-tour="start-tour"]').click();
      await bar(page).waitFor();
      await bar(page).locator("select").selectOption("2");
      if (mode === "blocked") {
        await page.waitForFunction(() => (window as unknown as { __tourAudio: { attempts: { allowed: boolean }[] } }).__tourAudio.attempts.some(a => !a.allowed));
        check((await audioSnapshot(page)).attempts.some(a => !a.allowed), "blocked: mock play() actually rejected with NotAllowedError");
        await page.getByRole("button", { name: "Tap to enable sound" }).waitFor();
      }
      await finishButton(page).waitFor({ timeout: 8 * 60_000 });
      check((await audioSnapshot(page)).played.length === 0, `${mode}: tour completes silently without replaying audio`);
      await finishButton(page).click();
      await bar(page).waitFor({ state: "detached" });
      check((await audioSnapshot(page)).active === 0, `${mode}: Finish cancels audio`);
      check(seen.consoleErrors.length === 0 && paypalRequests(seen.requests).length === 0, `${mode}: zero console errors or PayPal requests`);
      await ctx.close();
    }
    {
      const { ctx } = await newContext(1280, 800);
      const page = await ctx.newPage();
      await start(page);
      await page.waitForFunction(() => (window as unknown as { __tourAudio: { active: number } }).__tourAudio.active > 0);
      await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
      check((await audioSnapshot(page)).active === 0, "Pause stops audio immediately");
      await bar(page).getByRole("button", { name: "Resume", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { __tourAudio: { active: number } }).__tourAudio.active > 0);
      await bar(page).getByRole("button", { name: "Stop (Esc)", exact: true }).click();
      await bar(page).waitFor({ state: "detached" });
      check((await audioSnapshot(page)).active === 0, "Stop cancels audio immediately");
      await ctx.close();
    }
    {
      // A: a reload in the middle of a chapter resumes the same run and still finishes cleanly.
      const { ctx, seen } = await newContext(1280, 800);
      const page = await ctx.newPage();
      await start(page);
      await page.locator('[data-tour="tour-bar"] select').selectOption("2");
      await bar(page).getByText(/Chapter 2 of/).waitFor({ timeout: 60_000 });
      await bar(page).getByRole("status").filter({ hasText: captionFor("agent.trace") }).waitFor({ timeout: 120000 });
      // A new document has no retained element/activation. Force the exact
      // browser-shaped rejection until the user taps the recovery control.
      await page.evaluate(() => sessionStorage.setItem("reloop_test_audio_blocked", "1"));
      await page.reload({ waitUntil: "domcontentloaded" });
      try {
        await bar(page).waitFor({ timeout: 15000 });
        const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("reloop_tour_state") ?? "{}") as { chapter: number; step: number });
        const resumedChapter = chaptersFor("/")[saved.chapter];
        const completed = resumedChapter?.steps.slice(0, saved.step).flatMap(s => "cap" in s && s.cap ? ["id" in s ? s.id : s.cap] : []) ?? [];
        pass("after a reload mid-chapter the tour bar is back (resumed)");
        const enableSound = page.getByRole("button", { name: "Tap to enable sound", exact: true });
        await enableSound.waitFor({ state: "visible", timeout: 15000 });
        check((await audioSnapshot(page)).played.length === 0, "after reload, denied autoplay is silent and shows the sound button");
        const current = await page.evaluate(() => JSON.parse(sessionStorage.getItem("reloop_tour_state") ?? "{}") as { chapter: number; step: number });
        const currentStep = chaptersFor("/")[current.chapter]?.steps[current.step];
        const currentAudio = currentStep && "cap" in currentStep ? ("id" in currentStep ? currentStep.id : currentStep.cap) : undefined;
        await page.evaluate(() => sessionStorage.removeItem("reloop_test_audio_blocked"));
        await enableSound.click();
        await page.waitForFunction(() => (window as unknown as { __tourAudio: { active: number } }).__tourAudio.active > 0);
        const retried = await audioSnapshot(page);
        check(retried.played[0] === currentAudio, "Tap to enable sound restarts the current step after reload");
        check(retried.attempts.some(a => a.allowed && a.id === currentAudio && a.start === 0), "retried current audio starts from zero");
        await enableSound.waitFor({ state: "hidden" });
        await finishButton(page).waitFor({ timeout: 6 * 60_000 });
        check(!(await audioSnapshot(page)).played.some(id => completed.includes(id)), "reload does not replay completed steps in its chapter");
        await finishButton(page).click();
        pass("the resumed tour ran to the end");
      } catch (e) {
        fail(`resume after reload: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
      check(await waitClean(), "resumed run left nothing behind");
      check(paypalRequests(seen.requests).length === 0, "resumed run made zero PayPal requests");
      await ctx.close();
    }
    {
      // B: tab closed mid-tour (sessionStorage gone, cookie remains): the next page load cleans up.
      const { ctx } = await newContext(1280, 800);
      const page = await ctx.newPage();
      await start(page);
      await page.locator('[data-tour="tour-bar"] select').selectOption("2");
      await bar(page).getByText(/Chapter 4 of/).waitFor({ timeout: 90_000 });
      check((await leftovers()).jobs > 0, "mid-tour, a tagged tour job exists");
      await page.close();
      const again = await ctx.newPage();
      await again.goto(BASE + "/", { waitUntil: "networkidle" });
      check(await waitClean(), "abandoned tour (tab closed) was cleaned on the next page load");
      check((await bar(again).count()) === 0, "no caption bar after the cleanup");
      await ctx.close();
    }
    {
      // C: stale saved state (heartbeat too old) is cleaned instead of resumed.
      const { ctx } = await newContext(1280, 800);
      const page = await ctx.newPage();
      await start(page);
      await bar(page).getByText(/Chapter 3 of/).waitFor({ timeout: 120_000 }).catch(() => {});
      await page.evaluate(() => {
        const s = JSON.parse(sessionStorage.getItem("reloop_tour_state") ?? "{}");
        s.heartbeat = 0;
        sessionStorage.setItem("reloop_tour_state", JSON.stringify(s));
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle" }); // hard load
      check(await waitClean(), "stale tour state was cleaned on the next page load instead of resumed");
      await ctx.close();
    }
  } finally {
    await browser?.close();
    await prisma.$disconnect();
    server.kill();
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    if (failures) console.log(`\nserver log tail:\n${serverLog.join("").split("\n").slice(-15).join("\n")}`);
    await new Promise((r) => setTimeout(r, 500));
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} problem(s)` : "\nAll tour checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

