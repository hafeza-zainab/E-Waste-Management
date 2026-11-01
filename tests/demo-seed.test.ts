import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedDemoData } from "../prisma/demo-data";
import { DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL, DEFAULT_DEMO_PASSWORD } from "@/lib/auth/constants";
import { authenticate, purgeExpiredGuests } from "@/lib/auth/accounts";
import { DiagnosisSchema } from "@/lib/ai/schemas";
import { QuoteSchema } from "@/lib/jobs/quote";
import { verifiedRepairsFor } from "@/lib/profile/queries";
import { buildCv } from "@/lib/pdf/cv";
import { computeTotals } from "@/lib/impact/totals";
import { pdfText } from "./helpers/pdf-text";
import { wipeAll } from "./helpers/wipe";

beforeEach(async () => { await wipeAll(); });
const counts = async () => Promise.all([
  db.user.count(), db.owner.count(), db.technician.count(), db.device.count(), db.job.count(),
  db.jobEvent.count(), db.verifiedRepair.count(), db.impactEvent.count(), db.donation.count(),
]);

describe("runtime judge sample data", () => {
  it("reuses migrated demo profiles without taking over a real technician with the same name", async () => {
    const ownerUser = await db.user.create({ data: { email: DEMO_OWNER_EMAIL, name: "Demo Owner", passwordHash: "!", role: "owner" } });
    const legacyOwner = await db.owner.create({ data: { email: DEMO_OWNER_EMAIL, name: "Demo Owner", userId: ownerUser.id } });
    const realUser = await db.user.create({ data: { email: "real-aisha@example.test", name: "Aisha Rahman", passwordHash: "!", role: "technician" } });
    const profile = { name: "Aisha Rahman", city: "Metro Central", bio: "Existing profile", skills: "phone,tablet", rating: 4.9, distanceKm: 2, hourlyCents: 1800, paypalEmail: "sample@example.test" };
    await db.technician.create({ data: { ...profile, userId: realUser.id } });
    const legacyUser = await db.user.create({ data: { email: "tech-aisha@reloop.invalid", name: "Aisha Rahman", passwordHash: "!", role: "technician" } });
    const legacyTech = await db.technician.create({ data: { ...profile, userId: legacyUser.id } });
    await seedDemoData(db, {});
    expect((await db.owner.findUniqueOrThrow({ where: { email: DEMO_OWNER_EMAIL } })).id).toBe(legacyOwner.id);
    expect((await db.technician.findFirstOrThrow({ where: { user: { email: DEMO_TECH_EMAIL } } })).id).toBe(legacyTech.id);
    expect(await db.user.findUnique({ where: { id: realUser.id } })).toMatchObject({ email: "real-aisha@example.test", passwordHash: "!" });
    expect(await db.technician.count()).toBe(7); // six seed profiles plus the real user
  });
  it("seeds a nonempty database idempotently, preserves user data and repair progress, and never calls PayPal", async () => {
    const user = await db.user.create({ data: { email: "existing@example.test", name: "Existing owner", passwordHash: "!", role: "owner" } });
    const owner = await db.owner.create({ data: { email: user.email, name: user.name, userId: user.id } });
    const device = await db.device.create({ data: { ownerId: owner.id, type: "phone", brand: "Existing", model: "Keep me", ageYears: 2, problem: "Existing data" } });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Seed must stay offline"));
    try {
      await seedDemoData(db, {});
      const before = await counts();
      await db.job.update({ where: { id: "seed-demo-job-quoted" }, data: { status: "cancelled" } });
      await db.device.update({ where: { id: "seed-demo-diagnosed" }, data: { problem: "Judge edited this sample" } });
      await seedDemoData(db, {});
      expect(await counts()).toEqual(before);
      expect(await db.device.findUnique({ where: { id: device.id } })).toMatchObject({ problem: "Existing data", ownerId: owner.id });
      expect(await db.job.findUnique({ where: { id: "seed-demo-job-quoted" } })).toMatchObject({ status: "cancelled" });
      expect(await db.device.findUnique({ where: { id: "seed-demo-diagnosed" } })).toMatchObject({ problem: "Judge edited this sample" });
      expect(await authenticate(DEMO_OWNER_EMAIL, DEFAULT_DEMO_PASSWORD)).toMatchObject({ role: "owner", isGuest: false });
      expect(await authenticate(DEMO_TECH_EMAIL, DEFAULT_DEMO_PASSWORD)).toMatchObject({ role: "technician", isGuest: false });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("has ready diagnoses, a safety block, an itemised quote, paid repair history, CV content and impact", async () => {
    await seedDemoData(db, {});
    const owner = await db.owner.findUniqueOrThrow({ where: { email: DEMO_OWNER_EMAIL }, include: { devices: true } });
    expect(owner.devices).toHaveLength(7);
    for (const d of owner.devices) expect(DiagnosisSchema.safeParse(JSON.parse(d.diagnosisJson!)).success).toBe(true);
    const unsafe = owner.devices.find(d => d.id === "seed-demo-safety-block")!;
    expect(JSON.parse(unsafe.diagnosisJson!)).toMatchObject({ diy_allowed: false, safety_risk: { level: "high" }, recommended_path: "technician" });
    const quote = await db.job.findUniqueOrThrow({ where: { id: "seed-demo-job-quoted" } });
    expect(quote.status).toBe("quoted");
    expect(QuoteSchema.parse(JSON.parse(quote.quoteJson!)).totalCents).toBe(quote.totalCents);
    const paid = await db.job.findMany({ where: { status: "payout_released" } });
    expect(paid).toHaveLength(4);
    for (const job of paid) {
      expect(job).toMatchObject({ payoutStatus: "SUCCESS", payoutMode: "simulated", authSimulated: true, isTour: false });
      expect(job.paypalAuthId).toMatch(/^SIM-SEED-/);
      expect(job.paypalCaptureId).toMatch(/^SIM-SEED-/);
      expect(job.payoutBatchId).toMatch(/^SIM-SEED-/);
      expect(job.payoutCents + job.platformFeeCents).toBe(job.totalCents);
    }
    const tech = await db.technician.findFirstOrThrow({ where: { user: { email: DEMO_TECH_EMAIL } } });
    const repairs = await verifiedRepairsFor(tech.id);
    expect(repairs).toHaveLength(3);
    expect(repairs.every(r => r.demo)).toBe(true);
    const cv = await buildCv({ ...tech, skills: tech.skills.split(","), profileUrl: `https://example.test/tech/${tech.id}`, repairs: repairs.map(r => ({ ...r, date: r.date.toISOString().slice(0, 10) })) });
    expect(pdfText(cv)).toContain("Verified repairs: 3");
    expect(pdfText(cv)).toContain("Screen replacement");
    expect(computeTotals(await db.impactEvent.findMany())).toMatchObject({ devices: 4, includesDemo: true });
    expect((await db.donation.aggregate({ where: { status: "completed", simulated: true }, _sum: { amountCents: true } }))._sum.amountCents).toBe(8500);
  });

  it("protects demo accounts and all their rows from guest expiry, even if incorrectly guest-tagged", async () => {
    await seedDemoData(db, {});
    const before = await counts();
    const old = new Date(Date.now() - 3 * 86400000);
    await db.user.updateMany({ where: { email: { in: [DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL] } }, data: { isGuest: true, createdAt: old } });
    const guest = await db.user.create({ data: { email: "old@guest.invalid", name: "Old guest", passwordHash: "!", role: "owner", isGuest: true, createdAt: old } });
    await db.owner.create({ data: { name: guest.name, email: guest.email, userId: guest.id } });
    expect(await purgeExpiredGuests()).toBe(1);
    expect(await counts()).toEqual(before);
    await seedDemoData(db, {});
    expect(await db.user.count({ where: { email: { in: [DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL] }, isGuest: false } })).toBe(2);
  });
});
