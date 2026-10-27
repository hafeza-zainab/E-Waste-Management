import { z } from "zod";

export const DEVICE_TYPES = ["phone", "laptop", "tablet", "tv", "appliance", "other"] as const;
export const SeveritySchema = z.enum(["minor", "major", "not_repairable"]);
export const RiskSchema = z.enum(["low", "medium", "high"]);
export const PathSchema = z.enum(["diy", "technician", "refurbish", "donate", "recycle"]);

export type Severity = z.infer<typeof SeveritySchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type RepairPath = z.infer<typeof PathSchema>;

/** What the model (or a fixture) is asked to produce. Impact is computed in code, not by the model. */
export const ModelDiagnosisSchema = z.object({
  summary: z.string(),
  likely_causes: z.array(z.object({ cause: z.string(), confidence: z.number() })),
  severity: SeveritySchema,
  safety_risk: z.object({ level: RiskSchema, reasons: z.array(z.string()) }),
  recommended_path: PathSchema,
  estimated_parts: z.array(z.object({ name: z.string(), price_usd: z.number() })),
  estimated_labor: z.object({ hours: z.number(), cost_usd: z.number() }),
});
export type ModelDiagnosis = z.infer<typeof ModelDiagnosisSchema>;

/** Range checks that JSON-schema structured output can't express. Throws on violation. */
export const StrictModelDiagnosisSchema = ModelDiagnosisSchema.superRefine((d, ctx) => {
  if (d.likely_causes.length === 0) ctx.addIssue({ code: "custom", message: "likely_causes is empty" });
  if (d.likely_causes.some((c) => c.confidence < 0 || c.confidence > 1))
    ctx.addIssue({ code: "custom", message: "confidence must be within 0..1" });
  if (d.estimated_parts.some((p) => p.price_usd < 0 || p.price_usd > 5000))
    ctx.addIssue({ code: "custom", message: "part price out of range" });
  if (d.estimated_labor.hours < 0 || d.estimated_labor.hours > 40 || d.estimated_labor.cost_usd < 0 || d.estimated_labor.cost_usd > 5000)
    ctx.addIssue({ code: "custom", message: "labor out of range" });
});

/** Final diagnosis stored and shown to users: model output + code-enforced fields. */
export const DiagnosisSchema = ModelDiagnosisSchema.extend({
  model_recommended_path: PathSchema,
  diy_allowed: z.boolean(),
  gate_notes: z.array(z.string()),
  environmental_impact: z.object({
    outcome: z.enum(["repair", "refurbish", "donate", "recycle"]),
    ewaste_kg: z.number(),
    co2e_kg: z.number(),
  }),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const GuideSchema = z.object({
  title: z.string(),
  estimated_minutes: z.number(),
  tools: z.array(z.string()),
  parts: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      instruction: z.string(),
      /** Condition under which the user should stop and book a technician instead. */
      stop_and_book_if: z.string(),
    }),
  ),
});
export type Guide = z.infer<typeof GuideSchema>;

export const IntakeSchema = z.object({
  type: z.enum(DEVICE_TYPES),
  brand: z.string().trim().min(1, "Brand is required").max(60),
  model: z.string().trim().min(1, "Model is required").max(80),
  ageYears: z.coerce.number().int().min(0).max(40),
  problem: z.string().trim().min(10, "Please describe the problem in at least 10 characters").max(1500),
  scenario: z.string().optional(),
});
export type Intake = z.infer<typeof IntakeSchema>;
