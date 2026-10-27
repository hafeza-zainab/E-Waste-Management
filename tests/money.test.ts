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
  it("handles zero and rejects invalid input", () => {
    expect(splitPayout(0, 1000).technicianCents).toBe(0);
    expect(() => splitPayout(-1, 1000)).toThrow();
    expect(() => splitPayout(10.5, 1000)).toThrow();
  });
});
