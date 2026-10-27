import { describe, expect, it } from "vitest";
import { applySafetyGate, isDiyAllowed } from "@/lib/ai/safety";
import { DIAGNOSIS_FIXTURES } from "@/lib/ai/fixtures";
import { DiagnosisSchema, PathSchema, RiskSchema, SeveritySchema, StrictModelDiagnosisSchema, type ModelDiagnosis } from "@/lib/ai/schemas";

const base: ModelDiagnosis = {
  summary: "x",
  likely_causes: [{ cause: "c", confidence: 0.5 }],
  severity: "minor",
  safety_risk: { level: "low", reasons: [] },
  recommended_path: "diy",
  estimated_parts: [],
  estimated_labor: { hours: 0, cost_usd: 0 },
};

describe("safety gate", () => {
  it("NEVER allows DIY when safety_risk is high, for every severity and every model-recommended path", () => {
    for (const severity of SeveritySchema.options) {
      for (const path of PathSchema.options) {
        const out = applySafetyGate(
          { ...base, severity, recommended_path: path, safety_risk: { level: "high", reasons: ["swollen battery"] } },
          "laptop",
        );
        expect(out.diy_allowed).toBe(false);
        expect(out.recommended_path).not.toBe("diy");
        expect(out.gate_notes.join(" ")).toMatch(/DIY blocked/);
      }
    }
  });

  it("only allows DIY for minor + low risk", () => {
    for (const severity of SeveritySchema.options) {
      for (const level of RiskSchema.options) {
        expect(isDiyAllowed({ severity, safety_risk: { level, reasons: [] } })).toBe(severity === "minor" && level === "low");
      }
    }
  });

  it("overrides a model that recommends DIY for a major problem", () => {
    const out = applySafetyGate({ ...base, severity: "major" }, "phone");
    expect(out.recommended_path).toBe("technician");
    expect(out.model_recommended_path).toBe("diy");
  });

  it("does not hand a high-risk device on for donation or refurbishment as-is", () => {
    const out = applySafetyGate({ ...base, severity: "major", recommended_path: "donate", safety_risk: { level: "high", reasons: ["r"] } }, "laptop");
    expect(out.recommended_path).toBe("technician");
  });

  it("routes a high-risk, not repairable device to recycle", () => {
    const out = applySafetyGate({ ...base, severity: "not_repairable", safety_risk: { level: "high", reasons: ["r"] } }, "laptop");
    expect(out.recommended_path).toBe("recycle");
  });

  it("keeps DIY for a minor, low-risk diagnosis", () => {
    const out = applySafetyGate(base, "phone");
    expect(out.diy_allowed).toBe(true);
    expect(out.recommended_path).toBe("diy");
  });
});

describe("demo fixtures", () => {
  it("all three scenarios validate and pass through the gate into the final schema", () => {
    for (const [key, fx] of Object.entries(DIAGNOSIS_FIXTURES)) {
      StrictModelDiagnosisSchema.parse(fx);
      const out = applySafetyGate(fx, key === "swollen-battery" ? "laptop" : key === "dead-tv" ? "tv" : "phone");
      expect(() => DiagnosisSchema.parse(out)).not.toThrow();
    }
  });

  it("swollen battery scenario is blocked from DIY even though the simulated model suggested it", () => {
    const out = applySafetyGate(DIAGNOSIS_FIXTURES["swollen-battery"], "laptop");
    expect(out.model_recommended_path).toBe("diy");
    expect(out.recommended_path).toBe("technician");
    expect(out.diy_allowed).toBe(false);
  });

  it("dead TV routes to recycle and cracked screen to a technician", () => {
    expect(applySafetyGate(DIAGNOSIS_FIXTURES["dead-tv"], "tv").recommended_path).toBe("recycle");
    expect(applySafetyGate(DIAGNOSIS_FIXTURES["cracked-screen"], "phone").recommended_path).toBe("technician");
  });

  it("rejects out-of-range model output", () => {
    expect(() => StrictModelDiagnosisSchema.parse({ ...base, likely_causes: [{ cause: "c", confidence: 1.5 }] })).toThrow();
    expect(() => StrictModelDiagnosisSchema.parse({ ...base, estimated_parts: [{ name: "p", price_usd: -1 }] })).toThrow();
  });
});
