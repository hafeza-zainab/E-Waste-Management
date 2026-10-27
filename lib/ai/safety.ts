import { computeImpact } from "@/lib/impact/formulas";
import type { Diagnosis, ModelDiagnosis, RepairPath } from "./schemas";

/**
 * The hard safety gate. This is code, not prompt: whatever the model (or a
 * fixture) says, DIY is only allowed for minor + low-risk problems, and is
 * NEVER allowed when safety_risk is "high".
 */
export function isDiyAllowed(d: Pick<ModelDiagnosis, "severity" | "safety_risk">): boolean {
  if (d.safety_risk.level === "high") return false;
  return d.severity === "minor" && d.safety_risk.level === "low";
}

export function applySafetyGate(model: ModelDiagnosis, deviceType: string): Diagnosis {
  const notes: string[] = [];
  const diyAllowed = isDiyAllowed(model);
  let path: RepairPath = model.recommended_path;

  if (!diyAllowed) {
    if (model.safety_risk.level === "high") {
      notes.push("DIY blocked: high safety risk. " + model.safety_risk.reasons.join("; "));
    } else if (model.safety_risk.level === "medium") {
      notes.push("DIY not offered: medium safety risk.");
    } else {
      notes.push(`DIY not offered: the problem is classed as ${model.severity.replace("_", " ")}.`);
    }
  }

  // Never route a non-DIY-safe device to DIY, and never hand a high-risk device on as-is.
  const unsafeToHandOn = model.safety_risk.level === "high" && (path === "donate" || path === "refurbish");
  if ((!diyAllowed && path === "diy") || unsafeToHandOn) {
    path = model.severity === "not_repairable" ? "recycle" : "technician";
    notes.push(`Recommended path changed from "${model.recommended_path}" to "${path}" by the safety gate.`);
  }

  const outcome = path === "technician" || path === "diy" ? "repair" : path;
  const impact = computeImpact(deviceType, outcome);

  return {
    ...model,
    recommended_path: path,
    model_recommended_path: model.recommended_path,
    diy_allowed: diyAllowed,
    gate_notes: notes,
    environmental_impact: { outcome, ewaste_kg: impact.ewasteKg, co2e_kg: impact.co2eKg },
  };
}
