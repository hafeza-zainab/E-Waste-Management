/*
  Warnings:

  - You are about to drop the `RecycleBooking` table. If the table is not empty, all the data it contains will be lost.
  - The required column `publicId` was added to the `Donation` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RecycleBooking";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "RecyclingPickup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "pickupDate" TEXT NOT NULL,
    "recycler" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "kgDiverted" REAL NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT true,
    "collectedAt" DATETIME,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Donation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "donorName" TEXT NOT NULL,
    "message" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "deviceId" TEXT,
    "capturedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Every pre-Phase-5 donation is seeded demo data: mark it completed + simulated, with a random public id.
INSERT INTO "new_Donation" ("amountCents", "createdAt", "deviceId", "donorName", "id", "paypalCaptureId", "paypalOrderId", "publicId", "status", "simulated", "capturedAt") SELECT "amountCents", "createdAt", "deviceId", "donorName", "id", "paypalCaptureId", "paypalOrderId", lower(hex(randomblob(16))), 'completed', true, "createdAt" FROM "Donation";
DROP TABLE "Donation";
ALTER TABLE "new_Donation" RENAME TO "Donation";
CREATE UNIQUE INDEX "Donation_publicId_key" ON "Donation"("publicId");
CREATE TABLE "new_ImpactEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT,
    "deviceType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ewasteKg" REAL NOT NULL,
    "co2eKg" REAL NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Pre-Phase-5 impact rows were all seeded demo data.
INSERT INTO "new_ImpactEvent" ("co2eKg", "createdAt", "deviceType", "ewasteKg", "id", "outcome", "demo") SELECT "co2eKg", "createdAt", "deviceType", "ewasteKg", "id", "outcome", true FROM "ImpactEvent";
DROP TABLE "ImpactEvent";
ALTER TABLE "new_ImpactEvent" RENAME TO "ImpactEvent";
CREATE UNIQUE INDEX "ImpactEvent_deviceId_key" ON "ImpactEvent"("deviceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RecyclingPickup_deviceId_key" ON "RecyclingPickup"("deviceId");
