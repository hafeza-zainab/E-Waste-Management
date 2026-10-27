import { z } from "zod";
import { bodyTooLarge, rateLimitResponse } from "@/lib/security/rate-limit";
import type { PhotoInput } from "@/lib/ai/diagnosis";
import { SCENARIO_INTAKE, type ScenarioKey } from "@/lib/ai/fixtures";
import { runAgent, type AgentEvent } from "@/lib/agent/runner";
import { dollarsToCents } from "@/lib/agent/budget-input";
import { log } from "@/lib/log";
import { getDemoOwner } from "@/lib/session";
import { MAX_UPLOAD_BYTES, saveImageUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 120;

const Fields = z.object({
  goal: z.string().trim().min(10, "Describe what you need in at least 10 characters.").max(1000, "Please keep the request under 1000 characters."),
  budget: z.string().max(12).optional(),
  scenario: z.string().max(40).optional(),
});

/** Streams the agent's steps as newline-delimited JSON. Aborting the request (Stop button) stops the run. */
export async function POST(req: Request) {
  const limited = rateLimitResponse(req, "agent");
  if (limited) return limited;
  const tooBig = bodyTooLarge(req, 6 * 1024 * 1024);
  if (tooBig) return tooBig;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = Fields.safeParse({ goal: form.get("goal"), budget: form.get("budget") || undefined, scenario: form.get("scenario") || undefined });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  let budgetCents: number | null = null;
  if (parsed.data.budget) {
    try {
      budgetCents = dollarsToCents(parsed.data.budget);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Invalid budget." }, { status: 400 });
    }
  }
  const scenario = parsed.data.scenario && parsed.data.scenario in SCENARIO_INTAKE ? (parsed.data.scenario as ScenarioKey) : undefined;

  let photo: PhotoInput | undefined;
  try {
    const saved = await saveImageUpload(form.get("photo"));
    if (saved) photo = { mediaType: saved.mediaType, base64: saved.base64 };
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : `Photo is invalid (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` }, { status: 400 });
  }

  const owner = await getDemoOwner();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          /* client went away */
        }
      };
      try {
        await runAgent({ goal: parsed.data.goal, budgetCents, photo, scenario, ownerId: owner.id, signal: req.signal, emit });
      } catch (e) {
        log.error("agent_start_failed", { error: e instanceof Error ? e.message : "unknown" });
        emit({ type: "error", message: "The agent could not start. Nothing was charged." });
        emit({ type: "done", status: "failed" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
