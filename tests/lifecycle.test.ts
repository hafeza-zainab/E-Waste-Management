import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalError } from "@/lib/paypal/client";

vi.mock("@/lib/paypal/gateway", async (orig) => ({
  ...(await orig<typeof import("@/lib/paypal/gateway")>()),
  captureAuthorization: vi.fn(),
  reauthorizeAuthorization: vi.fn(),
  voidAuthorization: vi.fn(),
  createPayout: vi.fn(),
}));

import { db } from "@/lib/db";
import * as pp from "@/lib/paypal/gateway";
import { acceptJob, cancelJob, completeJob, confirmRepair, declineJob, releasePayout, reportProblem, retryPayout, simulateBuyerApproval, startJob, uploadProof } from "@/lib/jobs/lifecycle";
import { ActionError, type Principal } from "@/lib/jobs/permissions";
import { processWebhookEvent } from "@/lib/paypal/webhook-handler";

const cap = vi.mocked(pp.captureAuthorization);
const reauth = vi.mocked(pp.reauthorizeAuthorization);
const payout = vi.mocked(pp.createPayout);
const voidAuth = vi.mocked(pp.voidAuthorization);

const owner: Principal = { kind: "owner", ownerId: "o1" };
const tech: Principal = { kind: "technician", techId: "t1" };
const otherTech: Principal = { kind: "technician", techId: "t2" };
const DAY = 86_400_000;

async function reset() {
  await db.$transaction([db.webhookEvent.deleteMany(), db.verifiedRepair.deleteMany(), db.jobEvent.deleteMany(), db.job.deleteMany(), db.device.deleteMany(), db.technician.deleteMany(), db.owner.deleteMany()]);
  await db.owner.create({ data: { id: "o1", name: "Owner", email: "o@x.test" } });
  for (const id of ["t1", "t2"])
    await db.technician.create({ data: { id, name: `Tech ${id}`, city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1000, paypalEmail: `${id}@personal.example.com` } });
  await db.device.create({ data: { id: "d1", ownerId: "o1", type: "phone", brand: "Samsung", model: "A52", ageYears: 1, problem: "cracked screen here" } });
}

async function makeJob(status: string, extra: Record<string, unknown> = {}, totalCents = 3333) {
  const fee = Math.floor((totalCents * 1000 + 5000) / 10000);
  return db.job.create({
    data: {
      deviceId: "d1", technicianId: "t1", status, diagnosisJson: JSON.stringify({ estimated_parts: [{ name: "Screen" }] }),
      totalCents, platformFeeCents: fee, payoutCents: totalCents - fee, paypalOrderId: "ORD-1", paypalAuthId: "AUTH-1", authorizedAt: new Date(), ...extra,
    },
  });
}
const get = (id: string) => db.job.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  vi.resetAllMocks();
  await reset();
  cap.mockResolvedValue({ captureId: "CAP-1", status: "COMPLETED" });
  reauth.mockResolvedValue({ authorizationId: "AUTH-2" });
  payout.mockResolvedValue({ mode: "paypal_sandbox", batchId: "BATCH-1", itemId: "ITEM-1", status: "PENDING", note: null });
});

describe("technician flow and role enforcement", () => {
  it("runs paid -> accepted -> in_progress -> completed with the assigned technician only", async () => {
    const j = await makeJob("paid");
    await expect(acceptJob(j.id, otherTech)).rejects.toThrow(ActionError);
    await expect(acceptJob(j.id, owner)).rejects.toThrow(ActionError);
    await acceptJob(j.id, tech);
    await expect(startJob(j.id, otherTech)).rejects.toThrow(ActionError);
    await startJob(j.id, tech);
    await expect(completeJob(j.id, tech, { photoPath: "", notes: "did the repair" })).rejects.toThrow(/photo/);
    await expect(completeJob(j.id, owner, { photoPath: "/uploads/a.jpg", notes: "did the repair" })).rejects.toThrow(ActionError);
    await completeJob(j.id, tech, { photoPath: "/uploads/a.jpg", notes: "did the repair" });
    const after = await get(j.id);
    expect(after.status).toBe("completed");
    expect(after.proofPhotoPath).toBe("/uploads/a.jpg");
  });
  it("cannot skip states", async () => {
    const j = await makeJob("paid");
    await expect(startJob(j.id, tech)).rejects.toThrow(/can't be done/);
    await expect(completeJob(j.id, tech, { photoPath: "/u.jpg", notes: "12345" })).rejects.toThrow(ActionError);
  });
  it("decline voids the hold and cancels; owner cancel is only possible before acceptance", async () => {
    const a = await makeJob("paid");
    await declineJob(a.id, tech);
    expect((await get(a.id)).status).toBe("cancelled");
    expect(voidAuth).toHaveBeenCalledWith("AUTH-1", a.id);
    const b = await makeJob("accepted");
    await expect(cancelJob(b.id, owner)).rejects.toThrow(ActionError);
    const c = await makeJob("paid");
    await cancelJob(c.id, owner);
    expect((await get(c.id)).status).toBe("cancelled");
  });
  it("keeps the job (and the hold) if voiding fails", async () => {
    const a = await makeJob("paid");
    voidAuth.mockRejectedValueOnce(new Error("boom"));
    await expect(cancelJob(a.id, owner)).rejects.toThrow("boom");
    expect((await get(a.id)).status).toBe("paid");
  });
});

describe("confirm -> capture -> payout", () => {
  it("only the owner can confirm; a technician (even the assigned one) cannot", async () => {
    const j = await makeJob("completed");
    await expect(confirmRepair(j.id, tech)).rejects.toThrow(ActionError);
    await expect(confirmRepair(j.id, { kind: "owner", ownerId: "someone-else" })).rejects.toThrow(ActionError);
    expect(cap).not.toHaveBeenCalled();
    expect((await get(j.id)).status).toBe("completed");
  });
  it("captures once, pays 90% in cents, stores ids, and writes the verified record once", async () => {
    const j = await makeJob("completed", {}, 3333);
    const r = await confirmRepair(j.id, owner);
    expect(r.ok).toBe(true);
    const after = await get(j.id);
    expect(after).toMatchObject({ status: "payout_released", paypalCaptureId: "CAP-1", payoutBatchId: "BATCH-1", payoutItemId: "ITEM-1", payoutMode: "paypal_sandbox" });
    expect(payout).toHaveBeenCalledWith(expect.objectContaining({ cents: 3000, captureId: "CAP-1", attempt: 0, email: "t1@personal.example.com" }));
    expect(await db.verifiedRepair.count({ where: { jobId: j.id } })).toBe(1);
    // replays change nothing
    await expect(confirmRepair(j.id, owner)).rejects.toThrow(ActionError);
    await releasePayout(j.id);
    expect(cap).toHaveBeenCalledTimes(1);
    expect(payout).toHaveBeenCalledTimes(1);
    expect(await db.verifiedRepair.count({ where: { jobId: j.id } })).toBe(1);
  });
  it("double-capture guard: a stored captureId is reused, never re-captured", async () => {
    const j = await makeJob("completed", { paypalCaptureId: "CAP-EXISTING" });
    await confirmRepair(j.id, owner);
    expect(cap).not.toHaveBeenCalled();
    expect((await get(j.id)).paypalCaptureId).toBe("CAP-EXISTING");
  });
  it("concurrent confirms capture with one request id and pay out with one batch id", async () => {
    const j = await makeJob("completed");
    await Promise.allSettled([confirmRepair(j.id, owner), confirmRepair(j.id, owner)]);
    for (const call of cap.mock.calls) expect(call[1]).toBe(j.id); // request id is derived from the job id inside the gateway
    expect(new Set(payout.mock.calls.map((c) => `${c[0].jobId}-${c[0].attempt}`)).size).toBe(1);
    expect((await get(j.id)).status).toBe("payout_released");
  });
  it("payout after capture failure never happens", async () => {
    const j = await makeJob("completed");
    cap.mockRejectedValueOnce(new PayPalError("declined", 422, "INSTRUMENT_DECLINED"));
    await expect(confirmRepair(j.id, owner)).rejects.toThrow(/could not capture/);
    expect(payout).not.toHaveBeenCalled();
    const after = await get(j.id);
    expect(after.status).toBe("completed");
    expect(after.paypalCaptureId).toBeNull();
    await expect(releasePayout(j.id)).rejects.toThrow(ActionError); // not confirmed -> no payout
    expect(payout).not.toHaveBeenCalled();
  });
  it("payout failure keeps the capture, goes to payout_failed, and Retry is idempotent", async () => {
    const j = await makeJob("completed");
    payout.mockRejectedValueOnce(new PayPalError("Insufficient funds", 422, "INSUFFICIENT_FUNDS", "dbg1"));
    const r = await confirmRepair(j.id, owner);
    expect(r.ok).toBe(false);
    let s = await get(j.id);
    expect(s).toMatchObject({ status: "payout_failed", paypalCaptureId: "CAP-1" });
    expect(s.payoutError).toMatch(/Insufficient/);
    await expect(retryPayout(j.id, otherTech)).rejects.toThrow(ActionError);
    expect((await retryPayout(j.id, tech)).ok).toBe(true);
    await expect(retryPayout(j.id, owner)).rejects.toThrow(ActionError); // already released: refused, nothing sent
    s = await get(j.id);
    expect(s).toMatchObject({ status: "payout_released", payoutError: null });
    expect(cap).toHaveBeenCalledTimes(1);
    expect(payout).toHaveBeenCalledTimes(2); // failed attempt + one successful retry; the third call is a no-op
    expect(payout.mock.calls[0][0].attempt).toBe(payout.mock.calls[1][0].attempt); // same sender_batch_id => PayPal dedupes
  });
  it("falls back to a labelled simulated payout when Payouts is not enabled", async () => {
    const j = await makeJob("completed");
    payout.mockRejectedValueOnce(new PayPalError("not authorized", 403, "AUTHORIZATION_ERROR"));
    expect((await confirmRepair(j.id, owner)).ok).toBe(true);
    const s = await get(j.id);
    expect(s).toMatchObject({ status: "payout_released", payoutMode: "simulated" });
    expect(s.payoutNote).toMatch(/SIMULATED/);
  });
  it("treats a duplicate sender_batch_id as already submitted, not as a second payment", async () => {
    const j = await makeJob("completed");
    payout.mockRejectedValueOnce(new PayPalError("Duplicate sender_batch_id", 400, "DUPLICATE"));
    expect((await confirmRepair(j.id, owner)).ok).toBe(true);
    expect((await get(j.id)).payoutBatchId).toBe(pp.senderBatchId(j.id, 0));
  });
  it("blocks capture while a problem is reported, until new proof is uploaded", async () => {
    const j = await makeJob("completed");
    await expect(reportProblem(j.id, tech, "it is broken")).rejects.toThrow(ActionError);
    await reportProblem(j.id, owner, "screen still flickers");
    await expect(confirmRepair(j.id, owner)).rejects.toThrow(/problem is reported/);
    expect(cap).not.toHaveBeenCalled();
    await expect(uploadProof(j.id, otherTech, { photoPath: "/u/b.jpg", notes: "fixed" })).rejects.toThrow(ActionError);
    await uploadProof(j.id, tech, { photoPath: "/u/b.jpg", notes: "fixed" });
    expect((await get(j.id)).problemReport).toBeNull();
    await confirmRepair(j.id, owner);
    expect((await get(j.id)).status).toBe("payout_released");
  });
  it("simulated authorization never produces a real capture or payout call", async () => {
    const j = await makeJob("completed", { paypalAuthId: "SIM-AUTH-1", authSimulated: true });
    cap.mockImplementation(async (auth, id) => ({ captureId: auth.startsWith("SIM-") ? `SIM-CAP-${id}` : "REAL", status: "COMPLETED" }));
    payout.mockImplementation(async (a) => pp.simulatedPayout(a.jobId, "test"));
    await confirmRepair(j.id, owner);
    const s = await get(j.id);
    expect(s.paypalCaptureId).toBe(`SIM-CAP-${j.id}`);
    expect(s.payoutMode).toBe("simulated");
  });
});

describe("authorization expiry", () => {
  it("plans by age: capture, re-authorize after the 3-day honor period, expired at 29 days", () => {
    const now = new Date();
    expect(pp.planCapture(new Date(+now - 1 * DAY), now)).toBe("capture");
    expect(pp.planCapture(new Date(+now - 4 * DAY), now)).toBe("reauthorize_then_capture");
    expect(pp.planCapture(new Date(+now - 28 * DAY), now)).toBe("reauthorize_then_capture");
    expect(pp.planCapture(new Date(+now - 29 * DAY), now)).toBe("expired");
  });
  it("past 29 days: moves to authorization_expired, no capture, no payout", async () => {
    const j = await makeJob("completed", { authorizedAt: new Date(Date.now() - 30 * DAY) });
    await expect(confirmRepair(j.id, owner)).rejects.toMatchObject({ code: "expired" });
    expect((await get(j.id)).status).toBe("authorization_expired");
    expect(cap).not.toHaveBeenCalled();
    expect(payout).not.toHaveBeenCalled();
  });
  it("after the honor period: re-authorizes, captures against the new authorization", async () => {
    const j = await makeJob("completed", { authorizedAt: new Date(Date.now() - 5 * DAY) });
    await confirmRepair(j.id, owner);
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(cap.mock.calls[0][0]).toBe("AUTH-2");
    const s = await get(j.id);
    expect(s).toMatchObject({ paypalAuthId: "AUTH-2", reauthCount: 1, status: "payout_released" });
  });
  it("if re-authorization is refused, still tries the original; if that is voided, expires", async () => {
    const j = await makeJob("completed", { authorizedAt: new Date(Date.now() - 5 * DAY) });
    reauth.mockRejectedValueOnce(new PayPalError("not allowed", 422, "REAUTHORIZATION_NOT_ALLOWED"));
    cap.mockRejectedValueOnce(new PayPalError("voided", 422, "AUTHORIZATION_VOIDED"));
    await expect(confirmRepair(j.id, owner)).rejects.toMatchObject({ code: "expired" });
    expect(cap.mock.calls[0][0]).toBe("AUTH-1");
    expect((await get(j.id)).status).toBe("authorization_expired");
    expect(payout).not.toHaveBeenCalled();
  });
});

describe("webhooks", () => {
  const ev = (id: string, event_type: string, resource: Record<string, unknown>) => ({ id, event_type, resource }) as Parameters<typeof processWebhookEvent>[0];
  it("is replay safe", async () => {
    const j = await makeJob("paid");
    const e = ev("E1", "PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1" });
    expect(await processWebhookEvent(e, true)).toBe("processed");
    expect(await processWebhookEvent(e, true)).toBe("duplicate");
    expect((await get(j.id)).status).toBe("authorization_expired");
  });
  it("records payout item results; failed items flip to payout_failed with a fresh batch attempt; unclaimed explains itself", async () => {
    const j = await makeJob("payout_released", { payoutBatchId: "B1", payoutItemId: "I1", payoutStatus: "PENDING", paypalCaptureId: "CAP-1" });
    await processWebhookEvent(ev("E2", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", { payout_item_id: "I1", transaction_status: "UNCLAIMED" }), true);
    let s = await get(j.id);
    expect(s.payoutStatus).toBe("UNCLAIMED");
    expect(s.payoutNote).toMatch(/no PayPal account/);
    expect(s.status).toBe("payout_released");
    await processWebhookEvent(ev("E3", "PAYMENT.PAYOUTS-ITEM.FAILED", { payout_item_id: "I1", transaction_status: "FAILED" }), true);
    s = await get(j.id);
    expect(s).toMatchObject({ status: "payout_failed", payoutAttempt: 1 });
    await retryPayout(j.id, owner);
    expect(payout.mock.calls[0][0].attempt).toBe(1);
  });
  it("capture webhook only records a missing capture id", async () => {
    const j = await makeJob("customer_confirmed");
    await processWebhookEvent(ev("E4", "PAYMENT.CAPTURE.COMPLETED", { id: "CAP-W", supplementary_data: { related_ids: { order_id: "ORD-1", authorization_id: "AUTH-1" } } }), true);
    expect(await get(j.id)).toMatchObject({ paypalCaptureId: "CAP-W", status: "customer_confirmed" });
  });
});

describe("dev-only simulated approval", () => {
  it("is refused unless NODE_ENV is not production and PAYPAL_SIMULATE_APPROVAL=true", async () => {
    const j = await makeJob("quoted", { paypalAuthId: null, authorizedAt: null });
    await expect(simulateBuyerApproval(j.id, owner)).rejects.toThrow(/Not available/);
    vi.stubEnv("PAYPAL_SIMULATE_APPROVAL", "true");
    vi.stubEnv("NODE_ENV", "production");
    await expect(simulateBuyerApproval(j.id, owner)).rejects.toThrow(/Not available/);
    vi.stubEnv("NODE_ENV", "development");
    await simulateBuyerApproval(j.id, owner);
    const s = await get(j.id);
    expect(s).toMatchObject({ status: "paid", authSimulated: true });
    expect(s.paypalAuthId).toMatch(/^SIM-AUTH-/);
    vi.unstubAllEnvs();
  });
});
