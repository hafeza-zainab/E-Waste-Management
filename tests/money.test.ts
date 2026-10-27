import { describe, expect, it } from "vitest";
import { splitPayout } from "@/lib/jobs/money";

describe("payout split", () => {
  it("takes a 10% platform fee and gives the technician the rest", () => {
    expect(splitPayout(5000, 1000)).toEqual({ totalCents: 5000, platformFeeCents: 500, technicianCents: 4500 });
  });
  it("never loses a cent to rounding", () => {
    const s = splitPayout(3333, 1000);
    expect(s.platformFeeCents + s.technicianCents).toBe(3333);
  });
  it("computes odd amounts in integer cents (half-up fee, remainder to the technician)", () => {
    expect(splitPayout(99, 1000)).toEqual({ totalCents: 99, platformFeeCents: 10, technicianCents: 89 });
    expect(splitPayout(3333, 1000)).toEqual({ totalCents: 3333, platformFeeCents: 333, technicianCents: 3000 });
    expect(splitPayout(5, 1000)).toEqual({ totalCents: 5, platformFeeCents: 1, technicianCents: 4 });
    for (const t of [1, 7, 99, 101, 1999, 3333, 99999]) {
      const s = splitPayout(t, 1000);
      expect(Number.isInteger(s.platformFeeCents) && Number.isInteger(s.technicianCents)).toBe(true);
      expect(s.platformFeeCents + s.technicianCents).toBe(t);
    }
  });
  it("handles zero and rejects invalid input", () => {
    expect(splitPayout(0, 1000).technicianCents).toBe(0);
    expect(() => splitPayout(-1, 1000)).toThrow();
    expect(() => splitPayout(10.5, 1000)).toThrow();
  });
});
