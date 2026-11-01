import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "./demo-data";

const db = new PrismaClient();

async function main() {
  // Destructive reset remains an explicit local command, never an environment
  // flag accidentally left enabled for an automatic production restart.
  if (process.argv.includes("--reset")) await db.$transaction([
    db.impactEvent.deleteMany(), db.approvalToken.deleteMany(), db.agentApproval.deleteMany(),
    db.agentRun.deleteMany(), db.recyclingPickup.deleteMany(), db.donation.deleteMany(),
    db.verifiedRepair.deleteMany(), db.jobEvent.deleteMany(), db.job.deleteMany(),
    db.device.deleteMany(), db.technician.deleteMany(), db.owner.deleteMany(),
    db.session.deleteMany(), db.user.deleteMany(),
  ]);
  await seedDemoData(db);
  console.log("Demo seed ready: sample diagnoses, safety block, quote, four completed repairs and three donations. Existing rows preserved.");
}

main().catch(() => {
  console.error("Demo seed failed. Check database migrations and connectivity; the server has not started.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
