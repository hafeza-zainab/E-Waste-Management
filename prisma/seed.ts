import { PrismaClient } from "@prisma/client";
import { computeImpact } from "../lib/impact/formulas";
import { splitPayout } from "../lib/jobs/money";

const db = new PrismaClient();

const TECHS = [
  { name: "Aisha Rahman", city: "Metro Central", skills: "phone,tablet", rating: 4.9, distanceKm: 2.1, hourlyCents: 1800, isTrainee: false, bio: "Screen and battery specialist, 8 years bench experience." },
  { name: "Diego Martins", city: "Metro Central", skills: "laptop,phone", rating: 4.7, distanceKm: 4.6, hourlyCents: 2200, isTrainee: false, bio: "Board-level laptop repair and data-safe upgrades." },
  { name: "Priya Nair", city: "Westside", skills: "phone", rating: 4.5, distanceKm: 1.2, hourlyCents: 1200, isTrainee: true, bio: "Polytechnic trainee, supervised phone screen swaps." },
  { name: "Tomasz Kowalski", city: "Eastside", skills: "tv,appliance", rating: 4.8, distanceKm: 7.9, hourlyCents: 2500, isTrainee: false, bio: "TV and small-appliance electronics, 15 years." },
  { name: "Lerato Dlamini", city: "Northgate", skills: "laptop,tablet,phone", rating: 4.6, distanceKm: 5.3, hourlyCents: 2000, isTrainee: false, bio: "Refurbisher for community donation programmes." },
  { name: "Kenji Watanabe", city: "Harbor", skills: "phone,laptop", rating: 4.3, distanceKm: 9.4, hourlyCents: 1500, isTrainee: true, bio: "Apprentice technician building a verified portfolio." },
];

const DEVICES = [
  { type: "phone", brand: "Samsung", model: "Galaxy A52", ageYears: 4, problem: "Screen cracked after a drop. Touch still works but the glass is splintering.", scenario: "cracked-screen" },
  { type: "laptop", brand: "Dell", model: "Inspiron 15", ageYears: 5, problem: "Laptop base is bulging and the trackpad clicks stiffly. Battery looks swollen.", scenario: "swollen-battery" },
  { type: "tv", brand: "Sony", model: "Bravia KDL-32", ageYears: 14, problem: "Old TV is completely dead, no standby light, no power.", scenario: "dead-tv" },
  { type: "phone", brand: "Xiaomi", model: "Redmi Note 9", ageYears: 3, problem: "Battery drains in two hours.", scenario: null },
  { type: "tablet", brand: "Apple", model: "iPad 6th gen", ageYears: 6, problem: "Charging port is loose and intermittently charges.", scenario: null },
];

const LIFECYCLE = ["quoted", "paid", "accepted", "in_progress", "completed", "customer_confirmed", "payout_released"];

async function main() {
  await db.$transaction([
    db.impactEvent.deleteMany(),
    db.recycleBooking.deleteMany(),
    db.donation.deleteMany(),
    db.verifiedRepair.deleteMany(),
    db.jobEvent.deleteMany(),
    db.job.deleteMany(),
    db.device.deleteMany(),
    db.technician.deleteMany(),
    db.owner.deleteMany(),
  ]);

  const owner = await db.owner.create({ data: { name: "Demo Owner", email: "owner@reloop.demo" } });

  const techs = [];
  for (const t of TECHS) {
    techs.push(
      await db.technician.create({
        data: { ...t, paypalEmail: `${t.name.split(" ")[0].toLowerCase()}@personal.example.com` },
      }),
    );
  }

  const devices = [];
  for (const d of DEVICES) devices.push(await db.device.create({ data: { ...d, ownerId: owner.id } }));

  // Three completed + paid-out historical jobs so profiles and the dashboard have data.
  const history = [
    { dev: 3, tech: 0, type: "phone", repair: "Battery replacement", partsCents: 2200, laborCents: 1800, rating: 5, daysAgo: 21 },
    { dev: 4, tech: 4, type: "tablet", repair: "Charging port replacement", partsCents: 1500, laborCents: 2000, rating: 5, daysAgo: 12 },
    { dev: 0, tech: 0, type: "phone", repair: "Screen replacement", partsCents: 3900, laborCents: 1800, rating: 4, daysAgo: 5 },
  ];
  for (const [i, h] of history.entries()) {
    const total = h.partsCents + h.laborCents;
    const split = splitPayout(total, 1000);
    const when = new Date(Date.now() - h.daysAgo * 86400000);
    const job = await db.job.create({
      data: {
        deviceId: devices[h.dev].id,
        technicianId: techs[h.tech].id,
        status: "payout_released",
        diagnosisJson: JSON.stringify({ seeded: true, repair: h.repair }),
        partsCents: h.partsCents,
        laborCents: h.laborCents,
        totalCents: total,
        platformFeeCents: split.platformFeeCents,
        payoutCents: split.technicianCents,
        paypalOrderId: `SEED-ORDER-${i + 1}`,
        paypalCaptureId: `SEED-CAPTURE-${i + 1}`,
        payoutBatchId: `SEED-BATCH-${i + 1}`,
        payoutStatus: "SUCCESS",
        payoutMode: "fallback_ledger",
        proofNotes: `${h.repair} completed and tested.`,
        customerRating: h.rating,
        createdAt: when,
        events: { create: LIFECYCLE.map((status) => ({ status, createdAt: when })) },
      },
    });
    await db.verifiedRepair.create({
      data: {
        jobId: job.id,
        technicianId: techs[h.tech].id,
        deviceType: h.type,
        repairType: h.repair,
        rating: h.rating,
        payoutRef: job.payoutBatchId,
        completedAt: when,
      },
    });
    const imp = computeImpact(h.type, "repair");
    await db.impactEvent.create({
      data: { deviceType: h.type, outcome: "repair", ewasteKg: imp.ewasteKg, co2eKg: imp.co2eKg, createdAt: when },
    });
  }

  await db.donation.createMany({
    data: [
      { donorName: "Sam Okafor", amountCents: 2500, paypalOrderId: "SEED-DON-1", paypalCaptureId: "SEED-DONCAP-1" },
      { donorName: "Maria Lindqvist", amountCents: 1000, paypalOrderId: "SEED-DON-2", paypalCaptureId: "SEED-DONCAP-2" },
      { donorName: "Anonymous", amountCents: 5000, paypalOrderId: "SEED-DON-3", paypalCaptureId: "SEED-DONCAP-3" },
    ],
  });

  console.log(`Seeded: ${techs.length} technicians, ${devices.length} devices, ${history.length} completed jobs, 3 donations.`);
}

main().finally(() => db.$disconnect());
