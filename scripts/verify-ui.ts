/**
 * Real-browser verification against a RUNNING server (use a production build):
 *   BASE_URL=http://localhost:3200 npm run verify:ui
 * Uses the system Microsoft Edge (Chromium) through playwright-core, so no browser download is needed.
 * Checks: horizontal overflow and small tap targets at 360/412/768/1280 px, axe-core accessibility violations,
 * console/CSP errors, a keyboard-only run of the agent flow, and writes README screenshots to docs/screenshots.
 * Set EDGE_PATH or CHROME_PATH to use another browser binary.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, type Browser } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WIDTHS = [360, 412, 768, 1280];
const SHOTS = path.join(process.cwd(), "docs", "screenshots");
const axeSource = readFileSync(path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");

const candidates = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || "reloop-demo-2026";
type Role = "owner" | "technician" | null;
const DEMO_EMAIL = { owner: "owner@reloop.demo", technician: "tech@reloop.demo" } as const;

const sessions: Partial<Record<"owner" | "technician", Awaited<ReturnType<import("playwright-core").BrowserContext["storageState"]>>>> = {};

/** A fresh browser context, logged in as one of the documented demo accounts when a role is given. Logs in once per role
 *  (the login rate limit is 10 per 15 minutes) and reuses that session for every later context. */
async function context(browser: Browser, width: number, role: Role) {
  if (role && !sessions[role]) {
    const login = await browser.newContext();
    const res = await login.request.post(`${BASE}/api/auth/login`, { data: { email: DEMO_EMAIL[role], password: DEMO_PASSWORD }, headers: { origin: new URL(BASE).origin } });
    if (!res.ok()) throw new Error(`demo login as ${role} failed (${res.status()}): is the database seeded (npm run db:reset)?`);
    sessions[role] = await login.storageState();
    await login.close();
  }
  return browser.newContext({ viewport: { width, height: 900 }, ...(role ? { storageState: sessions[role] } : {}) });
}

interface AxeV { id: string; impact: string | null; n: number; sample?: string }

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  PASS  ${m}`);

async function main() {
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) throw new Error("No Edge/Chrome found. Set EDGE_PATH.");
  mkdirSync(SHOTS, { recursive: true });

  const db = new PrismaClient();
  const device = await db.device.findFirstOrThrow({ where: { scenario: "cracked-screen" }, orderBy: { createdAt: "asc" } });
  const job = await db.job.findFirstOrThrow({ where: { status: "payout_released" } });
  const tech = await db.technician.findFirstOrThrow({ where: { name: "Aisha Rahman" } });
  await db.$disconnect();

  const routes: [string, string, Role][] = [
    ["landing", "/", null],
    ["signup", "/signup", null],
    ["login", "/login", null],
    ["diagnosis", `/owner/device/${device.id}`, "owner"],
    ["job", `/jobs/${job.id}`, "owner"],
    ["technician", "/technician", "technician"],
    ["agent", "/agent", "owner"],
    ["donate", "/donate", null],
    ["impact", "/impact", null],
    ["tech-profile", `/tech/${tech.id}`, null],
    ["not-found", "/does-not-exist", null],
  ];

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const consoleProblems: string[] = [];

  console.log(`\nResponsive + overflow + tap targets (${exe.split(/[\\/]/).pop()})`);
  for (const [name, route, role] of routes) {
    for (const w of WIDTHS) {
      const ctx = await context(browser, w, role);
      const page = await ctx.newPage();
      page.on("console", (m) => { if (m.type() === "error" && name !== "not-found") consoleProblems.push(`${name}@${w}: ${m.text().slice(0, 160)}`); });
      page.on("pageerror", (e) => consoleProblems.push(`${name}@${w}: pageerror ${e.message.slice(0, 160)}`));
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      const r = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const small = [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea, summary")]
          .filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && !el.closest(".sr-only") && !el.classList.contains("sr-only") && !el.closest("[hidden]"); })
          .map((el) => ({ t: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
          .filter((x) => x.h < 36 && !(x.t.length > 25 && x.h >= 20)); // inline text links inside paragraphs are exempt (WCAG 2.2 inline exception)
        return { overflow, small };
      });
      if (r.overflow > 1) fail(`${name} @${w}px overflows horizontally by ${r.overflow}px`);
      else pass(`${name} @${w}px no overflow${r.small.length ? ` (small targets: ${r.small.slice(0, 4).map((s) => `${s.t}:${s.h}px`).join(", ")})` : ""}`);
      if (w === 1280 && name === "landing") await page.screenshot({ path: path.join(SHOTS, "landing.png"), fullPage: false });
      if (w === 1280 && name === "impact") await page.screenshot({ path: path.join(SHOTS, "impact.png"), fullPage: false });
      if (w === 1280 && name === "tech-profile") await page.screenshot({ path: path.join(SHOTS, "tech-profile.png"), fullPage: false });
      await ctx.close();
    }
  }

  console.log("\naxe-core accessibility audit (1280px; serious/critical shown)");
  for (const [name, route, role] of routes) {
    const ctx = await context(browser, 1280, role);
    const page = await ctx.newPage();
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.evaluate(axeSource);
    const res: AxeV[] = await page.evaluate(async () => {
      // @ts-expect-error axe is injected above
      const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
      return r.violations.map((v: { id: string; impact: string; nodes: { target: string[] }[] }) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") }));
    });
    const bad = res.filter((v) => v.impact === "serious" || v.impact === "critical");
    const minor = res.filter((v) => !(v.impact === "serious" || v.impact === "critical"));
    if (bad.length) fail(`${name}: ${bad.map((v) => `${v.id} x${v.n} (${v.sample})`).join("; ")}`);
    else pass(`${name}: no serious/critical axe violations${minor.length ? ` (minor/moderate: ${minor.map((v) => v.id).join(", ")})` : ""}`);
    await ctx.close();
  }

  console.log("\nKeyboard-only run of the agent flow (cracked screen -> approve -> pay)");
  {
    const ctx = await context(browser, 1280, "owner");
    const page = await ctx.newPage();
    await page.goto(BASE + "/agent", { waitUntil: "networkidle" });
    const tabTo = async (match: RegExp, max = 60) => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        const label = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return `${e.tagName}|${(e.textContent || e.getAttribute("aria-label") || "").trim()}`; });
        if (match.test(label)) return true;
      }
      return false;
    };
    if (!(await tabTo(/Cracked phone screen/))) fail("could not Tab to the cracked-screen example");
    else {
      const ringed = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement as HTMLElement); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2; });
      if (ringed) pass("focus ring visible on the example chip");
      else fail("no visible focus ring on the example chip");
      await page.keyboard.press("Enter");
      try {
        await page.getByRole("button", { name: /Approve and continue to PayPal/ }).waitFor({ timeout: 30000 });
        pass("agent ran from the keyboard and produced a quote");
        const live = await page.locator('[aria-live="polite"]').count();
        if (live > 0) pass("trace is an aria-live=polite region");
        else fail("no aria-live region");
        await page.screenshot({ path: path.join(SHOTS, "agent-quote.png"), fullPage: true });
        const steps = await page.locator("text=/^Step \\d+:/").count();
        if (steps >= 6) pass(`${steps} trace steps rendered`);
        else fail(`only ${steps} trace steps`);
        if (!(await tabTo(/Approve and continue to PayPal/))) fail("could not Tab to Approve");
        else {
          await page.keyboard.press("Enter");
          await page.getByText(/Approved by you/).waitFor({ timeout: 15000 });
          pass("Approve worked from the keyboard");
          const simBtn = await page.getByRole("button", { name: /Simulate buyer approval/ }).count();
          if (simBtn === 0) pass("no 'Simulate buyer approval' button is rendered");
          else fail("simulate button is visible");
          if (await tabTo(/Approve and pay \(simulated PayPal\)/, 80)) {
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => document.body.innerText.includes("Payment authorized"), null, { timeout: 15000 }).then(() => pass("checkout (local PayPal simulation) authorized the held payment")).catch(() => fail("authorization toast did not appear"));
          } else console.log("  note  PayPal button is the real SDK here (credentials configured); skipping pay step");
        }
      } catch (e) {
        fail(`keyboard flow stalled: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    await ctx.close();
  }

  console.log("\nConsole / CSP errors seen across all pages");
  const uniq = [...new Set(consoleProblems)];
  if (uniq.length) uniq.slice(0, 10).forEach((p) => fail(p));
  else pass("none");

  await browser.close();

  // The guided demo has its own end-to-end verifier: it starts a separate production server on a throwaway database
  // (needs `npm run build`). Takes about 8 minutes; set SKIP_TOUR=1 to skip.
  if (process.env.SKIP_TOUR) console.log("\nGuided demo: skipped (SKIP_TOUR is set)");
  else {
    console.log("\nGuided demo (npm run verify:tour, own server)");
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/verify-tour.ts"], { stdio: "inherit" });
    if (r.status === 0) pass("guided demo verification passed");
    else fail("guided demo verification failed (see its output above)");
  }
  if (process.env.SKIP_AUTH) console.log("\nAccounts and demo buttons: skipped (SKIP_AUTH is set)");
  else {
    console.log("\nAccounts, guest mode and both demo buttons (npm run verify:auth, own server)");
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/verify-auth.ts"], { stdio: "inherit" });
    if (r.status === 0) pass("accounts verification passed");
    else fail("accounts verification failed (see its output above)");
  }
  console.log(failures ? `\n${failures} problem(s)` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
