import { describe, expect, it } from "vitest";
import { JOB_STATUSES, assertTransition, canTransition, nextStatus } from "@/lib/jobs/state-machine";
import { buildQuote, matchTechnician, NoTechnicianError, type TechCandidate } from "@/lib/jobs/quote";
import { deviceLabel } from "@/lib/jobs/device-label";
import { buildOrderPayload } from "@/lib/paypal/orders";

const techs: TechCandidate[] = [
  { id: "a", name: "Aisha", skills: "phone,tablet", rating: 4.9, distanceKm: 2, hourlyCents: 1800, isTrainee: false },
  { id: "b", name: "Diego", skills: "laptop,phone", rating: 4.7, distanceKm: 4.6, hourlyCents: 2200, isTrainee: false },
  { id: "c", name: "Tomasz", skills: "tv,appliance", rating: 4.8, distanceKm: 8, hourlyCents: 2500, isTrainee: false },
];

describe("job state machine", () => {
  it("allows only the next step in the lifecycle", () => {
    for (let i = 0; i < JOB_STATUSES.length - 1; i++) {
      expect(canTransition(JOB_STATUSES[i], JOB_STATUSES[i + 1])).toBe(true);
      expect(nextStatus(JOB_STATUSES[i])).toBe(JOB_STATUSES[i + 1]);
    }
    expect(nextStatus("payout_released")).toBeNull();
  });
  it("rejects skips, reversals and unknown statuses", () => {
    expect(canTransition("quoted", "accepted")).toBe(false);
    expect(canTransition("paid", "quoted")).toBe(false);
    expect(canTransition("completed", "payout_released")).toBe(false);
    expect(() => assertTransition("quoted", "payout_released")).toThrow(/Illegal/);
    expect(() => assertTransition("nonsense", "paid")).toThrow(/Illegal/);
  });
  it("cannot release payout before customer confirmation", () => {
    expect(canTransition("completed", "payout_released")).toBe(false);
    expect(canTransition("customer_confirmed", "payout_released")).toBe(true);
  });
});

describe("technician matching and quote", () => {
  it("only matches technicians with the device skill, best first", () => {
    expect(matchTechnician("phone", techs)?.tech.id).toBe("a");
    expect(matchTechnician("laptop", techs)?.tech.id).toBe("b");
    expect(matchTechnician("tv", techs)?.tech.id).toBe("c");
    expect(matchTechnician("appliance", techs)?.tech.id).toBe("c");
    expect(matchTechnician("tablet", techs.filter((t) => t.id !== "a"))).toBeNull();
  });
  it("builds an itemised quote whose lines sum to the total", () => {
    const q = buildQuote({ deviceType: "phone", parts: [{ name: "Screen", price_usd: 39 }], laborHours: 0.75, pickup: true, technicians: techs });
    expect(q.technicianId).toBe("a");
    expect(q.partsCents).toBe(3900);
    expect(q.laborCents).toBe(1350);
    expect(q.logisticsCents).toBe(400 + 80);
    expect(q.lines.reduce((s, l) => s + l.cents, 0)).toBe(q.totalCents);
    expect(q.platformFeeCents + q.technicianPayoutCents).toBe(q.totalCents);
  });
  it("omits logistics without pickup and enforces a minimum half hour of labor", () => {
    const q = buildQuote({ deviceType: "phone", parts: [], laborHours: 0.1, pickup: false, technicians: techs });
    expect(q.logisticsCents).toBe(0);
    expect(q.laborCents).toBe(900);
  });
  it("throws when nobody can repair the device", () => {
    expect(() => buildQuote({ deviceType: "other", parts: [], laborHours: 1, pickup: false, technicians: techs })).toThrow(/No technician/);
  });
  it("never assigns a phone/tablet-only technician to a laptop job", () => {
    const aisha = techs.filter((t) => t.id === "a");
    expect(matchTechnician("laptop", aisha)).toBeNull();
    expect(() => buildQuote({ deviceType: "laptop", parts: [], laborHours: 1, pickup: false, technicians: aisha })).toThrow(NoTechnicianError);
    // With a laptop-capable technician available, the laptop job goes to them, not to Aisha.
    expect(buildQuote({ deviceType: "laptop", parts: [], laborHours: 1, pickup: false, technicians: techs }).technicianId).toBe("b");
  });
  it("labels a device with its real brand and model", () => {
    expect(deviceLabel({ brand: "Dell", model: "Inspiron 15" })).toBe("Dell Inspiron 15");
    expect(deviceLabel({ brand: " Apple ", model: "17" })).toBe("Apple 17");
  });
});

describe("PayPal order payload", () => {
  const quote = buildQuote({ deviceType: "phone", parts: [{ name: "Screen", price_usd: 39 }], laborHours: 0.75, pickup: false, technicians: techs });
  it("uses AUTHORIZE intent and amounts that match the quote", () => {
    const p = buildOrderPayload("job1", "Repair", quote, "http://localhost:3000");
    expect(p.intent).toBe("AUTHORIZE");
    const unit = p.purchase_units[0];
    expect(unit.amount.value).toBe("52.50");
    expect(unit.amount.currency_code).toBe("USD");
    expect(unit.amount.breakdown.item_total.value).toBe("52.50");
    expect(unit.custom_id).toBe("job1");
    const sum = unit.items.reduce((s, i) => s + Number(i.unit_amount.value), 0);
    expect(sum.toFixed(2)).toBe(unit.amount.value);
  });
  it("sends amounts as 2-decimal strings and quantity as a string", () => {
    const p = buildOrderPayload("job1", "Repair", buildQuote({ deviceType: "phone", parts: [{ name: "Cable", price_usd: 0.99 }], laborHours: 1, pickup: true, technicians: techs }), "http://localhost:3000");
    const unit = p.purchase_units[0];
    for (const v of [unit.amount.value, unit.amount.breakdown.item_total.value, ...unit.items.map((i) => i.unit_amount.value)]) expect(v).toMatch(/^\d+\.\d{2}$/);
    for (const i of unit.items) {
      expect(i.quantity).toBe("1");
      expect(i.name.length).toBeLessThanOrEqual(127);
      expect(i.unit_amount.currency_code).toBe("USD");
    }
    expect(unit.amount.currency_code).toBe(unit.amount.breakdown.item_total.currency_code);
  });
  it("has no payer/payee/shipping, uses NO_SHIPPING in experience_context and valid ids", () => {
    const p = buildOrderPayload("cmvqg8tu00008uze8r3n5467k", "Repair", quote, "http://localhost:3000/");
    const json = p as unknown as Record<string, unknown>;
    expect(json).not.toHaveProperty("payer");
    expect(json).not.toHaveProperty("application_context");
    expect(p.purchase_units[0]).not.toHaveProperty("payee");
    expect(p.purchase_units[0]).not.toHaveProperty("shipping");
    const ctx = p.payment_source.paypal.experience_context;
    expect(ctx.shipping_preference).toBe("NO_SHIPPING");
    expect(ctx.return_url).toBe("http://localhost:3000/jobs/cmvqg8tu00008uze8r3n5467k/return");
    expect(p.purchase_units[0].custom_id).toMatch(/^[A-Za-z0-9_-]{1,127}$/);
  });
  it("skips zero-value items and sanitises names without breaking the sums", () => {
    const withZero = { ...quote, lines: [{ kind: "part" as const, label: "Free cable ✓", cents: 0 }, ...quote.lines] };
    const p = buildOrderPayload("job1", "Repair é", withZero, "http://x");
    expect(p.purchase_units[0].items).toHaveLength(quote.lines.length);
    expect(p.purchase_units[0].amount.value).toBe("52.50");
  });
  it("refuses a quote whose lines do not add up", () => {
    expect(() => buildOrderPayload("job1", "Repair", { ...quote, totalCents: quote.totalCents + 1 }, "http://x")).toThrow(/add up/);
  });
});
