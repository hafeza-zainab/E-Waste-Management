import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CLAUDE_MODEL, isDemoMode, recordAiCall } from "./config";
import { DIAGNOSIS_FIXTURES, GENERIC_FIXTURE, GUIDE_FIXTURES, type ScenarioKey } from "./fixtures";
import { DIAGNOSIS_SYSTEM, GUIDE_SYSTEM, diagnosisUserText, guideUserText } from "./prompts";
import { applySafetyGate } from "./safety";
import {
  GuideSchema,
  ModelDiagnosisSchema,
  StrictModelDiagnosisSchema,
  type Diagnosis,
  type Guide,
  type Intake,
  type ModelDiagnosis,
} from "./schemas";

export interface PhotoInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}

export interface DiagnosisResult {
  diagnosis: Diagnosis;
  source: "fixture" | "claude";
}

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

/** Match an intake to a scripted scenario by explicit key, then by obvious keywords. */
export function matchScenario(i: Pick<Intake, "type" | "problem" | "scenario">): ScenarioKey | null {
  if (i.scenario && i.scenario in DIAGNOSIS_FIXTURES) return i.scenario as ScenarioKey;
  const p = i.problem.toLowerCase();
  if (i.type === "phone" && /(crack|shatter|broken screen|screen)/.test(p)) return "cracked-screen";
  if (/(swollen|bulg|puffed)/.test(p) && /(battery|base|trackpad)/.test(p)) return "swollen-battery";
  if (i.type === "tv" && /(dead|no power|won'?t turn on|no standby)/.test(p)) return "dead-tv";
  return null;
}

async function callClaudeDiagnosis(i: Intake, photo?: PhotoInput): Promise<ModelDiagnosis> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (photo) content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } });
  content.push({ type: "text", text: diagnosisUserText(i) });

  recordAiCall();
  const res = await anthropic().messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: DIAGNOSIS_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ModelDiagnosisSchema) },
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined to diagnose this request.");
  if (!res.parsed_output) throw new Error("The AI returned an unreadable diagnosis. Please try again.");
  // Re-validate range constraints that JSON-schema output cannot express.
  return StrictModelDiagnosisSchema.parse(res.parsed_output);
}

export async function diagnose(i: Intake, photo?: PhotoInput): Promise<DiagnosisResult> {
  if (isDemoMode()) {
    const key = matchScenario(i);
    const fixture = StrictModelDiagnosisSchema.parse(key ? DIAGNOSIS_FIXTURES[key] : GENERIC_FIXTURE);
    return { diagnosis: applySafetyGate(fixture, i.type), source: "fixture" };
  }
  const model = await callClaudeDiagnosis(i, photo);
  return { diagnosis: applySafetyGate(model, i.type), source: "claude" };
}

export async function generateGuide(
  i: { type: string; brand: string; model: string; problem: string },
  d: Diagnosis,
): Promise<Guide> {
  // Defence in depth: the guide generator itself refuses when the gate says no.
  if (!d.diy_allowed) throw new Error("DIY is not allowed for this diagnosis.");
  if (isDemoMode()) {
    const screen = /screen|display|glass/i.test(i.problem);
    return GuideSchema.parse(GUIDE_FIXTURES[screen ? "screen" : "generic"]);
  }
  recordAiCall();
  const res = await anthropic().messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: GUIDE_SYSTEM,
    messages: [{ role: "user", content: guideUserText(i, d) }],
    output_config: { format: zodOutputFormat(GuideSchema) },
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("The AI could not produce a guide. Please try again.");
  return GuideSchema.parse(res.parsed_output);
}
