import { describe, expect, it } from "vitest";
import { computeImpact, recoverableMaterials } from "@/lib/impact/formulas";

describe("impact formulas", () => {
  it("repair keeps full device mass out of e-waste and avoids part of manufacturing CO2e", () => {
    expect(computeImpact("phone", "repair")).toEqual({ ewasteKg: 0.2, co2eKg: 42 });
  });
  it("donate and refurbish match repair", () => {
    expect(computeImpact("laptop", "donate")).toEqual(computeImpact("laptop", "repair"));
    expect(computeImpact("laptop", "refurbish")).toEqual(computeImpact("laptop", "repair"));
  });
  it("recycle diverts 90% of mass and uses per-kg CO2e factor", () => {
    expect(computeImpact("tv", "recycle")).toEqual({ ewasteKg: 10.8, co2eKg: 16.2 });
  });
  it("unknown device types fall back to 'other'", () => {
    expect(computeImpact("toaster-x", "repair").ewasteKg).toBe(1);
  });
  it("scales recoverable materials by device weight", () => {
    const copper = recoverableMaterials("tv").find((m) => m.material === "Copper");
    expect(copper?.grams).toBe(720);
  });
});
