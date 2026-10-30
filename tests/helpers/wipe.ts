import { db } from "@/lib/db";

/** Empties every table in foreign-key order, so a test file starts from nothing whatever ran before it. */
export const wipeAll = () =>
  db.$transaction([
    db.approvalToken.deleteMany(), db.agentApproval.deleteMany(), db.agentRun.deleteMany(), db.webhookEvent.deleteMany(), db.impactEvent.deleteMany(),
    db.recyclingPickup.deleteMany(), db.donation.deleteMany(), db.verifiedRepair.deleteMany(), db.jobEvent.deleteMany(), db.job.deleteMany(), db.device.deleteMany(),
    db.tourRun.deleteMany(), db.technician.deleteMany(), db.owner.deleteMany(), db.session.deleteMany(), db.user.deleteMany(),
  ]);
