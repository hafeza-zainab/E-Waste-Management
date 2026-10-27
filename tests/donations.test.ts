import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalError } from "@/lib/paypal/client";

vi.mock("@/lib/paypal/donations", async (orig) => ({
  ...(await orig<typeof import("@/lib/paypal/donations")>()),
  createDonationOrder: vi.fn(),
  captureDonationOrder: vi.fn(),
}));

import { db } from "@/lib/db";
import { certificateId, dollarsToCents, DonationInputSchema, publicDonorName } from "@/lib/donations/amount";
import { captureDonation, certificateAvailable, simulateDonationApproval, startDonation } from "@/lib/donations/service";
import * as pd from "@/lib/paypal/donations";
import { processWebhookEvent } from "@/lib/paypal/webhook-handler";
import { GET as certificateGET } from "@/app/donate/certificate/[publicId]/route";

const create = vi.mocked(pd.createDonationOrder);
const capture = vi.mocked(pd.captureDonationOrder);
const ctx = (publicId: string) => ({ params: Promise.resolve({ publicId }) }) as never;

describe("donation amount validation", () => {
  it("converts dollars to integer cents with half-up rounding", () => {
    expect(dollarsToCents("5")).toBe(500);
    expect(dollarsToCents("$10.00")).toBe(1000);
    expect(dollarsToCents(12.34)).toBe(1234);
    expect(dollarsToCents("10.005")).toBe(1001);
    expect(dollarsToCents("0.999")).toBe(100);
    expect(dollarsToCents("19.99")).toBe(1999);
  });
  it("enforces $1 minimum and $500 maximum and rejects junk", () => {
    expect(dollarsToCents(1)).toBe(100);
    expect(dollarsToCents(500)).toBe(50000);
    for (const bad of ["0.99", "0", "-5", "500.01", "abc", "", "NaN", "Infinity"]) expect(() => dollarsToCents(bad), bad).toThrow();
  });
  it("sanitises and limits text fields", () => {
    const ok = DonationInputSchema.parse({ amount: "10", donorName: "  Zoe\u0000  Q  ", message: "hi\u0007 there" });
    expect(ok).toMatchObject({ amount: 1000, donorName: "Zoe Q", message: "hi there" });
    expect(DonationInputSchema.safeParse({ amount: "10", message: "x".repeat(201) }).success).toBe(false);
    expect(DonationInputSchema.safeParse({ amount: "10", donorName: "x".repeat(61) }).success).toBe(false);
    expect(DonationInputSchema.safeParse({ amount: "9999" }).success).toBe(false);
  });
  it("public names are first name only", () => {
    expect(publicDonorName("Maria Lindqvist")).toBe("Maria");
    expect(publicDonorName("   ")).toBe("Anonymous");
    expect(certificateId("abcdef12-3456-7890-abcd-ef1234567890")).toBe("RL-ABCDEF12");
  });
});

describe("donation order payload", () => {
  it("uses intent CAPTURE and a two-decimal string built from cents", () => {
    for (const cents of [100, 999, 1234, 50000]) {
      const p = pd.buildDonationOrderPayload("pub-1", cents, "http://localhost:3000/");
      expect(p.intent).toBe("CAPTURE");
      expect(p.purchase_units[0].amount).toEqual({ currency_code: "USD", value: (cents / 100).toFixed(2) });
      expect(p.purchase_units[0].amount.value).toMatch(/^\d+\.\d{2}$/);
    }
    const p = pd.buildDonationOrderPayload("pub-1", 500, "http://localhost:3000/");
    expect(p).not.toHaveProperty("payer");
    expect(p.purchase_units[0]).not.toHaveProperty("payee");
    expect(p.payment_source.paypal.experience_context.return_url).toBe("http://localhost:3000/donate/return?d=pub-1");
    expect(p.payment_source.paypal.experience_context.cancel_url).toContain("cancelled=1");
  });
});

describe("donation lifecycle", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
    await db.$transaction([db.webhookEvent.deleteMany(), db.donation.deleteMany()]);
    create.mockResolvedValue({ id: "ORD-D1", simulated: false, approveUrl: "https://sandbox.example/approve" });
    capture.mockResolvedValue({ captureId: "CAP-D1", status: "COMPLETED" });
  });

  const start = async (amount = "10") => (await startDonation({ amount, donorName: "Maria Lindqvist" })).publicId;

  it("stores the donation from validated cents and the created order id", async () => {
    const id = await start("12.34");
    const d = await db.donation.findUniqueOrThrow({ where: { publicId: id } });
    expect(d).toMatchObject({ amountCents: 1234, status: "created", paypalOrderId: "ORD-D1", simulated: false });
    expect(create).toHaveBeenCalledWith(id, 1234);
  });
  it("rejects invalid input before touching PayPal", async () => {
    await expect(startDonation({ amount: "0.50" })).rejects.toThrow(/minimum/);
    expect(create).not.toHaveBeenCalled();
    expect(await db.donation.count()).toBe(0);
  });
  it("captures exactly once, even when called repeatedly or concurrently", async () => {
    const id = await start();
    const results = await Promise.all([captureDonation(id, "ORD-D1"), captureDonation(id, "ORD-D1"), captureDonation(id, "ORD-D1")]);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(results.some((r) => r.status === "completed")).toBe(true);
    await captureDonation(id, "ORD-D1");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(await db.donation.findUniqueOrThrow({ where: { publicId: id } })).toMatchObject({ status: "completed", paypalCaptureId: "CAP-D1" });
  });
  it("refuses an order id that is not this donation's", async () => {
    const id = await start();
    expect((await captureDonation(id, "ORD-OTHER")).status).toBe("failed");
    expect(capture).not.toHaveBeenCalled();
  });
  it("a failed capture can be retried and then completes once", async () => {
    const id = await start();
    capture.mockRejectedValueOnce(new PayPalError("not approved", 422, "ORDER_NOT_APPROVED", "dbg"));
    const r = await captureDonation(id, "ORD-D1");
    expect(r).toMatchObject({ status: "failed", debugId: "dbg" });
    expect((await db.donation.findUniqueOrThrow({ where: { publicId: id } })).status).toBe("created");
    expect((await captureDonation(id, "ORD-D1")).status).toBe("completed");
  });

  it("certificate is gated: not before capture, not for pending, only via the unguessable id", async () => {
    const id = await start();
    let d = await db.donation.findUniqueOrThrow({ where: { publicId: id } });
    expect(certificateAvailable(d)).toBe(false);
    expect((await certificateGET(new Request("http://x"), ctx(id))).status).toBe(409);
    capture.mockResolvedValueOnce({ captureId: "CAP-P", status: "PENDING" });
    await captureDonation(id, "ORD-D1");
    d = await db.donation.findUniqueOrThrow({ where: { publicId: id } });
    expect(d.status).toBe("pending");
    expect((await certificateGET(new Request("http://x"), ctx(id))).status).toBe(409);
    await processWebhookEvent({ id: "EV-CAP", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-P", custom_id: id } }, true);
    const res = await certificateGET(new Request("http://x"), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await certificateGET(new Request("http://x"), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await certificateGET(new Request("http://x"), ctx(d.id))).status).toBe(404); // internal row id is not a credential
  });
  it("capture webhook is replay-safe and completes only unfinished donations", async () => {
    const id = await start();
    const ev = { id: "EV-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-W", supplementary_data: { related_ids: { order_id: "ORD-D1" } } } };
    expect(await processWebhookEvent(ev, true)).toBe("processed");
    expect(await processWebhookEvent(ev, true)).toBe("duplicate");
    expect(await db.donation.findUniqueOrThrow({ where: { publicId: id } })).toMatchObject({ status: "completed", paypalCaptureId: "CAP-W" });
    expect(await processWebhookEvent({ ...ev, id: "EV-2" }, true)).toBe("ignored"); // already completed
  });
  it("simulated approval: dev only, never in production, tagged simulated", async () => {
    const id = await start();
    await expect(simulateDonationApproval(id)).rejects.toThrow(/Not available/); // flag off
    vi.stubEnv("PAYPAL_SIMULATE_APPROVAL", "true");
    vi.stubEnv("NODE_ENV", "production");
    await expect(simulateDonationApproval(id)).rejects.toThrow(/Not available/);
    vi.stubEnv("NODE_ENV", "development");
    expect((await simulateDonationApproval(id)).status).toBe("completed");
    const d = await db.donation.findUniqueOrThrow({ where: { publicId: id } });
    expect(d).toMatchObject({ simulated: true, status: "completed" });
    expect(d.paypalCaptureId).toMatch(/^SIM-/);
    expect(certificateAvailable(d)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });
  it("without credentials in production, donations are unavailable instead of faked", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(startDonation({ amount: "10" })).rejects.toThrow(/not available/);
  });
});
