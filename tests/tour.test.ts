import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny cookie jar standing in for next/headers during these tests.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => (v === "" ? jar.delete(n) : jar.set(n, v)),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { acceptJob, confirmRepair, completeJob, startJob } from "@/lib/jobs/lifecycle";
import { verifiedRepairsFor } from "@/lib/profile/queries";
import { blockPaypalDuringTour } from "@/lib/tour/paypal-guard";
import { TOUR_COOKIE } from "@/lib/tour/constants";
import { cleanupTourRun, currentTourRun, purgeStaleTours, tourScope } from "@/lib/tour/server";
import { POST as startRoute } from "@/app/api/tour/start/route";
import { POST as cleanupRoute } from "@/app/api/tour/cleanup/route";
import { POST as payRoute } from "@/app/api/tour/pay/route";
import { POST as ordersRoute } from "@/app/api/paypal/orders/route";
import { processWebhookEvent } from "@/lib/paypal/webhook-handler";

const post = (path: string, body: unknown = {}, ip = "9.9.9.9") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

const quote = JSON.stringify({ lines: [{ label: "Part", cents: 3000 }], totalCents: 3000, partsCents: 3000, laborCents: 0, logisticsCents: 0, platformFeeCents: 300, technicianPayoutCents: 2700, technicianId: "t1", technicianName: "Tech", matchReasons: [] });

async function seedBase() {
  await db.$transaction([
    db.webhookEvent.deleteMany(), db.agentApproval.deleteMany(), db.agentRun.deleteMany(), db.impactEvent.deleteMany(), db.verifiedRepair.deleteMany(), db.donation.deleteMany(),
    db.jobEvent.deleteMany(), db.job.deleteMany(), db.device.deleteMany(), db.tourRun.deleteMany(), db.technician.deleteMany(), db.owner.deleteMany(),
  ]);
  await db.owner.create({ data: { id: "o1", name: "O", email: "o@x.test" } });
  await db.technician.create({ data: { id: "t1", name: "Tech", city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: "t@x.test" } });
}

/** A device + job created the way a tour run creates them. */
async function tourJob(runId: string | null, status = "quoted", extra: Record<string, unknown> = {}) {
  const tag = runId ? { isTour: true, tourRunId: runId } : {};
  const device = await db.device.create({ data: { ownerId: "o1", type: "phone", brand: "A", model: "B", ageYears: 1, problem: "cracked screen here", ...tag } });
  const agentRun = await db.agentRun.create({ data: { goal: "g", mode: "scripted", ...tag } });
  return db.job.create({
    data: { deviceId: device.id, technicianId: "t1", status, diagnosisJson: JSON.stringify({ estimated_parts: [{ name: "Screen" }] }), quoteJson: quote, totalCents: 3000, platformFeeCents: 300, payoutCents: 2700, agentRunId: agentRun.id, ...tag, ...extra },
  });
}
const approve = (job: { id: string; agentRunId: string | null }) =>
  db.agentApproval.create({ data: { runId: job.agentRunId!, jobId: job.id, totalCents: 3000, itemsHash: "h", expiresAt: new Date(Date.now() + 600_000), userApprovedAt: new Date() } });

async function startTour() {
  const res = await startRoute(post("/api/tour/start"));
  expect(res.status).toBe(200);
  return ((await res.json()) as { runId: string }).runId;
}

beforeEach(async () => {
  jar.clear();
  resetRateLimits();
  process.env.DEMO_ACTIONS = "true";
  await seedBase();
});

describe("tour session", () => {
  it("starts only when DEMO_ACTIONS is true, binds a cookie, and replaces an earlier run", async () => {
    process.env.DEMO_ACTIONS = "false";
    expect((await startRoute(post("/api/tour/start"))).status).toBe(403);
    process.env.DEMO_ACTIONS = "true";
    const a = await startTour();
    expect(jar.get(TOUR_COOKIE)).toBe(a);
    const job = await tourJob(a);
    const b = await startTour(); // starting again cleans the previous run
    expect(b).not.toBe(a);
    expect(await db.job.count({ where: { id: job.id } })).toBe(0);
    expect(await db.tourRun.count()).toBe(1);
  });
  it("is rate limited", async () => {
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await startRoute(post("/api/tour/start", {}, "7.7.7.7"))).status;
    expect(last).toBe(429);
  });
});

describe("/api/tour/pay authorization", () => {
  it("works for the session's own approved tour job and records TOUR-SIMULATED ids without calling PayPal", async () => {
    const run = await startTour();
    const job = await tourJob(run);
    await approve(job);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await payRoute(post("/api/tour/pay", { jobId: job.id }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const after = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("paid");
    expect(after.paypalAuthId).toMatch(/^SIM-TOUR-AUTH-/);
    expect(after.authSimulated).toBe(true);
  });
  it("refuses a cookie from another run", async () => {
    const run = await startTour();
    const job = await tourJob(run);
    await approve(job);
    const other = await db.tourRun.create({ data: {} });
    jar.set(TOUR_COOKIE, other.id);
    expect((await payRoute(post("/api/tour/pay", { jobId: job.id }))).status).toBe(403);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("quoted");
  });
  it("refuses a missing cookie, a non-tour job, an unapproved quote, and DEMO_ACTIONS off", async () => {
    const run = await startTour();
    const real = await tourJob(null);
    await approve(real);
    expect((await payRoute(post("/api/tour/pay", { jobId: real.id }))).status).toBe(403); // not a tour job
    const job = await tourJob(run);
    expect((await payRoute(post("/api/tour/pay", { jobId: job.id }))).status).toBe(409); // not approved by the user
    await approve(job);
    process.env.DEMO_ACTIONS = "false";
    expect((await payRoute(post("/api/tour/pay", { jobId: job.id }))).status).toBe(403);
    process.env.DEMO_ACTIONS = "true";
    jar.delete(TOUR_COOKIE);
    expect((await payRoute(post("/api/tour/pay", { jobId: job.id }))).status).toBe(403); // no session
    expect((await db.job.findUniqueOrThrow({ where: { id: real.id } })).status).toBe("quoted");
  });
  it("is rate limited", async () => {
    await startTour();
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await payRoute(post("/api/tour/pay", { jobId: "nope" }, "5.5.5.5"))).status;
    expect(last).toBe(429);
  });
});

describe("tour jobs never reach PayPal", () => {
  it("the guard blocks and logs during a tour session or for a tour job, and is silent otherwise", async () => {
    expect(await blockPaypalDuringTour("/x")).toBeNull();
    expect(await blockPaypalDuringTour("/x", { isTour: false })).toBeNull();
    expect((await blockPaypalDuringTour("/x", { isTour: true }))?.status).toBe(403);
    await startTour();
    expect((await blockPaypalDuringTour("/x"))?.status).toBe(403);
  });
  it("POST /api/paypal/orders refuses a tour job and creates no order", async () => {
    const run = await startTour();
    const job = await tourJob(run);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await ordersRoute(post("/api/paypal/orders", { jobId: job.id }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("tour_paypal_blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).paypalOrderId).toBeNull();
  });
  it("runs the whole tour job lifecycle with TOUR-SIMULATED capture and payout, and no PayPal gateway call", async () => {
    const run = await startTour();
    const job = await tourJob(run);
    await approve(job);
    await payRoute(post("/api/tour/pay", { jobId: job.id }));
    const tech = { kind: "technician", techId: "t1" } as const;
    const owner = { kind: "owner", ownerId: "o1" } as const;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await acceptJob(job.id, tech);
    await startJob(job.id, tech);
    await completeJob(job.id, tech, { photoPath: "/uploads/x.png", notes: "swapped the screen" });
    const out = await confirmRepair(job.id, owner);
    expect(out && "ok" in out && out.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("payout_released");
    expect(done.paypalCaptureId).toMatch(/^SIM-TOUR-CAP-/);
    expect(done.payoutBatchId).toMatch(/^SIM-TOUR-BATCH-/);
    expect(done.payoutNote).toMatch(/TOUR-SIMULATED/);
    expect(done.payoutCents).toBe(2700);
    // And it never became a verified record or an impact row.
    expect(await db.verifiedRepair.count()).toBe(0);
    expect(await db.impactEvent.count()).toBe(0);
  });
  it("refuses to move a tour job outside its own session", async () => {
    const run = await startTour();
    const job = await tourJob(run, "paid", { paypalAuthId: "SIM-TOUR-AUTH-x", authSimulated: true });
    jar.delete(TOUR_COOKIE);
    await expect(acceptJob(job.id, { kind: "technician", techId: "t1" })).rejects.toThrow(/guided demo session/);
    jar.set(TOUR_COOKIE, (await db.tourRun.create({ data: {} })).id);
    await expect(acceptJob(job.id, { kind: "technician", techId: "t1" })).rejects.toThrow(/guided demo session/);
    jar.set(TOUR_COOKIE, run);
    await acceptJob(job.id, { kind: "technician", techId: "t1" });
    process.env.DEMO_ACTIONS = "false";
    await expect(startJob(job.id, { kind: "technician", techId: "t1" })).rejects.toThrow(/guided demo session/);
  });
  it("webhooks ignore tour jobs", async () => {
    const run = await startTour();
    const job = await tourJob(run, "paid", { paypalAuthId: "SIM-TOUR-AUTH-w", authSimulated: true });
    const res = await processWebhookEvent(
      { id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "SIM-TOUR-AUTH-w" } } as never,
      true,
    );
    expect(res).toBe("ignored");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("paid");
    expect(await db.webhookEvent.count()).toBe(0);
  });
});

describe("cleanup", () => {
  it("Finish/Stop: /api/tour/cleanup deletes every tour record, clears cookies, and leaves real data alone", async () => {
    const real = await tourJob(null);
    const run = await startTour();
    const job = await tourJob(run);
    await approve(job);
    const res = await cleanupRoute(post("/api/tour/cleanup", { runId: run }));
    expect(res.status).toBe(200);
    expect(jar.has(TOUR_COOKIE)).toBe(false);
    for (const t of [db.job, db.device, db.agentRun, db.agentApproval, db.tourRun] as const) {
      expect(await (t as typeof db.job).count({ where: { id: { not: real.id }, ...(t === db.tourRun || t === db.agentApproval ? {} : { isTour: true }) } as never })).toBeLessThanOrEqual(t === db.agentRun || t === db.device ? 1 : 0);
    }
    expect(await db.job.count({ where: { isTour: true } })).toBe(0);
    expect(await db.device.count({ where: { isTour: true } })).toBe(0);
    expect(await db.agentRun.count({ where: { isTour: true } })).toBe(0);
    expect(await db.agentApproval.count({ where: { jobId: job.id } })).toBe(0);
    expect(await db.job.count({ where: { id: real.id } })).toBe(1);
  });
  it("a stale tab cannot delete another run (body runId must match the cookie)", async () => {
    const run = await startTour();
    const job = await tourJob(run);
    await cleanupRoute(post("/api/tour/cleanup", { runId: "11111111-1111-1111-1111-111111111111" }));
    expect(await db.job.count({ where: { id: job.id } })).toBe(1);
  });
  it("interrupted run: the next page load posts cleanup with only the cookie and everything is removed", async () => {
    const run = await startTour();
    await tourJob(run, "paid");
    // The browser lost its sessionStorage state (tab closed / reloaded stale); the bootstrap posts an empty body.
    expect((await cleanupRoute(post("/api/tour/cleanup"))).status).toBe(200);
    expect(await db.job.count({ where: { isTour: true } })).toBe(0);
    expect(await currentTourRun()).toBeNull();
  });
  it("purges runs older than 2 hours (and orphaned tour records) whenever a new tour starts", async () => {
    const old = await db.tourRun.create({ data: { createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const oldJob = await tourJob(old.id);
    const orphanJob = await tourJob("99999999-9999-9999-9999-999999999999"); // its run row is gone
    const fresh = await db.tourRun.create({ data: {} });
    const freshJob = await tourJob(fresh.id);
    await startTour();
    expect(await db.job.count({ where: { id: oldJob.id } })).toBe(0);
    expect(await db.job.count({ where: { id: orphanJob.id } })).toBe(0);
    expect(await db.job.count({ where: { id: freshJob.id } })).toBe(1);
    expect(await db.tourRun.count({ where: { id: old.id } })).toBe(0);
    await purgeStaleTours();
  });
  it("cleanupTourRun is idempotent", async () => {
    const run = await db.tourRun.create({ data: {} });
    await tourJob(run.id);
    await cleanupTourRun(run.id);
    await expect(cleanupTourRun(run.id)).resolves.toBeDefined();
  });
});

describe("tour data is excluded everywhere it could leak", () => {
  it("hidden from other visitors' lists (tourScope)", async () => {
    const run = await db.tourRun.create({ data: {} });
    const mine = await tourJob(run.id);
    const theirs = await tourJob((await db.tourRun.create({ data: {} })).id);
    const real = await tourJob(null);
    const ids = async (runId: string | null) => (await db.job.findMany({ where: tourScope(runId) })).map((j) => j.id).sort();
    expect(await ids(null)).toEqual([real.id]);
    expect(await ids(run.id)).toEqual([real.id, mine.id].sort());
    expect(await ids(run.id)).not.toContain(theirs.id);
  });
  it("public profile and CV data never include tour repairs", async () => {
    const run = await db.tourRun.create({ data: {} });
    const tj = await tourJob(run.id, "payout_released");
    const rj = await tourJob(null, "payout_released", { payoutMode: "paypal_sandbox" });
    for (const j of [tj, rj]) await db.verifiedRepair.create({ data: { jobId: j.id, technicianId: "t1", deviceType: "phone", repairType: "Screen", rating: 5, completedAt: new Date() } });
    const list = await verifiedRepairsFor("t1");
    expect(list).toHaveLength(1);
  });
  it("impact page, donation fund and technician earnings ignore tour records", async () => {
    const run = await db.tourRun.create({ data: {} });
    await tourJob(run.id, "payout_released", { payoutMode: "simulated" });
    await db.donation.create({ data: { donorName: "T", amountCents: 9900, status: "completed", isTour: true, simulated: true } });
    await db.donation.create({ data: { donorName: "R", amountCents: 500, status: "completed", simulated: true } });
    const flat = async (mod: string, args: unknown[] = []) => JSON.stringify(await (await import(mod)).default(...args));
    const impact = await flat("@/app/impact/page");
    expect(impact).not.toContain("$27.00"); // the tour job's payout
    expect(impact).not.toContain("$99.00"); // the tour donation
    expect(impact).toContain("$5.00");
    const donate = await flat("@/app/donate/page", [{ searchParams: Promise.resolve({}) }]);
    expect(donate).not.toContain("$99.00");
    jar.set("reloop_tech", "t1");
    jar.set("reloop_role", "technician");
    const board = await flat("@/app/technician/page");
    expect(board).not.toContain("$27.00");
  });
});
