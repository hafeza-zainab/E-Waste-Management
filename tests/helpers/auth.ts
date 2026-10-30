import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { createSession } from "@/lib/auth/sessions";

/** Gives an existing Owner/Technician row a User and logs that user in on the jar. Returns the raw session token. */
export async function loginAs(jar: Map<string, string>, who: { ownerId: string } | { techId: string }, opts: { guest?: boolean } = {}) {
  const owner = "ownerId" in who ? await db.owner.findUniqueOrThrow({ where: { id: who.ownerId } }) : null;
  const tech = "techId" in who ? await db.technician.findUniqueOrThrow({ where: { id: who.techId } }) : null;
  const name = owner?.name ?? tech!.name;
  const user = await db.user.create({
    data: { email: `u-${Math.random().toString(36).slice(2)}@x.test`, name, passwordHash: "!", role: owner ? "owner" : "technician", isGuest: !!opts.guest },
  });
  if (owner) await db.owner.update({ where: { id: owner.id }, data: { userId: user.id } });
  else await db.technician.update({ where: { id: tech!.id }, data: { userId: user.id } });
  const token = await createSession(user.id);
  jar.set(SESSION_COOKIE, token);
  return token;
}
