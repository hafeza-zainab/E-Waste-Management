import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const prismaBin = path.join(root, "node_modules", "prisma", "build", "index.js");
const AUTH = readdirSync(path.join(root, "prisma", "migrations")).find((d) => d.endsWith("_auth"))!;
const tmp = mkdtempSync(path.join(tmpdir(), "reloop-mig-"));
afterAll(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the SQLite file; the OS temp folder is cleaned later */ } });

const deploy = (dbFile: string) =>
  execFileSync(process.execPath, [prismaBin, "migrate", "deploy", "--schema", path.join(tmp, "prisma", "schema.prisma")], { cwd: tmp, env: { ...process.env, DATABASE_URL: `file:${dbFile.replaceAll("\\", "/")}` }, stdio: "pipe" });

describe("auth migration on a database that already holds Phase 1 to 7 data", () => {
  it("keeps every row, links owners and technicians to accounts, and backfills agent run owners", async () => {
    // 1. Everything except the auth migration, i.e. the schema as of Phase 7.
    cpSync(path.join(root, "prisma"), path.join(tmp, "prisma"), { recursive: true, filter: (s) => !/(\.db|\.db-journal)$/.test(s) && !s.includes(AUTH) });
    const dbFile = path.join(tmp, "phase7.db");
    deploy(dbFile);

    // 2. Phase 7 data, written with raw SQL against the OLD tables.
    const db = new PrismaClient({ datasources: { db: { url: `file:${dbFile.replaceAll("\\", "/")}` } } });
    const run = (sql: string, ...args: unknown[]) => db.$executeRawUnsafe(sql, ...args);
    await run(`INSERT INTO "Owner" ("id","name","email") VALUES ('o1','Demo Owner','Owner@Reloop.Demo'), ('o2','Second Owner','second@x.test')`);
    await run(`INSERT INTO "Technician" ("id","name","city","bio","skills","rating","distanceKm","hourlyCents","paypalEmail","isTrainee") VALUES ('t1','Aisha Rahman','C','b','phone',4.9,2.1,1800,'a@p.example.com',0), ('t2','Diego Martins','C','b','laptop',4.7,4.6,2200,'d@p.example.com',0)`);
    await run(`INSERT INTO "Device" ("id","ownerId","type","brand","model","ageYears","problem","isTour","createdAt") VALUES ('d1','o1','phone','Samsung','A52',4,'cracked screen here',false,CURRENT_TIMESTAMP), ('d2','o2','tv','Sony','K',14,'dead tv no power',false,CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "Job" ("id","deviceId","technicianId","status","diagnosisJson","partsCents","laborCents","logisticsCents","totalCents","platformFeeCents","payoutCents","payoutAttempt","authSimulated","reauthCount","isTour","createdAt","updatedAt") VALUES ('j1','d1','t1','payout_released','{}',3900,1800,0,5700,570,5130,0,false,0,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "JobEvent" ("id","jobId","status","createdAt") VALUES ('e1','j1','payout_released',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "VerifiedRepair" ("id","jobId","technicianId","deviceType","repairType","rating","completedAt") VALUES ('v1','j1','t1','phone','Screen',5,CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "AgentRun" ("id","goal","mode","status","eventsJson","deviceId","jobId","isTour","createdAt") VALUES ('r1','fix it','scripted','finished','[]','d1','j1',false,CURRENT_TIMESTAMP), ('r2','no device','scripted','failed','[]',NULL,NULL,false,CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "Donation" ("id","publicId","donorName","amountCents","status","simulated","isTour","createdAt") VALUES ('n1','pub-1','Sam',2500,'completed',true,false,CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO "ImpactEvent" ("id","deviceId","deviceType","outcome","ewasteKg","co2eKg","demo","createdAt") VALUES ('i1','d1','phone','repair',0.2,10,true,CURRENT_TIMESTAMP)`);
    await db.$disconnect();

    // 3. Add the auth migration and deploy again, as a hosted instance does on its next release.
    cpSync(path.join(root, "prisma", "migrations", AUTH), path.join(tmp, "prisma", "migrations", AUTH), { recursive: true });
    deploy(dbFile);

    const after = new PrismaClient({ datasources: { db: { url: `file:${dbFile.replaceAll("\\", "/")}` } } });
    try {
      // Nothing lost, ids unchanged.
      expect(await after.owner.count()).toBe(2);
      expect(await after.technician.count()).toBe(2);
      expect(await after.device.count()).toBe(2);
      expect(await after.job.count()).toBe(1);
      expect(await after.jobEvent.count()).toBe(1);
      expect(await after.verifiedRepair.count()).toBe(1);
      expect(await after.agentRun.count()).toBe(2);
      expect(await after.donation.count()).toBe(1);
      expect(await after.impactEvent.count()).toBe(1);
      expect(await after.job.findUniqueOrThrow({ where: { id: "j1" } })).toMatchObject({ deviceId: "d1", technicianId: "t1", payoutCents: 5130 });
      expect(await after.device.findUniqueOrThrow({ where: { id: "d1" } })).toMatchObject({ ownerId: "o1", brand: "Samsung" });
      // Every owner and technician now has an account, with a normalised email and no usable password.
      const owners = await after.owner.findMany({ include: { user: true }, orderBy: { id: "asc" } });
      expect(owners.map((o) => o.user?.role)).toEqual(["owner", "owner"]);
      expect(owners[0].user).toMatchObject({ email: "owner@reloop.demo", name: "Demo Owner", passwordHash: "!", isGuest: false });
      const techs = await after.technician.findMany({ include: { user: true }, orderBy: { id: "asc" } });
      expect(techs.map((t) => t.user?.role)).toEqual(["technician", "technician"]);
      expect(techs.every((t) => t.user!.passwordHash === "!" && t.user!.email.endsWith("@reloop.invalid"))).toBe(true);
      expect(await after.user.count()).toBe(4);
      // Agent runs inherit their owner from their device; a run with no device stays unowned (and unreadable).
      expect((await after.agentRun.findUniqueOrThrow({ where: { id: "r1" } })).ownerId).toBe("o1");
      expect((await after.agentRun.findUniqueOrThrow({ where: { id: "r2" } })).ownerId).toBeNull();
      expect(await after.session.count()).toBe(0);
    } finally {
      await after.$disconnect();
    }
  }, 120_000);
});
