-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    CONSTRAINT "Owner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Owner" ("email", "id", "name") SELECT "email", "id", "name" FROM "Owner";
DROP TABLE "Owner";
ALTER TABLE "new_Owner" RENAME TO "Owner";
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");
CREATE UNIQUE INDEX "Owner_userId_key" ON "Owner"("userId");
CREATE TABLE "new_Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "skills" TEXT NOT NULL,
    "rating" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "paypalEmail" TEXT NOT NULL,
    "isTrainee" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    CONSTRAINT "Technician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Technician" ("bio", "city", "distanceKm", "hourlyCents", "id", "isTrainee", "name", "paypalEmail", "rating", "skills") SELECT "bio", "city", "distanceKm", "hourlyCents", "id", "isTrainee", "name", "paypalEmail", "rating", "skills" FROM "Technician";
DROP TABLE "Technician";
ALTER TABLE "new_Technician" RENAME TO "Technician";
CREATE UNIQUE INDEX "Technician_userId_key" ON "Technician"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");


-- Non-destructive link of existing (Phase 1 to 7) data to accounts. Nothing is deleted or rewritten:
-- every Owner and Technician row keeps its id, so devices, jobs, repairs and approvals still point at them.
-- "!" is not a valid password hash, so these accounts cannot be logged into until a password is set
-- (prisma/seed.ts sets the documented demo passwords for the demo owner and demo technician only).
INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "isGuest", "createdAt")
  SELECT 'usr_' || "id", lower(trim("email")), "name", '!', 'owner', false, CURRENT_TIMESTAMP FROM "Owner";
UPDATE "Owner" SET "userId" = 'usr_' || "id";

INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "isGuest", "createdAt")
  SELECT 'usr_' || "id", 'tech-' || lower("id") || '@reloop.invalid', "name", '!', 'technician', false, CURRENT_TIMESTAMP FROM "Technician";
UPDATE "Technician" SET "userId" = 'usr_' || "id";

-- Agent runs remember their owner so /agent?run= can be restricted to it. Existing runs inherit it from their device.
ALTER TABLE "AgentRun" ADD COLUMN "ownerId" TEXT;
UPDATE "AgentRun" SET "ownerId" = (SELECT "ownerId" FROM "Device" WHERE "Device"."id" = "AgentRun"."deviceId");
