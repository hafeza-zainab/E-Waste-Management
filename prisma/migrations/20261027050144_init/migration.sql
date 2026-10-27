-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "skills" TEXT NOT NULL,
    "rating" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "paypalEmail" TEXT NOT NULL,
    "isTrainee" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ageYears" INTEGER NOT NULL,
    "problem" TEXT NOT NULL,
    "photoPath" TEXT,
    "scenario" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
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
    "proofPhotoPath" TEXT,
    "proofNotes" TEXT,
    "customerRating" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerifiedRepair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "repairType" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "payoutRef" TEXT,
    "completedAt" DATETIME NOT NULL,
    CONSTRAINT "VerifiedRepair_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VerifiedRepair_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "donorName" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "deviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RecycleBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "pickupDate" TEXT NOT NULL,
    "recycler" TEXT NOT NULL,
    "kgDiverted" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImpactEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ewasteKg" REAL NOT NULL,
    "co2eKg" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedRepair_jobId_key" ON "VerifiedRepair"("jobId");
