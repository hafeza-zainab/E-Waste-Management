import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth/sessions";
import type { Principal } from "@/lib/jobs/permissions";
import { getTourOverlay, tourPrincipal } from "@/lib/tour/server";

export type Role = "owner" | "technician";

export class AuthError extends Error {
  constructor(message = "Please log in to continue.") {
    super(message);
    this.name = "AuthError";
  }
}

export function principalForUser(user: SessionUser): Principal | null {
  if (user.role === "technician") return user.technician ? { kind: "technician", techId: user.technician.id } : null;
  return user.owner ? { kind: "owner", ownerId: user.owner.id } : null;
}

/**
 * Who is acting. While a guided-demo session is valid the tour identity overlay wins and the visitor's real
 * session is not consulted at all; otherwise it is the logged-in user. Identity never comes from request bodies.
 */
export async function getPrincipalOrNull(): Promise<Principal | null> {
  const tour = await tourPrincipal();
  if (tour) return tour;
  const user = await getSessionUser();
  return user ? principalForUser(user) : null;
}

export async function getPrincipal(): Promise<Principal> {
  const p = await getPrincipalOrNull();
  if (!p) throw new AuthError();
  return p;
}

export interface Viewer {
  user: SessionUser | null;
  tour: { role: Role } | null;
  principal: Principal | null;
}

/** For the header and pages: the tour overlay hides the real account while a tour runs. */
export async function getViewer(): Promise<Viewer> {
  const overlay = await getTourOverlay();
  if (overlay) return { user: null, tour: { role: overlay.role }, principal: await tourPrincipal() };
  const user = await getSessionUser();
  return { user, tour: null, principal: user ? principalForUser(user) : null };
}

/** Page guard: redirects to /login (keeping `next`) when logged out, and to the user's own home for the other role. */
export async function requirePrincipal<K extends Role>(kind: K, next: string): Promise<Extract<Principal, { kind: K }>> {
  const p = await getPrincipalOrNull();
  if (!p) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (p.kind !== kind) redirect(p.kind === "technician" ? "/technician" : "/owner");
  return p as Extract<Principal, { kind: K }>;
}

/** Page guard for pages both roles may open (the job page); per-record access is checked by the page itself. */
export async function requirePrincipalAny(next: string): Promise<Principal> {
  const p = await getPrincipalOrNull();
  if (!p) redirect(`/login?next=${encodeURIComponent(next)}`);
  return p;
}
