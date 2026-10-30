/**
 * End-to-end check of accounts, guest mode and the two demo buttons in a real browser against a PRODUCTION build.
 * Run: npm run verify:auth (needs `npm run build` first). It starts its own server on a throwaway database with dummy
 * PayPal credentials (so the app is in "sandbox" mode and WOULD call PayPal if a tour ever did) and checks:
 *   - owner signup, logout, login, logout; technician signup with skills and payout email
 *   - guest flow end to end through the agent to the quote
 *   - signup-page demo: finishes, lands on /signup, creates no user, leaves no tour rows
 *   - home-page demo while logged in: same session cookie value afterwards, same user, URL "/", own data untouched
 *   - home-page demo logged out and as a guest (stopped mid-tour): state unchanged afterwards
 *   - Stop and reload mid-tour from both entry points: right redirect and cleanup
 *   - zero requests to PayPal hosts or /api/paypal/*, no console errors, axe-clean signup, login and caption bar
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.AUTH_PORT ?? "3420";
const BASE = `http://localhost:${PORT}`;
const root = process.cwd();
const bin = (p: string) => path.join(root, "node_modules", p);
const axeSource = readFileSync(bin("axe-core/axe.min.js"), "utf8");
const SESSION = "reloop_session";
const candidates = [
  process.env.EDGE_PATH, process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean) as string[];

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("No production build found. Run: npm run build");
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) throw new Error("No Edge/Chrome found. Set EDGE_PATH.");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reloop-auth-"));
  const dbUrl = `file:${path.join(tmp, "auth.db").replaceAll("\\", "/")}`;
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
      await sleep(500);
    }
    browser = await chromium.launch({ executablePath: exe, headless: true });

    const seen = { requests: [] as string[], consoleErrors: [] as string[] };
    const newContext = async (width = 1280, height = 800) => {
      const ctx = await browser!.newContext({ viewport: { width, height } });
      ctx.on("request", (r) => seen.requests.push(r.url()));
      ctx.on("page", (p) => {
        p.on("console", (m) => { if (m.type() === "error") seen.consoleErrors.push(m.text().slice(0, 200)); });
        p.on("pageerror", (e) => seen.consoleErrors.push(`pageerror ${e.message.slice(0, 200)}`));
      });
      return ctx;
    };
    const cookie = async (ctx: BrowserContext) => (await ctx.cookies(BASE)).find((c) => c.name === SESSION)?.value ?? null;
    const tourRows = async () => ({
      jobs: await prisma.job.count({ where: { isTour: true } }), devices: await prisma.device.count({ where: { isTour: true } }),
      runs: await prisma.agentRun.count({ where: { isTour: true } }), sessions: await prisma.tourRun.count(),
      files: existsSync(uploads) ? readdirSync(uploads).length : 0,
    });
    const waitClean = async (ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (Object.values(await tourRows()).every((n) => n === 0)) return true; await sleep(250); } return false; };
    const bar = (p: Page) => p.locator('[data-tour="tour-bar"]');
    const account = (p: Page) => p.locator('[data-tour="account-area"]');
    const axe = async (p: Page, label: string, selector?: string) => {
      await p.evaluate(axeSource);
      const v = await p.evaluate(async (sel) => {
        // @ts-expect-error axe is injected above
        const r = await axe.run(sel ?? document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
        return r.violations.filter((x: { impact: string }) => x.impact === "serious" || x.impact === "critical").map((x: { id: string }) => x.id);
      }, selector ?? null);
      check(v.length === 0, `axe: ${label} has no serious/critical violations${v.length ? `: ${v.join(", ")}` : ""}`);
    };
    const signupOwner = async (p: Page, name: string, email: string, password: string) => {
      await p.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
      await p.getByLabel("Name", { exact: true }).fill(name);
      await p.getByLabel("Email", { exact: true }).fill(email);
      await p.getByLabel("Password", { exact: true }).fill(password);
      await p.getByRole("button", { name: "Create account" }).click();
      await p.waitForURL(`${BASE}/owner`, { timeout: 20000 });
    };
    const logout = async (p: Page) => { await p.getByRole("button", { name: "Log out" }).click(); await p.waitForURL(`${BASE}/`, { timeout: 15000 }); };
    /** Starts the tour from the page the caller is on, runs it at 2x. */
    const startTour = async (p: Page, speed = "2") => {
      await p.locator('[data-tour="start-tour"]').first().click();
      await bar(p).waitFor({ timeout: 20000 });
      if (speed !== "1") await bar(p).locator("select").selectOption(speed);
    };
    const finishTour = async (p: Page, axeLabel?: string) => {
      const finish = p.getByRole("button", { name: /^Finish$/ });
      const deadline = Date.now() + 6 * 60_000;
      let axed = !axeLabel;
      while (Date.now() < deadline) {
        if (await finish.isVisible().catch(() => false)) break;
        const text = await bar(p).innerText().catch(() => "");
        if (!axed && /Chapter [3-9]/.test(text)) { await axe(p, `caption bar (${axeLabel})`, '[data-tour="tour-bar"]'); axed = true; }
        if (/Tour ended early/.test(text)) throw new Error(`the tour ended early: ${text.replace(/\s+/g, " ")}`);
        await sleep(500);
      }
      if (!(await finish.isVisible())) throw new Error("tour never reached its last chapter");
      await finish.click();
    };
    const stopAt = async (p: Page, chapter: number) => {
      await bar(p).getByText(new RegExp(`Chapter ${chapter} of`)).waitFor({ timeout: 4 * 60_000 });
      await bar(p).getByRole("button", { name: /^Stop/ }).click();
    };

    // ---- 1. Accounts -----------------------------------------------------------------------------------------
    console.log("\nOwner and technician accounts");
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
        check((await page.getByText("Use a throwaway password").count()) > 0, "signup warns to use a throwaway password");
        await axe(page, "signup page");
        await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
        await axe(page, "login page");
        for (const w of [360, 412, 768, 1280]) {
          await page.setViewportSize({ width: w, height: 900 });
          for (const r of ["/signup", "/login"]) {
            await page.goto(BASE + r, { waitUntil: "networkidle" });
            const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            check(over <= 1, `${r} @${w}px has no horizontal overflow`);
          }
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await signupOwner(page, "Olive Owner", "olive@example.com", "a throwaway password");
        check(/Olive Owner/.test(await account(page).innerText()), "signed up as owner and the header shows the name and role");
        const first = await cookie(ctx);
        await logout(page);
        check((await cookie(ctx)) === null && /Log in/.test(await account(page).innerText()), "logout removed the session cookie and the header shows Log in / Sign up");
        // A wrong password is generic, and does not log in (checked over the API so the browser console stays clean).
        const bad = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: "olive@example.com", password: "not the password" }, headers: { origin: BASE } });
        check(bad.status() === 401 && (await bad.json()).error === "Email or password is incorrect.", "wrong password gets the generic error");
        await page.goto(`${BASE}/login?next=/agent`, { waitUntil: "networkidle" });
        await page.getByLabel("Email", { exact: true }).fill("olive@example.com");
        await page.getByLabel("Password", { exact: true }).fill("a throwaway password");
        await page.getByRole("button", { name: "Log in" }).click();
        await page.waitForURL(`${BASE}/agent`, { timeout: 20000 });
        const second = await cookie(ctx);
        check(!!second && second !== first, "login issued a new session token (rotation)");
        await logout(page);
        await page.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
        check(page.url().startsWith(`${BASE}/login?next=%2Fowner`), "a protected page redirects to login and keeps ?next=");
        // Technician with skills and payout email.
        await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
        await page.getByRole("radio", { name: /Technician/ }).check();
        await page.getByLabel("Name", { exact: true }).fill("Tess Technician");
        await page.getByLabel("Email", { exact: true }).fill("tess@example.com");
        await page.getByLabel("Password", { exact: true }).fill("another throwaway one");
        await page.getByRole("button", { name: "Create account" }).click();
        await page.getByText("Choose at least one device type.").waitFor({ timeout: 5000 });
        pass("technician signup shows friendly inline errors (skills, area, payout email missing)");
        await page.getByLabel("phone").check();
        await page.getByLabel("tablet").check();
        await page.getByLabel("Your city or area").fill("Westside");
        await page.getByLabel("PayPal sandbox email for payouts").fill("tess-sandbox@example.com");
        await page.getByRole("button", { name: "Create account" }).click();
        await page.waitForURL(`${BASE}/technician`, { timeout: 20000 });
        const t = await prisma.technician.findFirst({ where: { user: { email: "tess@example.com" } } });
        check(!!t && t.skills === "phone,tablet" && t.city === "Westside" && t.paypalEmail === "tess-sandbox@example.com", "technician profile saved with skills, area and payout email");
        await logout(page);
      } catch (e) {
        fail(`accounts flow: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        await page.screenshot({ path: path.join(tmp, "fail-accounts.png") }).catch(() => {});
      }
      await ctx.close();
    }

    // ---- 2. Guest end to end ---------------------------------------------------------------------------------
    console.log("\nGuest flow through the agent to the quote");
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/login?next=/agent`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Continue as guest (demo)" }).click();
        await page.waitForURL(`${BASE}/agent`, { timeout: 20000 });
        check(/Guest/.test(await account(page).innerText()) && /Create an account to keep your data/.test(await account(page).innerText()), "header shows Guest and the create-an-account prompt");
        await page.locator('[data-tour="example-cracked-screen"]').click();
        await page.getByRole("button", { name: /Approve and continue to PayPal/ }).waitFor({ timeout: 40000 });
        pass("a guest ran the agent to an approvable quote");
        const guest = await prisma.user.findFirstOrThrow({ where: { isGuest: true }, include: { owner: { include: { devices: true } } } });
        check(guest.owner!.devices.length === 1 && /^Guest \d{4}$/.test(guest.name), "the guest owns the device the agent created");
        await logout(page);
      } catch (e) {
        fail(`guest flow: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        await page.screenshot({ path: path.join(tmp, "fail-guest.png") }).catch(() => {});
      }
      await ctx.close();
    }

    // ---- 3. Signup demo: finish -> /signup, no users created -------------------------------------------------
    console.log("\nDemo button on the signup page");
    {
      const usersBefore = await prisma.user.count();
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
        await startTour(page);
        await bar(page).getByText(/Chapter 1 of 9: Accounts/).waitFor({ timeout: 20000 });
        pass("the tour opens with the Accounts chapter about the signup form");
        const fieldsAtStart = await page.locator('form[data-tour="signup-form"] input[type="text"], form[data-tour="signup-form"] input[type="email"], form[data-tour="signup-form"] input[type="password"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        await finishTour(page, "signup entry");
        await page.waitForURL(`${BASE}/signup`, { timeout: 20000 });
        await bar(page).waitFor({ state: "detached", timeout: 15000 });
        check(page.url() === `${BASE}/signup`, "when the tour finished the visitor was sent back to /signup");
        check(fieldsAtStart.every((v) => v === ""), "the tour never typed into the signup form");
        check((await prisma.user.count()) === usersBefore, "no user was created by the tour");
        check(await waitClean(), `no tour rows or files remain (${JSON.stringify(await tourRows())})`);
        check((await cookie(ctx)) === null, "no session cookie was created");
      } catch (e) {
        fail(`signup demo: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        await page.screenshot({ path: path.join(tmp, "fail-signup-demo.png") }).catch(() => {});
      }
      await ctx.close();
    }

    // ---- 4. Home demo while logged in ------------------------------------------------------------------------
    console.log("\nDemo button on the home page, logged in");
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await signupOwner(page, "Harriet Home", "harriet@example.com", "a throwaway password");
        const me = await prisma.user.findUniqueOrThrow({ where: { email: "harriet@example.com" }, include: { owner: true } });
        const dev = await prisma.device.create({ data: { ownerId: me.owner!.id, type: "phone", brand: "Harriet-Phone", model: "H1", ageYears: 1, problem: "my own cracked screen" } });
        const before = await cookie(ctx);
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await startTour(page);
        await bar(page).getByText(/Chapter 3 of/).waitFor({ timeout: 4 * 60_000 });
        check(/Guided demo/.test(await account(page).innerText()) && !/Harriet/.test(await account(page).innerText()), "during the tour the header does not show the visitor's account");
        await bar(page).getByText(/Viewing as: (Owner|Technician) \(tour/).waitFor({ timeout: 4 * 60_000 }).catch(() => {});
        await finishTour(page, "home entry, logged in");
        await page.waitForURL(`${BASE}/`, { timeout: 20000 });
        await bar(page).waitFor({ state: "detached", timeout: 15000 });
        check((await cookie(ctx)) === before, "the session cookie value is identical after the tour");
        check(/Harriet Home/.test(await account(page).innerText()), "still logged in as the same user");
        check(page.url() === `${BASE}/`, "the visitor is back on the home page");
        await page.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
        check((await page.getByText("Harriet-Phone").count()) > 0 && (await page.locator("#main").getByText("Tour simulation").count()) === 0 && (await page.locator("#main").getByText("Tour visitor").count()) === 0, "their own dashboard shows their device and nothing from the tour");
        const after = await prisma.device.findUniqueOrThrow({ where: { id: dev.id } });
        check(after.brand === "Harriet-Phone" && after.problem === "my own cracked screen" && !after.isTour && (await prisma.device.count({ where: { ownerId: me.owner!.id } })) === 1, "their data is unchanged and nothing was added to it");
        check(await waitClean(), `no tour rows or files remain (${JSON.stringify(await tourRows())})`);
        await logout(page);
      } catch (e) {
        fail(`home demo (logged in): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        await page.screenshot({ path: path.join(tmp, "fail-home-login.png") }).catch(() => {});
      }
      await ctx.close();
    }

    // ---- 5. Home demo logged out and as guest (stopped mid-tour) ---------------------------------------------
    console.log("\nDemo button on the home page, logged out and as a guest (Stop mid-tour)");
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await startTour(page);
        await stopAt(page, 4);
        await page.waitForURL(`${BASE}/`, { timeout: 20000 });
        await bar(page).waitFor({ state: "detached", timeout: 15000 });
        check((await cookie(ctx)) === null && /Log in/.test(await account(page).innerText()), "logged out stays logged out, on /");
        check(await waitClean(), "Stop cleaned up the tour data");
      } catch (e) {
        fail(`home demo (logged out): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
      try {
        await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Continue as guest (demo)" }).click();
        await page.waitForURL(`${BASE}/owner`, { timeout: 20000 });
        const before = await cookie(ctx);
        const guestName = (await account(page).innerText()).trim();
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await startTour(page);
        await stopAt(page, 4);
        await page.waitForURL(`${BASE}/`, { timeout: 20000 });
        await bar(page).waitFor({ state: "detached", timeout: 15000 });
        check((await cookie(ctx)) === before && (await account(page).innerText()).trim() === guestName, "a guest stays the same guest (same cookie, same header), on /");
        check(await waitClean(), "Stop cleaned up the tour data");
      } catch (e) {
        fail(`home demo (guest): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
      await ctx.close();
    }

    // ---- 6. Reload mid-tour from both entry points -----------------------------------------------------------
    console.log("\nReload mid-tour");
    for (const entry of ["/signup", "/"] as const) {
      const ctx = await newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + entry, { waitUntil: "networkidle" });
        await startTour(page);
        await bar(page).getByText(/Chapter 3 of/).waitFor({ timeout: 4 * 60_000 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await bar(page).waitFor({ timeout: 15000 });
        pass(`entry ${entry}: after a reload the tour resumed`);
        await bar(page).getByRole("button", { name: /^Stop/ }).click();
        await page.waitForURL(BASE + entry, { timeout: 20000 });
        check(await waitClean(), `entry ${entry}: Stop after the reload went back to ${entry} and cleaned up`);
        // Closed mid-tour: the next page load of the same browser cleans up.
        await startTour(page);
        await bar(page).getByText(/Chapter 3 of/).waitFor({ timeout: 4 * 60_000 });
        await page.close();
        const again = await ctx.newPage();
        await again.goto(BASE + "/", { waitUntil: "networkidle" });
        check(await waitClean(), `entry ${entry}: an abandoned tour was cleaned on the next page load`);
      } catch (e) {
        fail(`reload from ${entry}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
      await ctx.close();
    }

    // ---- 7. Whole-run checks ---------------------------------------------------------------------------------
    console.log("\nAcross every run above");
    const pp = seen.requests.filter((u) => /(^|\.)paypal(objects)?\.com/i.test(new URL(u).hostname) || new URL(u).pathname.startsWith("/api/paypal"));
    check(pp.length === 0, `zero requests to PayPal hosts or /api/paypal/* (${seen.requests.length} requests seen${pp.length ? `; first: ${pp[0]}` : ""})`);
    check(seen.consoleErrors.length === 0, `no console errors${seen.consoleErrors.length ? `: ${seen.consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
  } finally {
    await browser?.close();
    await prisma.$disconnect();
    server.kill();
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    if (failures) console.log(`\nserver log tail:\n${serverLog.join("").split("\n").slice(-15).join("\n")}\nscreenshots (if any) are in ${tmp}`);
    await sleep(500);
    if (!failures) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  console.log(failures ? `\n${failures} problem(s)` : "\nAll auth checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
