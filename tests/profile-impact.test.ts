import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ensureVerifiedRepair } from "@/lib/jobs/lifecycle";
import { shortRef, verifiedRepairsFor } from "@/lib/profile/queries";
import { computeTotals, devicesFunded, donationsByDay } from "@/lib/impact/totals";
import { advancePickup, bookPickup, nextPickupStatus, PickupError, validatePickupDate } from "@/lib/recycling/pickup";

const diagnosis = (path: string) =>
  JSON.stringify({
    summary: "s", likely_causes: [{ cause: "Dead board", confidence: 0.9 }], severity: "not_repairable", safety_risk: { level: "low", reasons: [] },
    recommended_path: path, estimated_parts: [], estimated_labor: { hours: 0, cost_usd: 0 }, model_recommended_path: path, diy_allowed: false, gate_notes: [],
    environmental_impact: { outcome: "recycle", ewaste_kg: 1, co2e_kg: 1 },
  });
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await db.$transaction([db.impactEvent.deleteMany(), db.recyclingPickup.deleteMany(), db.verifiedRepair.deleteMany(), db.jobEvent.deleteMany(), db.job.deleteMany(), db.device.deleteMany(), db.technician.deleteMany(), db.owner.deleteMany()]);
  await db.owner.create({ data: { id: "o1", name: "O", email: "o@x.test" } });
  await db.technician.create({ data: { id: "t1", name: "Tech", city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: "secret@personal.example.com" } });
  await db.device.create({ data: { id: "d1", ownerId: "o1", type: "phone", brand: "A", model: "B", ageYears: 1, problem: "cracked screen here" } });
  await db.device.create({ data: { id: "d2", ownerId: "o1", type: "tv", brand: "Sony", model: "K", ageYears: 14, problem: "dead tv no power", diagnosisJson: diagnosis("recycle") } });
});

const job = (status: string, extra: Record<string, unknown> = {}) =>
  db.job.create({ data: { deviceId: "d1", technicianId: "t1", status, diagnosisJson: JSON.stringify({ estimated_parts: [{ name: "Screen" }] }), totalCents: 1000, ...extra } });

describe("public technician profile data", () => {
  it("includes only payout_released jobs, each once, with shortened refs and no private fields", async () => {
    const released = await job("payout_released", { payoutBatchId: "BATCH-ABCDEFGH-1234", payoutMode: "paypal_sandbox" });
    const pending = await job("customer_confirmed");
    const failed = await job("payout_failed");
    for (const j of [released, pending, failed]) {
      const full = await db.job.findUniqueOrThrow({ where: { id: j.id }, include: { device: true } });
      await ensureVerifiedRepair(full);
      await ensureVerifiedRepair(full); // idempotent
    }
    expect(await db.verifiedRepair.count()).toBe(3);
    const list = await verifiedRepairsFor("t1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ deviceType: "phone", repairType: "Screen", payoutRef: "BATC…1234", demo: false });
    expect(JSON.stringify(list)).not.toMatch(/secret@|personal\.example|BATCH-ABCDEFGH-1234/);
  });
  it("flags seeded, simulated and ledger payouts as demo", async () => {
    const j = await job("payout_released", { payoutBatchId: "SIM-BATCH-x", payoutMode: "simulated" });
    await ensureVerifiedRepair(await db.job.findUniqueOrThrow({ where: { id: j.id }, include: { device: true } }));
    expect((await verifiedRepairsFor("t1"))[0].demo).toBe(true);
  });
  it("shortens refs", () => {
    expect(shortRef("ABCDEFGHIJ1234")).toBe("ABCD…1234");
    expect(shortRef("abc")).toBe("abc");
    expect(shortRef(null)).toBe("n/a");
  });
  it("releasing a payout records the repair's impact once per device", async () => {
    const j = await job("payout_released", { payoutMode: "paypal_sandbox" });
    const full = await db.job.findUniqueOrThrow({ where: { id: j.id }, include: { device: true } });
    await ensureVerifiedRepair(full);
    await ensureVerifiedRepair(full);
    expect(await db.impactEvent.count({ where: { deviceId: "d1", outcome: "repair" } })).toBe(1);
  });
});

describe("impact totals", () => {
  const row = (deviceId: string | null, outcome: string, kg = 1, co2 = 10, demo = false) => ({ deviceId, outcome, ewasteKg: kg, co2eKg: co2, demo });
  it("counts each device once and sums the rest", () => {
    const t = computeTotals([row("a", "repair"), row("a", "recycle", 5, 50), row("b", "recycle", 2, 3), row(null, "donate"), row(null, "donate")]);
    expect(t).toMatchObject({ devices: 4, ewasteKg: 5, co2eKg: 33, includesDemo: false });
    expect(t.byOutcome).toMatchObject({ repair: 1, recycle: 1, donate: 2, refurbish: 0 });
  });
  it("marks demo data and handles empty input", () => {
    expect(computeTotals([row("a", "repair", 1, 1, true)]).includesDemo).toBe(true);
    expect(computeTotals([])).toMatchObject({ devices: 0, ewasteKg: 0, co2eKg: 0 });
  });
  it("adds donations: devices funded and per-day running total", () => {
    expect(devicesFunded(2499)).toBe(0);
    expect(devicesFunded(2500)).toBe(1);
    expect(devicesFunded(10_000)).toBe(4);
    const pts = donationsByDay([
      { amountCents: 500, at: new Date("2026-10-02T23:00:00Z") },
      { amountCents: 1000, at: new Date("2026-10-01T01:00:00Z") },
      { amountCents: 250, at: new Date("2026-10-02T01:00:00Z") },
    ]);
    expect(pts).toEqual([
      { day: "2026-10-01", cents: 1000, cumulativeCents: 1000 },
      { day: "2026-10-02", cents: 750, cumulativeCents: 1750 },
    ]);
  });
  it("a processed recycling pickup adds one impact row and is counted", async () => {
    await bookPickup({ deviceId: "d2", address: "12 Example Street", pickupDate: future(3) });
    expect(await advancePickup("d2")).toBe("collected");
    expect(await db.impactEvent.count()).toBe(0);
    expect(await advancePickup("d2")).toBe("processed");
    await expect(advancePickup("d2")).rejects.toThrow(PickupError);
    const rows = await db.impactEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: "d2", outcome: "recycle", demo: true });
    expect(computeTotals(rows).byOutcome.recycle).toBe(1);
  });
});

describe("recycling pickup", () => {
  it("validates address and date, and only books recycle-path devices once", async () => {
    await expect(bookPickup({ deviceId: "d2", address: "short", pickupDate: future(2) })).rejects.toThrow(/address/i);
    await expect(bookPickup({ deviceId: "d2", address: "12 Example Street", pickupDate: "2020-01-01" })).rejects.toThrow(/past/);
    await expect(bookPickup({ deviceId: "d2", address: "12 Example Street", pickupDate: future(90) })).rejects.toThrow(/within/);
    await expect(bookPickup({ deviceId: "d1", address: "12 Example Street", pickupDate: future(2) })).rejects.toThrow(PickupError);
    const a = await bookPickup({ deviceId: "d2", address: "12 Example Street", pickupDate: future(2) });
    const b = await bookPickup({ deviceId: "d2", address: "Elsewhere 99", pickupDate: future(4) });
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ status: "booked", demo: true });
    expect(a.recycler).toMatch(/Demo/);
  });
  it("status order and the production guard", async () => {
    expect(nextPickupStatus("booked")).toBe("collected");
    expect(nextPickupStatus("processed")).toBeNull();
    expect(validatePickupDate(future(1))).toBeNull();
    await bookPickup({ deviceId: "d2", address: "12 Example Street", pickupDate: future(2) });
    vi.stubEnv("NODE_ENV", "production");
    await expect(advancePickup("d2")).rejects.toThrow(/Not available/);
    vi.unstubAllEnvs();
  });
});
