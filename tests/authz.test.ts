import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.get(n) ? { name: n, value: jar.get(n)! } : undefined), set: (n: string, v: string) => (v === "" ? jar.delete(n) : jar.set(n, v)), delete: (n: string) => jar.delete(n) }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { acceptJob, cancelJob } from "@/lib/jobs/lifecycle";
import { getPrincipalOrNull } from "@/lib/session";
import { itemsHash } from "@/lib/agent/approval";
import { loginAs } from "./helpers/auth";
import { wipeAll } from "./helpers/wipe";
import { GET as uploadsGET } from "@/app/uploads/[name]/route";
import { POST as ordersPOST } from "@/app/api/paypal/orders/route";
import { POST as authorizePOST } from "@/app/api/paypal/orders/[orderId]/authorize/route";
import { POST as simulatePOST } from "@/app/api/paypal/webhook/simulate/route";
import { POST as approvePOST } from "@/app/api/agent/approve/route";
import { POST as cancelPOST } from "@/app/api/agent/cancel/route";
import { POST as runPOST } from "@/app/api/agent/run/route";
import { createDevice, createGuide, createQuote, bookRecycling } from "@/app/owner/actions";
import { confirmAction } from "@/app/jobs/actions";

const DIAG = JSON.stringify({
  summary: "s", likely_causes: [{ cause: "Cracked glass", confidence: 0.9 }], severity: "minor", safety_risk: { level: "low", reasons: [] },
  recommended_path: "technician", estimated_parts: [], estimated_labor: { hours: 1, cost_usd: 20 }, model_recommended_path: "technician", diy_allowed: true, gate_notes: [],
  environmental_impact: { outcome: "repair", ewaste_kg: 1, co2e_kg: 1 },
});
const QUOTE = { pickup: false, lines: [{ kind: "part" as const, label: "Part", cents: 3000 }], totalCents: 3000, partsCents: 3000, laborCents: 0, logisticsCents: 0, platformFeeCents: 300, technicianPayoutCents: 2700, technicianId: "t1", technicianName: "Tech One", matchReasons: [] };
const flat = (v: unknown) => { const seen = new WeakSet(); return JSON.stringify(v, (_k, x) => (typeof x === "object" && x ? (seen.has(x) ? undefined : (seen.add(x), x)) : x)); };
const PROOF = "/uploads/11111111-1111-4111-8111-111111111111.png";
const INTAKE = "/uploads/22222222-2222-4222-8222-222222222222.png";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const post = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.5.5.5" }, body: JSON.stringify(body) });
const form = (o: Record<string, string>) => Object.assign(new FormData(), {}) && Object.entries(o).reduce((f, [k, v]) => (f.append(k, v), f), new FormData());

/** Runs a Next page/action and reports what it did: its return, a redirect target, or notFound. */
async function outcome(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return `redirect:${decodeURIComponent(digest.split(";")[2] ?? "")}`;
    if (digest.includes("404")) return "notFound";
    throw e;
  }
}
const asOwner1 = () => loginAs(jar, { ownerId: "o1" });
const as = {
  o1: () => loginAs(jar, { ownerId: "o1" }),
  o2: () => loginAs(jar, { ownerId: "o2" }),
  t1: () => loginAs(jar, { techId: "t1" }),
  t2: () => loginAs(jar, { techId: "t2" }),
  guest: () => loginAs(jar, { ownerId: "og" }, { guest: true }),
  anon: async () => void jar.clear(),
};
type Who = keyof typeof as;

let jobId: string;
let approvalId: string;
beforeEach(async () => {
  jar.clear();
  resetRateLimits();
  vi.unstubAllEnvs();
  const dir = mkdtempSync(path.join(tmpdir(), "authz-"));
  writeFileSync(path.join(dir, path.basename(PROOF)), png);
  writeFileSync(path.join(dir, path.basename(INTAKE)), png);
  process.env.UPLOAD_DIR = dir;
  await wipeAll();
  for (const [id, n] of [["o1", "Owner One"], ["o2", "Owner Two"], ["og", "Guest 1234"]]) await db.owner.create({ data: { id, name: n, email: `${id}@x.test` } });
  for (const [id, n] of [["t1", "Tech One"], ["t2", "Tech Two"]]) await db.technician.create({ data: { id, name: n, city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: `${id}@personal.example.com` } });
  await db.device.create({ data: { id: "d1", ownerId: "o1", type: "phone", brand: "Samsung", model: "A52", ageYears: 2, problem: "cracked screen here", diagnosisJson: DIAG, guideJson: null, photoPath: INTAKE } });
  const run = await db.agentRun.create({ data: { goal: "o1 secret goal", mode: "scripted", ownerId: "o1", deviceId: "d1" } });
  const j = await db.job.create({
    data: { deviceId: "d1", technicianId: "t1", status: "paid", diagnosisJson: DIAG, totalCents: 3000, platformFeeCents: 300, payoutCents: 2700, paypalAuthId: "SIM-AUTH-1", agentRunId: run.id, proofPhotoPath: PROOF },
  });
  jobId = j.id;
  approvalId = (await db.agentApproval.create({ data: { runId: run.id, jobId: j.id, totalCents: 3000, itemsHash: itemsHash({ lines: QUOTE.lines, totalCents: 3000 }), expiresAt: new Date(Date.now() + 600_000) } })).id;
  await db.job.update({ where: { id: j.id }, data: { status: "quoted", quoteJson: JSON.stringify(QUOTE) } });
});

const matrix = async <T,>(fn: () => Promise<T>, who: Who[]) => {
  const out: Record<string, T> = {};
  for (const w of who) {
    await as[w]();
    out[w] = await fn();
  }
  return out;
};
const status = (r: Response) => r.status;

describe("who is acting", () => {
  it("is nobody without a session, the user's own profile with one, and a guest is an owner", async () => {
    await as.anon();
    expect(await getPrincipalOrNull()).toBeNull();
    await as.o1();
    expect(await getPrincipalOrNull()).toEqual({ kind: "owner", ownerId: "o1" });
    await as.t1();
    expect(await getPrincipalOrNull()).toEqual({ kind: "technician", techId: "t1" });
    await as.guest();
    expect(await getPrincipalOrNull()).toEqual({ kind: "owner", ownerId: "og" });
  });
  it("the old role cookies grant nothing", async () => {
    jar.set("reloop_role", "technician");
    jar.set("reloop_tech", "t1");
    expect(await getPrincipalOrNull()).toBeNull();
  });
});

describe("uploads are private to the owner and the assigned technician", () => {
  const get = async (name: string) => status(await uploadsGET(new Request(`http://localhost/uploads/${name}`), { params: Promise.resolve({ name }) } as never));
  it("proof photo: owner and assigned technician only", async () => {
    await db.job.update({ where: { id: jobId }, data: { status: "completed" } });
    expect(await matrix(() => get(path.basename(PROOF)), ["o1", "t1", "o2", "t2", "guest", "anon"])).toEqual({ o1: 200, t1: 200, o2: 404, t2: 404, guest: 404, anon: 401 });
  });
  it("intake photo: the owner only (not even the assigned technician)", async () => {
    expect(await matrix(() => get(path.basename(INTAKE)), ["o1", "t1", "o2", "t2", "guest", "anon"])).toEqual({ o1: 200, t1: 404, o2: 404, t2: 404, guest: 404, anon: 401 });
  });
  it("an unreferenced file, and a malformed name, are never served", async () => {
    await as.o1();
    expect(await get("33333333-3333-4333-8333-333333333333.png")).toBe(404);
    expect(await get("..%2F..%2Fpackage.json")).toBe(404);
    const res = await uploadsGET(new Request("http://localhost/uploads/x"), { params: Promise.resolve({ name: path.basename(INTAKE) }) } as never);
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });
});

describe("pages", () => {
  const page = async (mod: string, id: string, extra = {}) => outcome(async () => (await import(mod)).default({ params: Promise.resolve({ id }), searchParams: Promise.resolve(extra) }));
  it("job page: the owner and the assigned technician (once paid) see it; everyone else gets 404 or the login page", async () => {
    await db.job.update({ where: { id: jobId }, data: { status: "paid" } });
    expect(await matrix(() => page("@/app/jobs/[id]/page", jobId), ["o1", "t1", "o2", "t2", "guest", "anon"])).toEqual({
      o1: "ok", t1: "ok", o2: "notFound", t2: "notFound", guest: "notFound", anon: `redirect:/login?next=/jobs/${jobId}`,
    });
  });
  it("job page: a technician cannot see a job that is only a quote", async () => {
    await as.t1();
    expect(await page("@/app/jobs/[id]/page", jobId)).toBe("notFound");
  });
  it("device diagnosis page and DIY guide: the owner only", async () => {
    const r = await matrix(() => page("@/app/owner/device/[id]/page", "d1"), ["o1", "o2", "guest", "t1", "anon"]);
    expect(r).toEqual({ o1: "ok", o2: "notFound", guest: "notFound", t1: "redirect:/technician", anon: "redirect:/login?next=/owner/device/d1" });
    const g = await matrix(() => page("@/app/owner/device/[id]/guide/page", "d1"), ["o2", "t1", "anon"]);
    expect(g.o2).toBe("notFound");
    expect(g.anon).toMatch(/^redirect:\/login/);
  });
  it("owner and technician dashboards: right role only, anonymous goes to login", async () => {
    const dash = (mod: string) => outcome(async () => (await import(mod)).default());
    expect(await matrix(() => dash("@/app/owner/page"), ["o1", "t1", "anon"])).toEqual({ o1: "ok", t1: "redirect:/technician", anon: "redirect:/login?next=/owner" });
    expect(await matrix(() => dash("@/app/technician/page"), ["t1", "o1", "anon"])).toEqual({ t1: "ok", o1: "redirect:/owner", anon: "redirect:/login?next=/technician" });
  });
  it("an owner's dashboard lists only their own devices", async () => {
    await as.o2();
    const mine = flat(await (await import("@/app/owner/page")).default());
    expect(mine).not.toContain("Samsung");
    await as.o1();
    expect(flat(await (await import("@/app/owner/page")).default())).toContain("Samsung");
  });
  it("the technician dashboard lists only jobs assigned to that technician", async () => {
    await db.job.update({ where: { id: jobId }, data: { status: "paid" } });
    await as.t2();
    expect(flat(await (await import("@/app/technician/page")).default())).not.toContain("Samsung");
    await as.t1();
    expect(flat(await (await import("@/app/technician/page")).default())).toContain("Samsung");
  });
  it("/agent?run= shows a run only to the owner who started it", async () => {
    const run = (await db.agentRun.findFirstOrThrow()).id;
    const goal = async () => flat(await (await import("@/app/agent/page")).default({ searchParams: Promise.resolve({ run }) } as never));
    await as.o1();
    expect(await goal()).toContain("o1 secret goal");
    await as.o2();
    expect(await goal()).not.toContain("o1 secret goal");
    await as.anon();
    expect(await outcome(goal)).toMatch(/^redirect:\/login/);
  });
});

describe("API routes", () => {
  it("PayPal order, authorize and simulate-webhook: 401 anonymous, 404 for anyone but the job's owner", async () => {
    const orders = () => ordersPOST(post("/api/paypal/orders", { jobId }));
    expect(await matrix(async () => status(await orders()), ["anon", "o2", "guest", "t1", "t2"])).toEqual({ anon: 401, o2: 404, guest: 404, t1: 404, t2: 404 });
    const authz = () => authorizePOST(post("/api/paypal/orders/X/authorize", { jobId }), { params: Promise.resolve({ orderId: "X" }) } as never);
    expect(await matrix(async () => status(await authz()), ["anon", "o2", "t1"])).toEqual({ anon: 401, o2: 404, t1: 404 });
    await db.job.update({ where: { id: jobId }, data: { paypalOrderId: "SIM-ORDER-1" } });
    const sim = () => simulatePOST(post("/api/paypal/webhook/simulate", { jobId }));
    vi.stubEnv("NODE_ENV", "development");
    expect(await matrix(async () => status(await sim()), ["anon", "o2", "t1"])).toEqual({ anon: 401, o2: 404, t1: 404 });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("quoted");
  });
  it("agent approve and cancel: 401 anonymous, forbidden for another owner or a technician; the owner can approve", async () => {
    const approve = () => approvePOST(post("/api/agent/approve", { approvalId }));
    expect(await matrix(async () => status(await approve()), ["anon", "o2", "t1", "guest"])).toEqual({ anon: 401, o2: 403, t1: 403, guest: 403 });
    expect((await db.agentApproval.findUniqueOrThrow({ where: { id: approvalId } })).userApprovedAt).toBeNull();
    const cancel = () => cancelPOST(post("/api/agent/cancel", { approvalId }));
    expect(await matrix(async () => status(await cancel()), ["anon", "o2", "t1"])).toEqual({ anon: 401, o2: 409, t1: 409 });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("quoted");
    await as.o1();
    expect((await approve()).status).toBe(200);
  });
  it("agent run: 401 anonymous, 403 for technicians", async () => {
    const run = () => runPOST(new Request("http://localhost/api/agent/run", { method: "POST", body: new FormData() }));
    expect(await matrix(async () => status(await run()), ["anon", "t1"])).toEqual({ anon: 401, t1: 403 });
  });
});

describe("server actions", () => {
  it("createQuote, createGuide and bookRecycling refuse another owner's device", async () => {
    await as.o2();
    expect(await outcome(() => createQuote(form({ deviceId: "d1" })))).toMatch(/redirect:\/owner\/device\/d1\?error=/);
    expect(await db.job.count({ where: { deviceId: "d1" } })).toBe(1); // only the seeded one
    expect(await outcome(() => createGuide(form({ deviceId: "d1" })))).toBe("redirect:/owner");
    expect((await db.device.findUniqueOrThrow({ where: { id: "d1" } })).guideJson).toBeNull();
    expect(await outcome(() => bookRecycling(form({ deviceId: "d1", address: "12 Long Street", pickupDate: "2999-01-01" })))).toMatch(/error=/);
    expect(await db.recyclingPickup.count()).toBe(0);
  });
  it("a guest owns the devices they create, and nobody else can open them", async () => {
    await as.guest();
    const intake = form({ type: "phone", brand: "Pixel", model: "7", ageYears: "2", problem: "screen is cracked badly" });
    const r = await outcome(() => createDevice(intake));
    expect(r).toMatch(/^redirect:\/owner\/device\//);
    const made = await db.device.findFirstOrThrow({ where: { brand: "Pixel" } });
    expect(made.ownerId).toBe("og");
    await as.o1();
    expect(await outcome(async () => (await import("@/app/owner/device/[id]/page")).default({ params: Promise.resolve({ id: made.id }), searchParams: Promise.resolve({}) } as never))).toBe("notFound");
  });
  it("anonymous and technician users cannot create devices", async () => {
    const intake = () => form({ type: "phone", brand: "Pixel", model: "7", ageYears: "2", problem: "screen is cracked badly" });
    await as.anon();
    expect(await outcome(() => createDevice(intake()))).toMatch(/redirect:\/owner\/new\?error=/);
    await as.t1();
    expect(await outcome(() => createDevice(intake()))).toMatch(/redirect:\/owner\/new\?error=.*owners/i);
    expect(await db.device.count({ where: { brand: "Pixel" } })).toBe(0);
  });
  it("lifecycle actions use the session, not the form: another owner cannot confirm; a technician cannot touch an unassigned job", async () => {
    await db.job.update({ where: { id: jobId }, data: { status: "completed", paypalAuthId: "SIM-AUTH-1" } });
    await as.o2();
    expect(await outcome(() => confirmAction(form({ jobId })))).toMatch(/error=Only the job/);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("completed");
    await as.anon();
    expect(await outcome(() => confirmAction(form({ jobId })))).toMatch(/error=Please log in/);
    await db.job.update({ where: { id: jobId }, data: { status: "paid" } });
    await as.t2();
    await expect(acceptJob(jobId, (await getPrincipalOrNull())!)).rejects.toMatchObject({ code: "forbidden" });
    await expect(cancelJob(jobId, (await getPrincipalOrNull())!)).rejects.toMatchObject({ code: "forbidden" });
    await as.t1();
    await acceptJob(jobId, (await getPrincipalOrNull())!);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("accepted");
  });
});

describe("public pages stay public", () => {
  it("home, impact, donate and technician profiles render with no session", async () => {
    await as.anon();
    const run = (mod: string, props: unknown[] = []) => outcome(async () => (await import(mod)).default(...props));
    expect(await run("@/app/page")).toBe("ok");
    expect(await run("@/app/impact/page")).toBe("ok");
    expect(await run("@/app/donate/page", [{ searchParams: Promise.resolve({}) }])).toBe("ok");
    expect(await run("@/app/tech/[id]/page", [{ params: Promise.resolve({ id: "t1" }) }])).toBe("ok");
  });
});

void asOwner1;
