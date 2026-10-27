import { z } from "zod";
import { db } from "@/lib/db";
import { DiagnosisSchema } from "@/lib/ai/schemas";
import { DEMO_RECYCLER } from "@/lib/impact/constants";
import { computeImpact } from "@/lib/impact/formulas";

/**
 * Demo-only controls (no real recycler exists). Explicit opt-in via DEMO_ACTIONS=true so the hosted demo
 * can advance a pickup, instead of tying it to NODE_ENV.
 */
export const demoActionsEnabled = () => process.env.DEMO_ACTIONS === "true";

export const PICKUP_STATUSES = ["booked", "collected", "processed"] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const nextPickupStatus = (s: string): PickupStatus | null => {
  const i = PICKUP_STATUSES.indexOf(s as PickupStatus);
  return i >= 0 ? (PICKUP_STATUSES[i + 1] ?? null) : null;
};

const MAX_DAYS_AHEAD = 60;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const PickupInputSchema = z.object({
  deviceId: z.string().min(1).max(40),
  address: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim())
    .pipe(z.string().min(8, "Please enter the full pickup address (at least 8 characters).").max(200, "Address is too long (200 characters).")),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pickup date."),
});

export function validatePickupDate(date: string, today = new Date()): string | null {
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "Choose a valid pickup date.";
  if (date < iso(today)) return "The pickup date can't be in the past.";
  if (date > iso(new Date(+today + MAX_DAYS_AHEAD * 86_400_000))) return `Pick a date within the next ${MAX_DAYS_AHEAD} days.`;
  return null;
}

export class PickupError extends Error {}

/** One pickup per device. Only devices whose diagnosis recommends recycling can be booked. No payment involved. */
export async function bookPickup(raw: unknown) {
  const p = PickupInputSchema.safeParse(raw);
  if (!p.success) throw new PickupError(p.error.issues[0]?.message ?? "Please check the form.");
  const dateError = validatePickupDate(p.data.pickupDate);
  if (dateError) throw new PickupError(dateError);

  const device = await db.device.findUnique({ where: { id: p.data.deviceId } });
  if (!device?.diagnosisJson) throw new PickupError("Device not found.");
  if (DiagnosisSchema.parse(JSON.parse(device.diagnosisJson)).recommended_path !== "recycle") throw new PickupError("Recycling pickup is only offered when recycling is the recommended path.");
  const existing = await db.recyclingPickup.findUnique({ where: { deviceId: device.id } });
  if (existing) return existing;
  return db.recyclingPickup.create({
    data: { deviceId: device.id, address: p.data.address, pickupDate: p.data.pickupDate, recycler: DEMO_RECYCLER, kgDiverted: computeImpact(device.type, "recycle").ewasteKg },
  });
}

/** Demo-only advance (booked -> collected -> processed). Processing records the impact once per device. */
export async function advancePickup(deviceId: string) {
  if (!demoActionsEnabled()) throw new PickupError("Not available.");
  const pickup = await db.recyclingPickup.findUnique({ where: { deviceId } });
  if (!pickup) throw new PickupError("No pickup booked.");
  const next = nextPickupStatus(pickup.status);
  if (!next) throw new PickupError("This pickup is already processed.");
  const moved = await db.recyclingPickup.updateMany({
    where: { id: pickup.id, status: pickup.status },
    data: next === "collected" ? { status: next, collectedAt: new Date() } : { status: next, processedAt: new Date() },
  });
  if (moved.count && next === "processed") {
    const device = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
    const impact = computeImpact(device.type, "recycle");
    await db.impactEvent.upsert({
      where: { deviceId },
      update: {},
      create: { deviceId, deviceType: device.type, outcome: "recycle", ewasteKg: impact.ewasteKg, co2eKg: impact.co2eKg, demo: true },
    });
  }
  return next;
}
