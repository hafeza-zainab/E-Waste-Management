import type { PrismaClient, Technician } from "@prisma/client";
import { ensureDemoAccounts } from "../lib/auth/demo";
import { DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL, NO_PASSWORD } from "../lib/auth/constants";
import { PARTS } from "../lib/agent/parts-data";
import { DIAGNOSIS_FIXTURES, GENERIC_FIXTURE, SCENARIO_INTAKE } from "../lib/ai/fixtures";
import { applySafetyGate } from "../lib/ai/safety";
import { computeImpact } from "../lib/impact/formulas";
import { buildQuote } from "../lib/jobs/quote";

const TECHS = [
  { name: "Aisha Rahman", city: "Metro Central", skills: "phone,tablet", rating: 4.9, distanceKm: 2.1, hourlyCents: 1800, isTrainee: false, bio: "Screen and battery specialist, 8 years bench experience." },
  { name: "Diego Martins", city: "Metro Central", skills: "laptop,phone", rating: 4.7, distanceKm: 4.6, hourlyCents: 2200, isTrainee: false, bio: "Board-level laptop repair and data-safe upgrades." },
  { name: "Priya Nair", city: "Westside", skills: "phone", rating: 4.5, distanceKm: 1.2, hourlyCents: 1200, isTrainee: true, bio: "Polytechnic trainee, supervised phone screen swaps." },
  { name: "Tomasz Kowalski", city: "Eastside", skills: "tv,appliance", rating: 4.8, distanceKm: 7.9, hourlyCents: 2500, isTrainee: false, bio: "TV and small-appliance electronics, 15 years." },
  { name: "Lerato Dlamini", city: "Northgate", skills: "laptop,tablet,phone", rating: 4.6, distanceKm: 5.3, hourlyCents: 2000, isTrainee: false, bio: "Refurbisher for community donation programmes." },
  { name: "Kenji Watanabe", city: "Harbor", skills: "phone,laptop", rating: 4.3, distanceKm: 9.4, hourlyCents: 1500, isTrainee: true, bio: "Apprentice technician building a verified portfolio." },
];
const LIFECYCLE = ["quoted", "paid", "accepted", "in_progress", "completed", "customer_confirmed", "payout_released"];
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);

/** Add missing sample rows on every startup, including nonempty/legacy databases.
 * Reserved IDs keep retries idempotent. Empty updates preserve later edits and
 * lifecycle progress. This module never calls PayPal or runs a guided tour.
 */
export async function seedDemoData(db: PrismaClient, env: Record<string, string | undefined> = process.env) {
  for (const part of PARTS) await db.part.upsert({ where: { id: part.id }, update: part, create: part });
  const ownerUser = await db.user.upsert({
    where: { email: DEMO_OWNER_EMAIL }, update: { isGuest: false },
    create: { email: DEMO_OWNER_EMAIL, name: "Demo Owner", passwordHash: NO_PASSWORD, role: "owner", isGuest: false },
  });
  const owner = await db.owner.upsert({
    where: { email: DEMO_OWNER_EMAIL }, update: {},
    create: { name: "Demo Owner", email: DEMO_OWNER_EMAIL, userId: ownerUser.id },
  });
  const techs: Technician[] = [];
  for (const [index, profile] of TECHS.entries()) {
    const first = profile.name.split(" ")[0].toLowerCase();
    const legacyEmail = `tech-${first}@reloop.invalid`;
    const email = index === 0 ? DEMO_TECH_EMAIL : legacyEmail;
    // Reuse old seeded profiles and their linked users rather than duplicating
    // them or taking over a real technician who happens to share the name.
    const existing = await db.technician.findFirst({ where: { OR: [
      { id: `seed-demo-tech-${first}` }, { user: { email: { in: [email, legacyEmail] } } }, { name: profile.name, userId: null },
    ] } });
    const user = existing?.userId
      ? await db.user.findUniqueOrThrow({ where: { id: existing.userId } })
      : await db.user.upsert({ where: { email }, update: {}, create: { email, name: profile.name, passwordHash: NO_PASSWORD, role: "technician", isGuest: false } });
    techs.push(await db.technician.upsert({
      where: { id: existing?.id ?? `seed-demo-tech-${first}` }, update: {},
      create: { id: `seed-demo-tech-${first}`, ...profile, userId: user.id, paypalEmail: `${first}@personal.example.com` },
    }));
  }
  await ensureDemoAccounts(db, env);

  // Ready-to-view diagnoses use the existing safety gate, including the fixture
  // whose unsafe DIY recommendation is deliberately rejected by that gate.
  const diagnosed = applySafetyGate({ ...GENERIC_FIXTURE, summary: "Sample diagnosis: a worn charging connector causes intermittent charging. A technician can replace the connector." }, "tablet");
  const screen = applySafetyGate(DIAGNOSIS_FIXTURES["cracked-screen"], "phone");
  const blocked = applySafetyGate(DIAGNOSIS_FIXTURES["swollen-battery"], "laptop");
  const stages = [
    { id: "seed-demo-diagnosed", type: "tablet", brand: "Apple", model: "iPad 6th gen", ageYears: 6, problem: "Sample data: charging cable disconnects intermittently.", scenario: null, diagnosis: diagnosed },
    { id: "seed-demo-safety-block", ...SCENARIO_INTAKE["swollen-battery"], scenario: "swollen-battery", diagnosis: blocked },
    { id: "seed-demo-quoted", ...SCENARIO_INTAKE["cracked-screen"], scenario: "cracked-screen", diagnosis: screen },
  ];
  for (const { diagnosis, ...device } of stages) await db.device.upsert({
    where: { id: device.id }, update: {},
    create: { ...device, ownerId: owner.id, diagnosisJson: JSON.stringify(diagnosis), diagnosisSource: "fixture" },
  });
  const quote = buildQuote({ deviceType: "phone", parts: screen.estimated_parts, laborHours: screen.estimated_labor.hours, pickup: false, technicians: techs, technicianId: techs[0].id });
  const quoted = await db.job.upsert({
    where: { id: "seed-demo-job-quoted" }, update: {},
    create: {
      id: "seed-demo-job-quoted", deviceId: "seed-demo-quoted", technicianId: quote.technicianId, status: "quoted",
      diagnosisJson: JSON.stringify(screen), quoteJson: JSON.stringify(quote),
      partsCents: quote.partsCents, laborCents: quote.laborCents, logisticsCents: quote.logisticsCents,
      totalCents: quote.totalCents, platformFeeCents: quote.platformFeeCents, payoutCents: quote.technicianPayoutCents,
    },
  });
  await db.jobEvent.upsert({ where: { id: "seed-demo-event-quoted" }, update: {}, create: { id: "seed-demo-event-quoted", jobId: quoted.id, status: "quoted", note: "Sample repair quote; no payment has been made." } });

  const history = [
    { key: "battery", tech: 0, type: "phone", brand: "Xiaomi", model: "Redmi Note 9", repair: "Battery replacement", partsCents: 2200, rating: 5, days: 21 },
    { key: "port", tech: 4, type: "tablet", brand: "Apple", model: "iPad Air", repair: "Charging port replacement", partsCents: 1500, rating: 5, days: 12 },
    { key: "screen", tech: 0, type: "phone", brand: "Samsung", model: "Galaxy A52", repair: "Screen replacement", partsCents: 3900, rating: 4, days: 5 },
    { key: "tablet", tech: 0, type: "tablet", brand: "Lenovo", model: "Tab M10", repair: "Display connector replacement", partsCents: 2000, rating: 5, days: 2 },
  ];
  for (const h of history) {
    const when = daysAgo(h.days);
    const deviceId = `seed-demo-history-${h.key}`;
    const diagnosis = applySafetyGate({ ...GENERIC_FIXTURE, summary: `Sample historical diagnosis: ${h.repair.toLowerCase()} required.`, estimated_parts: [{ name: h.repair, price_usd: h.partsCents / 100 }] }, h.type);
    await db.device.upsert({ where: { id: deviceId }, update: {}, create: {
      id: deviceId, ownerId: owner.id, type: h.type, brand: h.brand, model: h.model, ageYears: 3,
      problem: `Sample data: ${h.repair.toLowerCase()}, completed and tested.`, diagnosisJson: JSON.stringify(diagnosis), diagnosisSource: "fixture", createdAt: when,
    } });
    const itemised = buildQuote({ deviceType: h.type, parts: diagnosis.estimated_parts, laborHours: 1, pickup: false, technicians: techs, technicianId: techs[h.tech].id });
    const job = await db.job.upsert({ where: { id: `seed-demo-job-${h.key}` }, update: {}, create: {
      id: `seed-demo-job-${h.key}`, deviceId, technicianId: itemised.technicianId, status: "payout_released",
      diagnosisJson: JSON.stringify(diagnosis), quoteJson: JSON.stringify(itemised),
      partsCents: itemised.partsCents, laborCents: itemised.laborCents, totalCents: itemised.totalCents,
      platformFeeCents: itemised.platformFeeCents, payoutCents: itemised.technicianPayoutCents,
      paypalOrderId: `SIM-SEED-ORDER-${h.key}`, paypalAuthId: `SIM-SEED-AUTH-${h.key}`, authorizedAt: when,
      paypalCaptureId: `SIM-SEED-CAPTURE-${h.key}`, payoutBatchId: `SIM-SEED-BATCH-${h.key}`,
      payoutStatus: "SUCCESS", payoutMode: "simulated", authSimulated: true,
      payoutNote: "Sample history only; no PayPal payment or payout occurred.",
      proofPhotoPath: "/tour/sample-proof.png", proofNotes: `Sample data: ${h.repair} completed and tested.`, customerRating: h.rating, createdAt: when,
    } });
    for (const status of LIFECYCLE) await db.jobEvent.upsert({ where: { id: `seed-demo-event-${h.key}-${status}` }, update: {}, create: {
      id: `seed-demo-event-${h.key}-${status}`, jobId: job.id, status, note: "Sample history; no PayPal call.", createdAt: when,
    } });
    if (job.status === "payout_released" && job.paypalCaptureId && job.payoutBatchId) {
      await db.verifiedRepair.upsert({ where: { jobId: job.id }, update: {}, create: {
        jobId: job.id, technicianId: techs[h.tech].id, deviceType: h.type, repairType: h.repair, rating: h.rating, payoutRef: job.payoutBatchId, completedAt: when,
      } });
      const impact = computeImpact(h.type, "repair");
      await db.impactEvent.upsert({ where: { deviceId }, update: {}, create: { deviceId, deviceType: h.type, outcome: "repair", ...impact, demo: true, createdAt: when } });
    }
  }
  for (const [index, amountCents] of [2500, 1000, 5000].entries()) await db.donation.upsert({
    where: { id: `seed-demo-donation-${index}` }, update: {}, create: {
      id: `seed-demo-donation-${index}`, donorName: ["Sam Okafor", "Maria Lindqvist", "Anonymous"][index], message: "Sample donation; no money moved.",
      amountCents, paypalOrderId: `SIM-SEED-DON-${index}`, paypalCaptureId: `SIM-SEED-DONCAP-${index}`, status: "completed", simulated: true,
      capturedAt: daysAgo(6 - index * 2), createdAt: daysAgo(6 - index * 2),
    },
  });
}
