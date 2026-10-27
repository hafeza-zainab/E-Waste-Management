-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("createdAt", "customerRating", "deviceId", "diagnosisJson", "id", "laborCents", "logisticsCents", "partsCents", "payoutBatchId", "payoutCents", "payoutMode", "payoutStatus", "paypalAuthId", "paypalCaptureId", "paypalOrderId", "platformFeeCents", "proofNotes", "proofPhotoPath", "quoteJson", "status", "technicianId", "totalCents", "updatedAt") SELECT "createdAt", "customerRating", "deviceId", "diagnosisJson", "id", "laborCents", "logisticsCents", "partsCents", "payoutBatchId", "payoutCents", "payoutMode", "payoutStatus", "paypalAuthId", "paypalCaptureId", "paypalOrderId", "platformFeeCents", "proofNotes", "proofPhotoPath", "quoteJson", "status", "technicianId", "totalCents", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
