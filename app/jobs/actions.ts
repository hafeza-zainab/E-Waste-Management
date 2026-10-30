"use server";
import { acceptJob, cancelJob, completeJob, confirmRepair, declineJob, rateJob, reportProblem, retryPayout, simulateBuyerApproval, startJob, uploadProof } from "@/lib/jobs/lifecycle";
import { runAction } from "@/lib/jobs/run-action";
import { getPrincipal } from "@/lib/session";
import { assertRate } from "@/lib/security/rate-limit";
import { saveImageUpload } from "@/lib/uploads";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

// Every action derives the actor from the session and re-checks role, ownership and status inside lib/jobs/lifecycle.

export async function confirmAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => confirmRepair(id, await getPrincipal()), "Repair confirmed. Payment captured and the technician is being paid.");
}
export async function reportAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => reportProblem(id, await getPrincipal(), str(f, "problem")), "Problem reported. Your payment will not be captured until it is resolved.");
}
export async function cancelAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => cancelJob(id, await getPrincipal()), "Job cancelled. Any hold on your funds was released.");
}
export async function rateAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => rateJob(id, await getPrincipal(), Number(f.get("rating"))), "Thanks for rating.");
}
export async function retryPayoutAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => retryPayout(id, await getPrincipal()), "Payout retried.");
}
export async function simulateApprovalAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(`/jobs/${id}`, async () => simulateBuyerApproval(id, await getPrincipal()), "SIMULATED approval recorded (dev only).");
}

// Technician actions (also callable from /technician; the principal must be the assigned technician).
export async function acceptAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction("/technician", async () => acceptJob(id, await getPrincipal()), "Job accepted.");
}
export async function declineAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction("/technician", async () => declineJob(id, await getPrincipal()), "Job declined. The customer's hold was released.");
}
export async function startAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction("/technician", async () => startJob(id, await getPrincipal()), "Marked in progress.");
}
export async function completeAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(
    "/technician",
    async () => {
      const who = await getPrincipal();
      // Identity and state are checked inside completeJob; validate the photo first so a bad file is reported plainly.
      await assertRate("upload");
      const photo = await saveImageUpload(f.get("photo"));
      if (!photo) throw new Error("A proof photo is required.");
      return completeJob(id, who, { photoPath: photo.publicPath, notes: str(f, "notes") });
    },
    "Marked complete. Waiting for the owner to confirm.",
  );
}
export async function reuploadProofAction(f: FormData) {
  const id = str(f, "jobId");
  return runAction(
    "/technician",
    async () => {
      const who = await getPrincipal();
      await assertRate("upload");
      const photo = await saveImageUpload(f.get("photo"));
      if (!photo) throw new Error("A proof photo is required.");
      return uploadProof(id, who, { photoPath: photo.publicPath, notes: str(f, "notes") });
    },
    "New proof uploaded.",
  );
}
