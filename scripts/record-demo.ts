/**
 * Records demo-mode video clips (scripted AI, local PayPal simulation) into docs/clips/ as .webm.
 *   npm run record:server        (terminal 1: fresh seeded DB, PayPal simulated)
 *   npm run record:demo          (terminal 2: all clips)
 *   npm run record:demo -- --only 01
 * Env: BASE_URL (default http://localhost:3300), SLOWMO (ms, default 250), HEADED=1, EDGE_PATH / CHROME_PATH.
 * Captions come from docs/demo-captions.json and are injected by this script only; the app never contains them.
 * The real PayPal popup is deliberately NOT recorded here: record that by hand.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3300";
const SLOWMO = Number(process.env.SLOWMO ?? 250);
const OUT = path.join(process.cwd(), "docs", "clips");
const CAPTIONS: Record<string, Record<string, string>> = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "demo-captions.json"), "utf8"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

const candidates = [
  process.env.EDGE_PATH, process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

/** Overlay injected into every page of the recording context. Text persists across navigations via sessionStorage. */
const overlayScript = `(() => {
  const KEY = "__rec_caption";
  const render = () => {
    let t = ""; try { t = sessionStorage.getItem(KEY) || ""; } catch {}
    let el = document.getElementById("__rec_caption");
    if (!t) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "__rec_caption"; el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:14px 32px;background:#000;color:#fff;font:600 24px/1.3 system-ui,Segoe UI,sans-serif;text-align:center;pointer-events:none;box-shadow:0 -2px 12px rgba(0,0,0,.4)";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = t;
  };
  const of = window.fetch;
  window.fetch = async (...a) => {
    const r = await of(...a);
    try { if (String(a[0] && a[0].url || a[0]).includes("/api/agent/run")) r.clone().text().then((t) => { const m = /"jobId":"([^"]+)"/.exec(t); if (m) window.__jobId = m[1]; }).catch(() => {}); } catch {}
    return r;
  };
  window.__setCaption = (t) => { try { sessionStorage.setItem(KEY, t || ""); } catch {} render(); };
  document.addEventListener("DOMContentLoaded", render);
  new MutationObserver(() => { if (!document.getElementById("__rec_caption")) render(); }).observe(document, { childList: true, subtree: true });
})();`;

interface Ctx {
  page: Page;
  cap: (key: string) => Promise<void>;
  hold: (ms?: number) => Promise<void>;
  step: <T>(what: string, fn: () => Promise<T>) => Promise<T>;
}
interface Clip {
  id: string;
  name: string;
  run: (c: Ctx) => Promise<void>;
}

const clips: Clip[] = [
  {
    id: "01",
    name: "agent-cracked-screen",
    async run({ page, cap, hold, step }) {
      await step("log in as the demo owner", async () => { const r = await page.request.post(BASE + "/api/auth/login", { data: { email: "owner@reloop.demo", password: process.env.DEMO_ACCOUNT_PASSWORD || "reloop-demo-2026" }, headers: { origin: new URL(BASE).origin } }); if (!r.ok()) throw new Error("demo login failed"); });
      await step("open /agent", () => page.goto(BASE + "/agent", { waitUntil: "networkidle" }));
      await cap("goal");
      await step("type goal", async () => {
        await page.locator("#goal").fill("My Samsung Galaxy A52 screen is cracked, fix it under $60 this weekend.");
        await page.locator("#budget").fill("60");
      });
      await hold(1500);
      await step("start agent", () => page.getByRole("button", { name: /Start the agent/ }).click());
      await cap("trace");
      await step("wait for the quote", () => page.getByRole("button", { name: /Approve and continue to PayPal/ }).waitFor({ timeout: 45000 }));
      await cap("blocked");
      await step("show the over-budget step", async () => {
        await page.getByText(/over budget/i).first().scrollIntoViewIfNeeded().catch(() => {});
      });
      await hold(3500);
      await cap("quote");
      await step("scroll to the quote", () => page.getByRole("heading", { name: /Your quote/ }).scrollIntoViewIfNeeded());
      await hold(4500); // stops BEFORE Approve: the real PayPal part is recorded by hand
    },
  },
  {
    id: "02",
    name: "safety-swollen-battery",
    async run({ page, cap, hold, step }) {
      await cap("intro");
      await step("open the swollen-battery scenario", () => page.goto(BASE + "/owner/new?scenario=swollen-battery", { waitUntil: "networkidle" }));
      await hold(2000);
      await step("diagnose", () => page.getByRole("button", { name: /^Diagnose$/ }).click());
      await step("wait for the safety stop", () => page.getByText("DIY is not offered for this device.").waitFor({ timeout: 30000 }));
      await cap("diagnosis");
      await hold(4500);
      await cap("book");
      await step("get a quote and book", async () => {
        const b = page.getByRole("button", { name: /Get a quote and book/ });
        await b.scrollIntoViewIfNeeded();
        await hold(1500);
        await b.click();
      });
      await step("wait for the job quote", () => page.waitForURL(/\/jobs\//, { timeout: 30000 }));
      await cap("quote");
      await hold(4500);
    },
  },
  {
    id: "03",
    name: "technician-completes",
    async run({ page, cap, hold, step }) {
      await step("log in as the demo owner", async () => { const r = await page.request.post(BASE + "/api/auth/login", { data: { email: "owner@reloop.demo", password: process.env.DEMO_ACCOUNT_PASSWORD || "reloop-demo-2026" }, headers: { origin: new URL(BASE).origin } }); if (!r.ok()) throw new Error("demo login failed"); });
      await step("open /agent", () => page.goto(BASE + "/agent", { waitUntil: "networkidle" }));
      await step("run the cracked-screen example", () => page.getByRole("button", { name: /Cracked phone screen/ }).click());
      await step("wait for the quote", () => page.getByRole("button", { name: /Approve and continue to PayPal/ }).waitFor({ timeout: 45000 }));
      const techName = ((await page.locator("p:has(a:text('See verified profile')) strong").first().textContent()) ?? "").trim();
      if (!techName) throw new Error("could not read the matched technician's name from the quote card");
      await cap("pay");
      await step("approve the quote", () => page.getByRole("button", { name: /Approve and continue to PayPal/ }).click());
      await step("pay with the simulated PayPal button", async () => {
        const b = page.getByRole("button", { name: /Approve and pay \(simulated PayPal\)/ });
        await b.waitFor({ timeout: 15000 }).catch(() => {
          throw new Error("No simulated PayPal button. Is the server running with PayPal credentials? Use npm run record:server.");
        });
        await hold(2500);
        await b.click();
      });
      await step("wait for the authorization", () => page.waitForFunction(() => document.body.innerText.includes("Payment authorized"), null, { timeout: 20000 }));
      await hold(2000);

      // Accounts replaced the role switcher: switching sides is logging in as the other documented demo account.
      const switchRole = async (role: "owner" | "technician") => {
        const email = role === "owner" ? "owner@reloop.demo" : "tech@reloop.demo";
        const res = await page.request.post(BASE + "/api/auth/login", { data: { email, password: process.env.DEMO_ACCOUNT_PASSWORD || "reloop-demo-2026" }, headers: { origin: new URL(BASE).origin } });
        if (!res.ok()) throw new Error(`demo login as ${role} failed (${res.status()}). Is the database seeded (npm run db:reset)?`);
        await page.waitForLoadState("networkidle");
      };
      // The injected fetch tap (see overlayScript) saw the new job's id in the agent stream; the steps below act on exactly that job.
      const jobId = (await page.evaluate(() => (window as unknown as { __jobId?: string }).__jobId)) ?? "";
      await cap("technician");
      await step(`switch to technician ${techName}`, () => switchRole("technician"));
      await step("open the technician board", () => page.goto(BASE + "/technician", { waitUntil: "networkidle" }));
      if (!jobId) throw new Error("could not read the new job id from the agent stream");
      const jobHref = `/jobs/${jobId}`;
      /** The smallest block around this job's hidden jobId field that contains the given control (the paid-job card has no link yet). */
      const inJob = (control: string) => page.locator(`input[name="jobId"][value="${jobId}"]`).first().locator(`xpath=ancestor::*[.//${control}][1]`);
      await step("accept the job", async () => {
        const accept = inJob('button[normalize-space()="Accept"]').getByRole("button", { name: /^Accept$/ });
        await accept.scrollIntoViewIfNeeded();
        await hold(1500);
        await accept.click();
        await inJob('button[normalize-space()="Mark in progress"]').getByRole("button", { name: /Mark in progress/ }).waitFor({ timeout: 15000 });
      });
      await cap("progress");
      await step("start the repair", async () => {
        await hold(1200);
        await inJob('button[normalize-space()="Mark in progress"]').getByRole("button", { name: /Mark in progress/ }).click();
        await inJob('input[@name="photo"]').locator('input[name="photo"]').waitFor({ timeout: 15000 });
      });
      await cap("complete");
      await step("complete with a proof photo", async () => {
        const card = inJob('input[@name="photo"]');
        await card.locator('input[name="photo"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG });
        await card.locator('textarea[name="notes"]').fill("Replaced the cracked display and tested touch, brightness and the camera.");
        await hold(1500);
        await card.getByRole("button", { name: /^Mark complete$/ }).click();
        await page.getByText(/Marked complete/).first().waitFor({ timeout: 15000 });
      });
      await step("switch back to owner", () => switchRole("owner"));
      await step("open the job", () => page.goto(BASE + jobHref, { waitUntil: "networkidle" }));
      await cap("confirm");
      await step("confirm the repair is done", async () => {
        const b = page.getByRole("button", { name: /Confirm repair is done/ });
        await b.scrollIntoViewIfNeeded();
        await hold(2000);
        await b.click();
        await page.getByText(/payout/i).first().waitFor({ timeout: 30000 });
      });
      await cap("timeline");
      await step("show the timeline", async () => {
        await page.getByRole("heading", { name: /timeline/i }).first().scrollIntoViewIfNeeded().catch(() => {});
      });
      await hold(5000);
    },
  },
  {
    id: "04",
    name: "cv-certificate-impact",
    async run({ page, cap, hold, step }) {
      await step("open the home page", () => page.goto(BASE + "/", { waitUntil: "networkidle" }));
      const techId = await step("find Aisha Rahman", async () => {
        const v = await page.locator("#techId option", { hasText: "Aisha Rahman" }).first().getAttribute("value");
        if (!v) throw new Error("Aisha Rahman is not in the technician list (is the database seeded?)");
        return v;
      });
      await step("open the public profile", () => page.goto(`${BASE}/tech/${techId}`, { waitUntil: "networkidle" }));
      await cap("profile");
      await hold(4500);
      await cap("cv");
      await step("download the CV", async () => {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("link", { name: /Download Verified Repair CV/ }).click()]);
        await dl.cancel().catch(() => {});
      });
      await hold(2500);
      await step("open /donate", () => page.goto(BASE + "/donate", { waitUntil: "networkidle" }));
      await cap("donate");
      await step("donate $5 (simulated)", async () => {
        await page.locator("label", { hasText: /^Custom$/ }).click();
        await page.locator("#custom").fill("5.00");
        await hold(2000);
        await page.getByRole("button", { name: /Donate \(simulated PayPal\)/ }).click();
        await page.waitForURL(/\/donate\/thanks\//, { timeout: 30000 });
      });
      await cap("certificate");
      await hold(3500);
      await step("download the certificate", async () => {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("link", { name: /Download certificate/ }).click()]);
        await dl.cancel().catch(() => {});
      });
      await hold(1500);
      await step("open /impact", () => page.goto(BASE + "/impact", { waitUntil: "networkidle" }));
      await cap("impact");
      await hold(3000);
      await page.mouse.wheel(0, 500);
      await hold(4500);
    },
  },
];

async function recordClip(browser: Browser, clip: Clip): Promise<string> {
  const tmp = path.join(os.tmpdir(), `reloop-rec-${clip.id}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: tmp, size: { width: 1280, height: 720 } },
    acceptDownloads: true,
  });
  await context.addInitScript(overlayScript);
  const page = await context.newPage();
  const label = `${clip.id}-${clip.name}`;
  const captions = CAPTIONS[label] ?? {};
  const ctx: Ctx = {
    page,
    hold: (ms = 1500) => page.waitForTimeout(ms),
    cap: async (key) => {
      const t = captions[key] ?? "";
      await page.evaluate((x) => (window as unknown as { __setCaption?: (s: string) => void }).__setCaption?.(x), t).catch(() => {});
      await page.waitForTimeout(t ? 600 : 0);
    },
    step: async (what, fn) => {
      try {
        return await fn();
      } catch (e) {
        throw new Error(`clip ${label}, step "${what}": ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    },
  };
  let error: unknown;
  try {
    await clip.run(ctx);
  } catch (e) {
    error = e;
  }
  const video = page.video();
  if (error) await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  await page.waitForTimeout(800);
  await context.close();
  const dest = path.join(OUT, `${label}.webm`);
  if (error) {
    await video?.delete().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  if (existsSync(dest)) rmSync(dest);
  renameSync(await video!.path(), dest);
  rmSync(tmp, { recursive: true, force: true });
  return dest;
}

async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const selected = clips.filter((c) => !only || c.id === only.padStart(2, "0") || c.name === only);
  if (!selected.length) {
    console.error(`No clip matches "--only ${only}". Use 01, 02, 03 or 04.`);
    process.exit(2);
  }

  try {
    const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`health check returned HTTP ${r.status}`);
  } catch (e) {
    console.error(`\nThe app is not running at ${BASE} (${e instanceof Error ? e.message : e}).\nStart it in another terminal:  npm run record:server   (or set BASE_URL to a running demo-mode instance)\n`);
    process.exit(2);
  }
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) {
    console.error("No Edge/Chrome found. Set EDGE_PATH or CHROME_PATH.");
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, ".gitkeep"), "");

  const browser = await chromium.launch({ executablePath: exe, headless: process.env.HEADED !== "1", slowMo: SLOWMO });
  // Warm-up pass (not recorded): first visits to dev-server routes compile slowly and would stall the video.
  const warm = await browser.newPage();
  for (const p of ["/", "/agent", "/owner", "/owner/new?scenario=swollen-battery", "/technician", "/donate", "/impact"]) {
    await warm.goto(BASE + p, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  }
  await warm.close();

  let failed = 0;
  for (const clip of selected) {
    process.stdout.write(`Recording ${clip.id}-${clip.name} ... `);
    try {
      console.log(`done -> ${path.relative(process.cwd(), await recordClip(browser, clip))}`);
    } catch (e) {
      failed += 1;
      console.log(`FAILED\n  ${e instanceof Error ? e.message : e}`);
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} clip(s) failed` : "\nAll clips recorded");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
