-- CreateTable
CREATE TABLE "TourRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goal" TEXT NOT NULL,
    "budgetCents" INTEGER,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "deviceId" TEXT,
    "jobId" TEXT,
    "isTour" BOOLEAN NOT NULL DEFAULT false,
    "tourRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AgentRun" ("budgetCents", "createdAt", "deviceId", "eventsJson", "goal", "id", "jobId", "mode", "status") SELECT "budgetCents", "createdAt", "deviceId", "eventsJson", "goal", "id", "jobId", "mode", "status" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ageYears" INTEGER NOT NULL,
    "problem" TEXT NOT NULL,
    "photoPath" TEXT,
    "scenario" TEXT,
    "diagnosisJson" TEXT,
    "diagnosisSource" TEXT,
    "guideJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isTour" BOOLEAN NOT NULL DEFAULT false,
    "tourRunId" TEXT,
    CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("ageYears", "brand", "createdAt", "diagnosisJson", "diagnosisSource", "guideJson", "id", "model", "ownerId", "photoPath", "problem", "scenario", "type") SELECT "ageYears", "brand", "createdAt", "diagnosisJson", "diagnosisSource", "guideJson", "id", "model", "ownerId", "photoPath", "problem", "scenario", "type" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
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
    "isTour" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Donation" ("amountCents", "capturedAt", "createdAt", "deviceId", "donorName", "id", "message", "paypalCaptureId", "paypalOrderId", "publicId", "simulated", "status") SELECT "amountCents", "capturedAt", "createdAt", "deviceId", "donorName", "id", "message", "paypalCaptureId", "paypalOrderId", "publicId", "simulated", "status" FROM "Donation";
DROP TABLE "Donation";
ALTER TABLE "new_Donation" RENAME TO "Donation";
CREATE UNIQUE INDEX "Donation_publicId_key" ON "Donation"("publicId");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "technicianId" TEXT,
    "status" TEXT NOT NULL,
    "diagnosisJson" TEXT NOT NULL,
    "quoteJson" TEXT,
    "partsCents" INTEGER NOT NULL DEFAULT 0,
    "laborCents" INTEGER NOT NULL DEFAULT 0,
    "logisticsCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "payoutCents" INTEGER NOT NULL DEFAULT 0,
    "paypalOrderId" TEXT,
    "paypalAuthId" TEXT,
    "paypalCaptureId" TEXT,
    "payoutBatchId" TEXT,
    "payoutStatus" TEXT,
    "payoutMode" TEXT,
    "payoutItemId" TEXT,
    "payoutNote" TEXT,
    "payoutError" TEXT,
    "payoutAttempt" INTEGER NOT NULL DEFAULT 0,
    "authSimulated" BOOLEAN NOT NULL DEFAULT false,
    "authorizedAt" DATETIME,
    "reauthCount" INTEGER NOT NULL DEFAULT 0,
    "problemReport" TEXT,
    "proofPhotoPath" TEXT,
    "proofNotes" TEXT,
    "customerRating" INTEGER,
    "agentRunId" TEXT,
    "isTour" BOOLEAN NOT NULL DEFAULT false,
    "tourRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("agentRunId", "authSimulated", "authorizedAt", "createdAt", "customerRating", "deviceId", "diagnosisJson", "id", "laborCents", "logisticsCents", "partsCents", "payoutAttempt", "payoutBatchId", "payoutCents", "payoutError", "payoutItemId", "payoutMode", "payoutNote", "payoutStatus", "paypalAuthId", "paypalCaptureId", "paypalOrderId", "platformFeeCents", "problemReport", "proofNotes", "proofPhotoPath", "quoteJson", "reauthCount", "status", "technicianId", "totalCents", "updatedAt") SELECT "agentRunId", "authSimulated", "authorizedAt", "createdAt", "customerRating", "deviceId", "diagnosisJson", "id", "laborCents", "logisticsCents", "partsCents", "payoutAttempt", "payoutBatchId", "payoutCents", "payoutError", "payoutItemId", "payoutMode", "payoutNote", "payoutStatus", "paypalAuthId", "paypalCaptureId", "paypalOrderId", "platformFeeCents", "problemReport", "proofNotes", "proofPhotoPath", "quoteJson", "reauthCount", "status", "technicianId", "totalCents", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
