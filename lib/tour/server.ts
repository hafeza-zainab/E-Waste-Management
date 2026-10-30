import { unlink } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { uploadDir } from "@/lib/uploads";
import { TOUR_ROLE_COOKIE } from "@/lib/auth/constants";
import type { Principal } from "@/lib/jobs/permissions";
import { TOUR_COOKIE, TOUR_FLAG_COOKIE, TOUR_MAX_AGE_MS } from "./constants";

/** Tour routes only run on instances that opted into demo controls. Same switch as the recycler demo buttons. */
export const tourEnabled = () => process.env.DEMO_ACTIONS === "true";

/** The run, only if it exists and is younger than 2 hours. */
export async function getValidRun(id: string | null | undefined) {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const run = await db.tourRun.findUnique({ where: { id } });
  if (!run || Date.now() - run.createdAt.getTime() > TOUR_MAX_AGE_MS) return null;
  return run;
}

/** The tour run bound to this browser's cookie, or null. */
export async function currentTourRun() {
  if (!tourEnabled()) return null;
  try {
    return await getValidRun((await cookies()).get(TOUR_COOKIE)?.value);
  } catch {
    return null; // no request scope (e.g. a script)
  }
}

/** Tour records belong to this dedicated owner profile (no login): they never mix with any real account's data. */
export const TOUR_OWNER_EMAIL = "tour-visitor@reloop.invalid";
export const ensureTourOwner = () => db.owner.upsert({ where: { email: TOUR_OWNER_EMAIL }, update: {}, create: { name: "Tour visitor", email: TOUR_OWNER_EMAIL } });

export type TourOverlay = { runId: string; role: "owner" | "technician"; techId?: string };

/**
 * The tour-only identity. While a tour session is valid this browser acts as the tour owner, or as the technician
 * named in the `reloop_tour_role` cookie (bound to the run id). The visitor's real session cookie is never read here
 * and never touched: the overlay only ever reaches records tagged with this run.
 */
export async function getTourOverlay(): Promise<TourOverlay | null> {
  const run = await currentTourRun();
  if (!run) return null;
  const raw = (await cookies()).get(TOUR_ROLE_COOKIE)?.value ?? "";
  const [runId, role, techId] = raw.split(":");
  if (runId === run.id && role === "technician" && techId && /^[A-Za-z0-9_-]{1,40}$/.test(techId)) return { runId: run.id, role: "technician", techId };
  return { runId: run.id, role: "owner" };
}

export async function tourPrincipal(): Promise<Principal | null> {
  const o = await getTourOverlay();
  if (!o) return null;
  if (o.role === "technician") return { kind: "technician", techId: o.techId!, tourRunId: o.runId };
  return { kind: "owner", ownerId: (await ensureTourOwner()).id, tourRunId: o.runId };
}

export const currentTourRunId = async () => (await currentTourRun())?.id ?? null;

/** Prisma `where` that hides every other visitor's tour records. */
export const tourScope = (runId: string | null) => (runId ? { OR: [{ isTour: false }, { tourRunId: runId }] } : { isTour: false });

export class TourAccessError extends Error {
  constructor() {
    super("This job belongs to a guided demo session and can only be used from that session.");
    this.name = "TourAccessError";
  }
}

/**
 * Tour jobs move only inside their own tour session: a valid cookie bound to the job's tourRunId, and demo
 * actions enabled. Non-tour jobs pass untouched. Called by the lifecycle for every action.
 */
export async function assertTourJobAccess(job: { isTour: boolean; tourRunId: string | null }) {
  if (!job.isTour) return;
  const run = await currentTourRun();
  if (!run || run.id !== job.tourRunId) throw new TourAccessError();
}

export async function startTourRun() {
  await purgeStaleTours();
  return db.tourRun.create({ data: {} });
}

/** Deletes every record a tour run created, and the proof photos it uploaded. Idempotent. */
export async function cleanupTourRun(runId: string) {
  const jobs = await db.job.findMany({ where: { tourRunId: runId }, select: { id: true, proofPhotoPath: true } });
  const runs = await db.agentRun.findMany({ where: { tourRunId: runId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  const runIds = runs.map((r) => r.id);
  await db.$transaction([
    db.agentApproval.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { runId: { in: runIds } }] } }), // tokens cascade
    db.webhookEvent.deleteMany({ where: { jobId: { in: jobIds } } }),
    db.verifiedRepair.deleteMany({ where: { jobId: { in: jobIds } } }),
    db.job.deleteMany({ where: { tourRunId: runId } }), // events cascade
    db.agentRun.deleteMany({ where: { tourRunId: runId } }),
    db.device.deleteMany({ where: { tourRunId: runId } }),
    db.tourRun.deleteMany({ where: { id: runId } }),
  ]);
  for (const j of jobs) {
    const name = j.proofPhotoPath?.replace(/^\/uploads\//, "");
    if (name && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) await unlink(path.join(/*turbopackIgnore: true*/ uploadDir(), name)).catch(() => {});
  }
  return { jobs: jobIds.length, runs: runIds.length };
}

/** Runs whenever a new tour starts: removes expired runs and any tour record whose run no longer exists. */
export async function purgeStaleTours(now = Date.now()) {
  const old = await db.tourRun.findMany({ where: { createdAt: { lt: new Date(now - TOUR_MAX_AGE_MS) } }, select: { id: true } });
  for (const r of old) await cleanupTourRun(r.id);
  const live = (await db.tourRun.findMany({ select: { id: true } })).map((r) => r.id);
  const orphanIds = new Set<string>();
  const where = { isTour: true, NOT: { tourRunId: { in: live } } };
  for (const rows of await Promise.all([db.job.findMany({ where, select: { tourRunId: true } }), db.device.findMany({ where, select: { tourRunId: true } }), db.agentRun.findMany({ where, select: { tourRunId: true } })])) {
    rows.forEach((x) => orphanIds.add(x.tourRunId ?? ""));
  }
  for (const id of orphanIds) await cleanupTourRun(id);
  if (old.length || orphanIds.size) log.info("tour_purged", { expired: old.length, orphaned: orphanIds.size });
}

const opts = (maxAgeMs: number) => ({ path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: Math.floor(maxAgeMs / 1000) });
export const setTourCookies = (jar: Awaited<ReturnType<typeof cookies>>, runId: string) => {
  jar.set(TOUR_COOKIE, runId, { ...opts(TOUR_MAX_AGE_MS), httpOnly: true });
  jar.set(TOUR_FLAG_COOKIE, "1", { ...opts(TOUR_MAX_AGE_MS), httpOnly: false });
  jar.set(TOUR_ROLE_COOKIE, "", { ...opts(0), httpOnly: true });
};
export const setTourRole = (jar: Awaited<ReturnType<typeof cookies>>, runId: string, role: "owner" | "technician", techId?: string) =>
  jar.set(TOUR_ROLE_COOKIE, role === "technician" ? `${runId}:technician:${techId}` : `${runId}:owner`, { ...opts(TOUR_MAX_AGE_MS), httpOnly: true });
export const clearTourCookies = (jar: Awaited<ReturnType<typeof cookies>>) => {
  jar.set(TOUR_COOKIE, "", { ...opts(0), httpOnly: true });
  jar.set(TOUR_FLAG_COOKIE, "", { ...opts(0), httpOnly: false });
  jar.set(TOUR_ROLE_COOKIE, "", { ...opts(0), httpOnly: true });
};
