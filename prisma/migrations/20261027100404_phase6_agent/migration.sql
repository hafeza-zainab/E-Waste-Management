-- AlterTable
ALTER TABLE "Job" ADD COLUMN "agentRunId" TEXT;

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "models" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goal" TEXT NOT NULL,
    "budgetCents" INTEGER,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "deviceId" TEXT,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "itemsHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "userApprovedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalToken_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AgentApproval" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");

-- Reference data: seeded parts catalogue (same ids as lib/agent/parts-data.ts)
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-a52-screen-oem','Display assembly, OEM (Galaxy A52)','phone','galaxy a52','oem',5400,3);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-a52-screen-compat','Display assembly, compatible aftermarket (Galaxy A52)','phone','galaxy a52','compatible',3400,8);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-a52-battery','Battery, compatible (Galaxy A52)','phone','galaxy a52','compatible',2200,6);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-inspiron15-battery-oem','Battery pack, OEM (Inspiron 15)','laptop','inspiron 15','oem',4500,2);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-bravia-psu','Power supply board (Bravia KDL-32)','tv','bravia kdl-32','oem',3800,0);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-phone-usbc-flex','USB-C charging port flex, universal','phone','*','generic',1200,20);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-phone-screen-protector','Tempered glass protector, universal','phone','*','generic',600,50);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-laptop-ssd','SSD 256 GB, universal 2.5 inch','laptop','*','generic',2800,9);
INSERT INTO "Part" ("id","name","deviceType","models","quality","priceCents","stock") VALUES ('part-tablet-battery','Tablet battery, universal','tablet','*','generic',2400,7);
