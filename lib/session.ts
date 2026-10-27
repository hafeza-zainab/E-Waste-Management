import { cookies } from "next/headers";
import { db } from "@/lib/db";

// Minimal demo session: a role cookie (+ which technician you are acting as).
// This is deliberately NOT authentication. See DECISIONS.md.
export type Role = "owner" | "technician";
export const ROLE_COOKIE = "reloop_role";
export const TECH_COOKIE = "reloop_tech";

export async function getSession() {
  const jar = await cookies();
  const role: Role = jar.get(ROLE_COOKIE)?.value === "technician" ? "technician" : "owner";
  const techId = jar.get(TECH_COOKIE)?.value;
  return { role, techId };
}

export async function getDemoOwner() {
  return db.owner.findFirstOrThrow({ orderBy: { id: "asc" } });
}

export async function getCurrentTechnician() {
  const { techId } = await getSession();
  if (techId) {
    const t = await db.technician.findUnique({ where: { id: techId } });
    if (t) return t;
  }
  return db.technician.findFirstOrThrow({ orderBy: { name: "asc" } });
}
