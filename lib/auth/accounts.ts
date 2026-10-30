import { randomBytes, randomInt } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { uploadDir } from "@/lib/uploads";
import { GUEST_TTL_MS, NO_PASSWORD } from "./constants";
import { hashPassword, verifyPassword } from "./password";
import type { SignupInput } from "./validation";

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists. Log in instead.");
    this.name = "EmailTakenError";
  }
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Creates the User and its Owner or Technician profile in ONE transaction: no half-made accounts. */
export async function createAccount(input: SignupInput) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, role: input.role } });
      if (input.role === "owner") {
        await tx.owner.create({ data: { name: input.name, email: input.email, userId: user.id } });
      } else {
        await tx.technician.create({
          data: {
            userId: user.id,
            name: input.name,
            city: input.area,
            bio: "New technician on ReLoop.",
            skills: input.skills.join(","),
            rating: 0,
            distanceKm: 5,
            hourlyCents: 1500,
            paypalEmail: input.payoutEmail,
          },
        });
      }
      return user;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new EmailTakenError();
    throw e;
  }
}

/** The user when the credentials are right, else null. Costs the same whether or not the email exists. */
export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash);
  return ok && user && !user.isGuest ? user : null;
}

/** A real, short-lived user with the owner role. Purges expired guests first. */
export async function createGuest() {
  await purgeExpiredGuests();
  const name = `Guest ${randomInt(1000, 10000)}`;
  const email = `guest-${randomBytes(8).toString("hex")}@guest.invalid`;
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name, passwordHash: NO_PASSWORD, role: "owner", isGuest: true } });
    await tx.owner.create({ data: { name, email, userId: user.id } });
    return user;
  });
}

/** Deletes guests older than 24 hours together with everything they own (sessions cascade). Idempotent. */
export async function purgeExpiredGuests(now = Date.now()) {
  const guests = await db.user.findMany({ where: { isGuest: true, createdAt: { lt: new Date(now - GUEST_TTL_MS) } }, include: { owner: true } });
  for (const g of guests) await deleteOwnerData(g.id, g.owner?.id ?? null);
  return guests.length;
}

async function deleteOwnerData(userId: string, ownerId: string | null) {
  const devices = ownerId ? await db.device.findMany({ where: { ownerId }, select: { id: true } }) : [];
  const deviceIds = devices.map((d) => d.id);
  const jobs = await db.job.findMany({ where: { deviceId: { in: deviceIds } }, select: { id: true, proofPhotoPath: true } });
  const jobIds = jobs.map((j) => j.id);
  const runs = ownerId ? await db.agentRun.findMany({ where: { OR: [{ ownerId }, { deviceId: { in: deviceIds } }] }, select: { id: true } }) : [];
  const runIds = runs.map((r) => r.id);
  await db.$transaction([
    db.agentApproval.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { runId: { in: runIds } }] } }),
    db.webhookEvent.deleteMany({ where: { jobId: { in: jobIds } } }),
    db.verifiedRepair.deleteMany({ where: { jobId: { in: jobIds } } }),
    db.job.deleteMany({ where: { id: { in: jobIds } } }),
    db.agentRun.deleteMany({ where: { id: { in: runIds } } }),
    db.recyclingPickup.deleteMany({ where: { deviceId: { in: deviceIds } } }),
    db.impactEvent.deleteMany({ where: { deviceId: { in: deviceIds } } }),
    db.donation.deleteMany({ where: { deviceId: { in: deviceIds } } }),
    db.device.deleteMany({ where: { id: { in: deviceIds } } }),
    ...(ownerId ? [db.owner.deleteMany({ where: { id: ownerId } })] : []),
    db.user.deleteMany({ where: { id: userId } }), // sessions cascade
  ]);
  for (const j of jobs) {
    const name = j.proofPhotoPath?.replace(/^\/uploads\//, "");
    if (name && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) await unlink(path.join(/*turbopackIgnore: true*/ uploadDir(), name)).catch(() => {});
  }
}
