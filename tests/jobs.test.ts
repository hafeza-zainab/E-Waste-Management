import { describe, expect, it } from "vitest";
import { JOB_STATUSES, assertTransition, canTransition, nextStatus } from "@/lib/jobs/state-machine";
import { buildQuote, matchTechnician, type TechCandidate } from "@/lib/jobs/quote";
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
});

describe("PayPal order payload", () => {
  const quote = buildQuote({ deviceType: "phone", parts: [{ name: "Screen", price_usd: 39 }], laborHours: 0.75, pickup: false, technicians: techs });
  it("uses AUTHORIZE intent and amounts that match the quote", () => {
    const p = buildOrderPayload("job1", "Repair", quote);
    expect(p.intent).toBe("AUTHORIZE");
    const unit = p.purchase_units[0];
    expect(unit.amount.value).toBe("52.50");
    expect(unit.amount.breakdown.item_total.value).toBe("52.50");
    expect(unit.custom_id).toBe("job1");
    const sum = unit.items.reduce((s, i) => s + Number(i.unit_amount.value), 0);
    expect(sum.toFixed(2)).toBe(unit.amount.value);
  });
  it("refuses a quote whose lines do not add up", () => {
    expect(() => buildOrderPayload("job1", "Repair", { ...quote, totalCents: quote.totalCents + 1 })).toThrow(/add up/);
  });
});
