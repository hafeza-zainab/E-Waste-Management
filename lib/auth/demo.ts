import type { PrismaClient } from "@prisma/client";
import { DEFAULT_DEMO_PASSWORD, DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL, DEMO_TECH_NAME, NO_PASSWORD } from "./constants";
import { hashPassword, verifyPassword } from "./password";

/**
 * Makes sure the two documented demo accounts can log in: the demo owner and the demo technician (Aisha Rahman).
 * Safe to run on every start and on a database migrated from Phase 1 to 7 (links existing rows, loses nothing).
 * Every other seeded technician keeps an account with an unusable password.
 */
export async function ensureDemoAccounts(db: PrismaClient, env: Record<string, string | undefined> = process.env) {
  const password = env.DEMO_ACCOUNT_PASSWORD || DEFAULT_DEMO_PASSWORD;
  const setPassword = async (userId: string, current: string) => {
    if (current === NO_PASSWORD || !(await verifyPassword(password, current))) await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  };

  const owner = await db.owner.findUnique({ where: { email: DEMO_OWNER_EMAIL } });
  if (owner) {
    const user = owner.userId
      ? await db.user.findUniqueOrThrow({ where: { id: owner.userId } })
      : await db.user.upsert({ where: { email: DEMO_OWNER_EMAIL }, update: {}, create: { email: DEMO_OWNER_EMAIL, name: owner.name, passwordHash: NO_PASSWORD, role: "owner" } });
    if (!owner.userId) await db.owner.update({ where: { id: owner.id }, data: { userId: user.id } });
    await db.user.update({ where: { id: user.id }, data: { isGuest: false } });
    await setPassword(user.id, user.passwordHash);
  }

  const tech = await db.technician.findFirst({ where: { user: { email: DEMO_TECH_EMAIL } } })
    ?? await db.technician.findFirst({ where: { name: DEMO_TECH_NAME, OR: [{ userId: null }, { user: { email: { endsWith: "@reloop.invalid" } } }] } });
  if (tech) {
    let user = tech.userId ? await db.user.findUnique({ where: { id: tech.userId } }) : null;
    if (!user) {
      user = await db.user.upsert({ where: { email: DEMO_TECH_EMAIL }, update: {}, create: { email: DEMO_TECH_EMAIL, name: tech.name, passwordHash: NO_PASSWORD, role: "technician" } });
      await db.technician.update({ where: { id: tech.id }, data: { userId: user.id } });
    } else if (user.email !== DEMO_TECH_EMAIL) {
      user = await db.user.update({ where: { id: user.id }, data: { email: DEMO_TECH_EMAIL } });
    }
    await db.user.update({ where: { id: user.id }, data: { isGuest: false } });
    await setPassword(user.id, user.passwordHash);
  }
}
