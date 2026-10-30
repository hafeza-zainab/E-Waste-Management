import { db } from "@/lib/db";
import { tourBoundaryOk, type Principal } from "@/lib/jobs/permissions";

type Tagged = { isTour: boolean; tourRunId: string | null };

export const ownsDevice = (who: Principal, d: Tagged & { ownerId: string }) => who.kind === "owner" && who.ownerId === d.ownerId && tourBoundaryOk(who, d);

/** The device, only when it belongs to this owner (and, for the tour identity, to its own tour run). Otherwise null. */
export async function loadOwnedDevice(who: Principal, id: string) {
  const d = await db.device.findUnique({ where: { id } });
  return d && ownsDevice(who, d) ? d : null;
}

type JobFacts = Tagged & { technicianId: string | null; status: string; device: { ownerId: string } };

/** Owners see their own jobs; a technician sees jobs assigned to them once paid (not mere quotes). */
export function canViewJob(who: Principal, j: JobFacts): boolean {
  if (!tourBoundaryOk(who, j)) return false;
  if (who.kind === "owner") return who.ownerId === j.device.ownerId;
  return !!j.technicianId && who.techId === j.technicianId && j.status !== "quoted";
}

/** Owner of the job's device only (payment, quote and approval routes). */
export const isJobOwner = (who: Principal, j: Tagged & { device: { ownerId: string } }) => who.kind === "owner" && who.ownerId === j.device.ownerId && tourBoundaryOk(who, j);

/** Uploaded photos are served only to the owner of the device/job they belong to and to the technician assigned to it. */
export async function canReadUpload(who: Principal, name: string): Promise<boolean> {
  const publicPath = `/uploads/${name}`;
  const devices = await db.device.findMany({ where: { photoPath: publicPath }, select: { ownerId: true, isTour: true, tourRunId: true } });
  if (devices.some((d) => who.kind === "owner" && who.ownerId === d.ownerId && tourBoundaryOk(who, d))) return true;
  const jobs = await db.job.findMany({ where: { proofPhotoPath: publicPath }, include: { device: { select: { ownerId: true } } } });
  return jobs.some((j) => canViewJob(who, { ...j, status: j.status }) || (who.kind === "technician" && who.techId === j.technicianId && tourBoundaryOk(who, j)));
}
