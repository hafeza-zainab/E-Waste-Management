import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
const sets = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.get(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => {
      sets.names.push(n);
      if (v === "") jar.delete(n);
      else jar.set(n, v);
    },
    delete: (n: string) => jar.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { db } from "@/lib/db";
import { SESSION_COOKIE, TOUR_ROLE_COOKIE } from "@/lib/auth/constants";
import { acceptJob } from "@/lib/jobs/lifecycle";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { getPrincipalOrNull, getViewer } from "@/lib/session";
import { TOUR_COOKIE } from "@/lib/tour/constants";
import { POST as startRoute } from "@/app/api/tour/start/route";
import { POST as roleRoute } from "@/app/api/tour/role/route";
import { POST as cleanupRoute } from "@/app/api/tour/cleanup/route";
import { loginAs } from "./helpers/auth";
import { wipeAll } from "./helpers/wipe";
import { chaptersFor } from "@/lib/tour/script";

const post = (path: string, body: unknown = {}) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6" }, body: JSON.stringify(body) });
const QUOTE = JSON.stringify({ pickup: false, lines: [{ kind: "part", label: "Part", cents: 3000 }], totalCents: 3000, partsCents: 3000, laborCents: 0, logisticsCents: 0, platformFeeCents: 300, technicianPayoutCents: 2700, technicianId: "t1", technicianName: "Tech", matchReasons: [] });

let mine: string; // the visitor's own (non-tour) job
beforeEach(async () => {
  jar.clear();
  sets.names.length = 0;
  resetRateLimits();
  process.env.DEMO_ACTIONS = "true";
  await wipeAll();
  await db.owner.create({ data: { id: "o1", name: "Real Owner", email: "o1@x.test" } });
  await db.technician.create({ data: { id: "t1", name: "Tech", city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: "t@x.test" } });
  await db.technician.create({ data: { id: "t2", name: "Other Tech", city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: "t2@x.test" } });
  await db.device.create({ data: { id: "mine-d", ownerId: "o1", type: "phone", brand: "Mine", model: "M", ageYears: 1, problem: "cracked screen here" } });
  mine = (await db.job.create({ data: { deviceId: "mine-d", technicianId: "t1", status: "paid", diagnosisJson: "{}", quoteJson: QUOTE, totalCents: 3000, paypalAuthId: "SIM-A" } })).id;
});

async function tourJobFor(runId: string, techId = "t1") {
  const owner = await db.owner.upsert({ where: { email: "tour-visitor@reloop.invalid" }, update: {}, create: { name: "Tour visitor", email: "tour-visitor@reloop.invalid" } });
  const d = await db.device.create({ data: { ownerId: owner.id, type: "phone", brand: "Tour", model: "T", ageYears: 1, problem: "cracked screen here", isTour: true, tourRunId: runId } });
  return db.job.create({ data: { deviceId: d.id, technicianId: techId, status: "paid", diagnosisJson: "{}", quoteJson: QUOTE, totalCents: 3000, paypalAuthId: "SIM-TOUR-AUTH-1", authSimulated: true, isTour: true, tourRunId: runId } });
}

describe("tour identity overlay", () => {
  it("start returns the seeded technician with a verified record for the proof chapter", async () => {
    const j = await db.job.create({ data: { deviceId: "mine-d", technicianId: "t2", status: "payout_released", diagnosisJson: "{}" } });
    await db.verifiedRepair.create({ data: { jobId: j.id, technicianId: "t2", deviceType: "phone", repairType: "Screen", rating: 5, completedAt: new Date() } });
    const body = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string; seededTechId: string };
    expect(body.seededTechId).toBe("t2");
  });

  it("while a tour runs the visitor's own session is ignored, and its cookie is never read-modified, rotated, deleted or replaced", async () => {
    const token = await loginAs(jar, { ownerId: "o1" });
    expect(await getPrincipalOrNull()).toEqual({ kind: "owner", ownerId: "o1" });
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    const job = await tourJobFor(runId);
    expect((await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }))).status).toBe(200);
    await roleRoute(post("/api/tour/role", { role: "owner" }));
    await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }));
    expect(job.id).toBeTruthy();
    expect(await cleanupRoute(post("/api/tour/cleanup", { runId }))).toBeTruthy();
    expect(jar.get(SESSION_COOKIE)).toBe(token);
    expect(sets.names).not.toContain(SESSION_COOKIE);
    expect(await db.session.count()).toBe(1);
    expect(await getPrincipalOrNull()).toEqual({ kind: "owner", ownerId: "o1" }); // the real user is back, still logged in
  });

  it("the overlay acts as the tour owner by default, then as the technician of a job in this run", async () => {
    await loginAs(jar, { ownerId: "o1" });
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    const asOwner = await getPrincipalOrNull();
    expect(asOwner).toMatchObject({ kind: "owner", tourRunId: runId });
    expect((asOwner as { ownerId: string }).ownerId).not.toBe("o1"); // never the visitor's own owner profile
    await tourJobFor(runId);
    await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }));
    expect(await getPrincipalOrNull()).toEqual({ kind: "technician", techId: "t1", tourRunId: runId });
    expect((await getViewer()).user).toBeNull(); // the header does not show the visitor's account during a tour
    expect((await getViewer()).tour).toEqual({ role: "technician" });
  });

  it("refuses a technician who has no job in this run, and a forged overlay cookie for another run", async () => {
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    await tourJobFor(runId, "t1");
    expect((await roleRoute(post("/api/tour/role", { role: "technician", techId: "t2" }))).status).toBe(403);
    expect((await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }))).status).toBe(200);
    jar.set(TOUR_ROLE_COOKIE, "00000000-0000-4000-8000-000000000000:technician:t1");
    expect(await getPrincipalOrNull()).toMatchObject({ kind: "owner", tourRunId: runId }); // falls back to the default tour owner
    jar.delete(TOUR_COOKIE);
    expect((await roleRoute(post("/api/tour/role", { role: "owner" }))).status).toBe(403); // no tour, no overlay
  });

  it("the overlay reaches tour jobs of its own run only; real jobs are out of reach, and real users cannot reach tour jobs", async () => {
    await loginAs(jar, { techId: "t1" });
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    const tourJob = await tourJobFor(runId);
    await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }));
    const overlay = (await getPrincipalOrNull())!;
    await expect(acceptJob(mine, overlay)).rejects.toMatchObject({ code: "forbidden" }); // the real job of the same technician
    await acceptJob(tourJob.id, overlay);
    expect((await db.job.findUniqueOrThrow({ where: { id: tourJob.id } })).status).toBe("accepted");
    // A real principal (no tourRunId) is refused on a tour job even with a valid tour cookie in the jar.
    await expect(acceptJob(tourJob.id, { kind: "technician", techId: "t1" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the visitor's own dashboards are not shown during the tour, and tour records are hidden from real accounts", async () => {
    const flat = (v: unknown) => { const seen = new WeakSet(); return JSON.stringify(v, (_k, x) => (typeof x === "object" && x ? (seen.has(x) ? undefined : (seen.add(x), x)) : x)); };
    await loginAs(jar, { ownerId: "o1" });
    expect(flat(await (await import("@/app/owner/page")).default())).toContain("Mine");
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    await tourJobFor(runId);
    const during = flat(await (await import("@/app/owner/page")).default());
    expect(during).not.toContain("Mine"); // their own device is not in the tour
    expect(during).toContain("Tour");
    await cleanupRoute(post("/api/tour/cleanup", { runId }));
    const after = flat(await (await import("@/app/owner/page")).default());
    expect(after).toContain("Mine");
    expect(after).not.toContain("Tour");
    expect(await db.device.findUniqueOrThrow({ where: { id: "mine-d" } })).toMatchObject({ brand: "Mine" }); // untouched
    expect((await db.job.findUniqueOrThrow({ where: { id: mine } })).status).toBe("paid");
  });

  it("cleanup clears the overlay cookie along with the tour cookies", async () => {
    const { runId } = (await (await startRoute(post("/api/tour/start"))).json()) as { runId: string };
    await tourJobFor(runId);
    await roleRoute(post("/api/tour/role", { role: "technician", techId: "t1" }));
    expect(jar.has(TOUR_ROLE_COOKIE)).toBe(true);
    await cleanupRoute(post("/api/tour/cleanup", { runId }));
    expect(jar.has(TOUR_ROLE_COOKIE)).toBe(false);
    expect(jar.has(TOUR_COOKIE)).toBe(false);
  });
});

describe("entry points", () => {
  it("the signup tour adds an accounts chapter that only talks (never types, clicks or submits); the home tour does not have it", () => {
    const signup = chaptersFor("/signup");
    const home = chaptersFor("/");
    expect(signup[0].id).toBe("accounts");
    expect(home.map((c) => c.id)).not.toContain("accounts");
    expect(signup.slice(1).map((c) => c.id)).toEqual(home.map((c) => c.id));
    expect(signup[0].steps.every((s) => s.t === "say")).toBe(true);
    for (const c of [...signup, ...home]) for (const s of c.steps) if (s.t === "type" || s.t === "click") expect(JSON.stringify(s)).not.toMatch(/signup|guest-button|email|password/);
  });
});
