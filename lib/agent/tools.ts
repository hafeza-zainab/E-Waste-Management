import { z } from "zod";
import { db } from "@/lib/db";
import { diagnose, type PhotoInput } from "@/lib/ai/diagnosis";
import { SCENARIO_INTAKE, type ScenarioKey } from "@/lib/ai/fixtures";
import { IntakeSchema, type Diagnosis } from "@/lib/ai/schemas";
import { buildQuote, NoTechnicianError, rankTechnicians, type Quote } from "@/lib/jobs/quote";
import { parseQuote, persistQuote } from "@/lib/jobs/service";
import { formatUsd } from "@/lib/jobs/money";
import { log } from "@/lib/log";
import { ApprovalError, requestApproval } from "./approval";
import { createOrderWithApproval } from "./order";

/** Everything a run knows. goal/photo are UNTRUSTED data; budgetCents is set by the user, never by the model. */
export interface AgentContext {
  runId: string;
  goal: string;
  budgetCents: number | null;
  ownerId: string;
  photo?: PhotoInput;
  /** Scripted demo only: locks the device identity to the scenario's own fixture. */
  scenario?: ScenarioKey;
  state: { deviceId?: string; deviceType?: string; diagnosis?: Diagnosis; jobId?: string; approvalId?: string };
}

export type ToolStatus = "ok" | "blocked" | "error";

export interface QuoteCard {
  jobId: string;
  approvalId: string;
  expiresAt: string;
  deviceLabel: string;
  lines: { label: string; cents: number }[];
  totalCents: number;
  budgetCents: number | null;
  technician: { id: string; name: string; reasons: string[] };
  platformFeeCents: number;
  technicianPayoutCents: number;
}

export interface ToolOutput {
  status: ToolStatus;
  /** One line shown in the trace. */
  summary: string;
  /** JSON given back to the model (untrusted-data framing is applied by the runner). Never contains tokens. */
  result: unknown;
  /** Ends the autonomous part of the run. */
  terminal?: boolean;
  ui?: { quoteCard?: QuoteCard; safety?: { level: string; diyAllowed: boolean; reasons: string[] } };
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  input: S;
  /** false = never offered to the model and refused if the model asks for it. */
  modelVisible: boolean;
  summarizeInput: (a: z.infer<S>) => string;
  run: (a: z.infer<S>, ctx: AgentContext) => Promise<ToolOutput>;
}

const define = <S extends z.ZodType>(t: ToolDef<S>) => t;
const fail = (summary: string, status: ToolStatus = "error", result: unknown = { ok: false, error: summary }): ToolOutput => ({ status, summary, result });
const needDevice = (ctx: AgentContext) => (ctx.state.diagnosis && ctx.state.deviceId ? null : fail("Diagnose the device first (diagnose_device)."));

const diagnoseDevice = define({
  name: "diagnose_device",
  label: "Diagnosing the device",
  description: "Diagnose the device from its type, brand, model, age and the problem. Runs the code-level safety gate. Call this first.",
  input: IntakeSchema.omit({ scenario: true }),
  modelVisible: true,
  summarizeInput: (a) => `${a.brand} ${a.model} (${a.type}), ${a.ageYears} y`,
  async run(a, ctx) {
    if (ctx.state.deviceId) return fail("This run already diagnosed a device.");
    // Scripted demo: the scenario's own fixture owns the identity, so every page shows the same device.
    const fixed = ctx.scenario ? SCENARIO_INTAKE[ctx.scenario] : null;
    const intake = IntakeSchema.parse(fixed ? { ...a, ...fixed, scenario: ctx.scenario } : a);
    const { diagnosis, source } = await diagnose(intake, ctx.photo);
    const device = await db.device.create({
      data: {
        ownerId: ctx.ownerId, type: intake.type, brand: intake.brand, model: intake.model, ageYears: intake.ageYears, problem: intake.problem,
        scenario: intake.scenario, diagnosisJson: JSON.stringify(diagnosis), diagnosisSource: source,
      },
    });
    ctx.state = { ...ctx.state, deviceId: device.id, deviceType: device.type, diagnosis };
    return {
      status: "ok",
      summary: `${diagnosis.severity.replace("_", " ")}, ${diagnosis.safety_risk.level} risk, path: ${diagnosis.recommended_path}`,
      result: {
        deviceId: device.id, summary: diagnosis.summary, severity: diagnosis.severity, safety_risk: diagnosis.safety_risk,
        diy_allowed: diagnosis.diy_allowed, recommended_path: diagnosis.recommended_path, gate_notes: diagnosis.gate_notes,
        estimated_parts: diagnosis.estimated_parts, estimated_labor: diagnosis.estimated_labor,
      },
    };
  },
});

const checkSafety = define({
  name: "check_safety",
  label: "Checking safety",
  description: "Report the code-enforced safety verdict for the diagnosed device: whether DIY is allowed and why. The verdict cannot be overridden.",
  input: z.object({}),
  modelVisible: true,
  summarizeInput: () => "diagnosed device",
  async run(_a, ctx) {
    const missing = needDevice(ctx);
    if (missing) return missing;
    const d = ctx.state.diagnosis!;
    const level = d.safety_risk.level;
    return {
      status: "ok",
      summary: level === "high" ? "High risk: DIY blocked" : d.diy_allowed ? "Low risk: DIY would be allowed" : `${level} risk: DIY not offered`,
      result: {
        risk_level: level, reasons: d.safety_risk.reasons, diy_allowed: d.diy_allowed, severity: d.severity, gate_notes: d.gate_notes,
        rule: d.diy_allowed ? "DIY may be mentioned as an option." : "DIY is forbidden for this device. Never suggest opening, repairing or charging it yourself.",
      },
      ui: { safety: { level, diyAllowed: d.diy_allowed, reasons: d.safety_risk.reasons } },
    };
  },
});

async function compatibleParts(ctx: AgentContext) {
  const device = await db.device.findUniqueOrThrow({ where: { id: ctx.state.deviceId! } });
  const model = device.model.toLowerCase();
  const all = await db.part.findMany({ where: { deviceType: device.type }, orderBy: { priceCents: "asc" } });
  return all.filter((p) => p.models === "*" || p.models.split(",").some((m) => model.includes(m.trim())));
}

const searchParts = define({
  name: "search_parts",
  label: "Searching parts catalogue",
  description: "Search the parts catalogue for parts compatible with the diagnosed device. Optional text query and price ceiling in cents. Returns cheapest first with stock.",
  input: z.object({ query: z.string().max(80).optional(), maxPriceCents: z.number().int().min(0).max(1_000_000).optional() }),
  modelVisible: true,
  summarizeInput: (a) => [a.query && `"${a.query}"`, a.maxPriceCents != null && `max ${formatUsd(a.maxPriceCents)}`].filter(Boolean).join(", ") || "all compatible parts",
  async run(a, ctx) {
    const missing = needDevice(ctx);
    if (missing) return missing;
    const q = a.query?.toLowerCase();
    const parts = (await compatibleParts(ctx))
      .filter((p) => (!q || p.name.toLowerCase().includes(q)) && (a.maxPriceCents == null || p.priceCents <= a.maxPriceCents))
      .map((p) => ({ partId: p.id, name: p.name, quality: p.quality, priceCents: p.priceCents, inStock: p.stock > 0 }));
    const inStock = parts.filter((p) => p.inStock).length;
    return { status: "ok", summary: parts.length ? `${parts.length} found, ${inStock} in stock, from ${formatUsd(parts[0].priceCents)}` : "No compatible parts found", result: { parts } };
  },
});

const findTechnician = define({
  name: "find_technician",
  label: "Matching a technician",
  description: "Find technicians who list the device type as a skill, ranked by rating, distance and rate. Returns available:false when nobody qualifies.",
  input: z.object({}),
  modelVisible: true,
  summarizeInput: () => "by device skill, rating and distance",
  async run(_a, ctx) {
    const missing = needDevice(ctx);
    if (missing) return missing;
    const ranked = rankTechnicians(ctx.state.deviceType!, await db.technician.findMany());
    if (ranked.length === 0) return { status: "ok", summary: "None available for this device type", result: { available: false, message: `No technician is available for ${ctx.state.deviceType} repairs yet.` } };
    const t = (m: (typeof ranked)[number]) => ({ technicianId: m.tech.id, name: m.tech.name, rating: m.tech.rating, distanceKm: m.tech.distanceKm, hourlyCents: m.tech.hourlyCents, reasons: m.reasons });
    return { status: "ok", summary: `${ranked[0].tech.name} (rated ${ranked[0].tech.rating.toFixed(1)}, ${ranked[0].tech.distanceKm.toFixed(1)} km)`, result: { available: true, best: t(ranked[0]), alternatives: ranked.slice(1, 3).map(t) } };
  },
});

const buildQuoteTool = define({
  name: "build_quote",
  label: "Building a quote",
  description:
    "Build an itemised quote (parts + labor + optional pickup) for the technician path and create the job. Prices come from the catalogue and the technician's rate, never from you. Rejected if over the user's budget.",
  input: z.object({ partId: z.string().max(80).optional(), pickup: z.boolean().default(false), technicianId: z.string().max(80).optional() }),
  modelVisible: true,
  summarizeInput: (a) => [a.partId ? `part ${a.partId}` : "diagnosis estimate parts", a.pickup ? "with pickup" : "no pickup"].join(", "),
  async run(a, ctx) {
    const missing = needDevice(ctx);
    if (missing) return missing;
    const d = ctx.state.diagnosis!;
    if (d.recommended_path !== "technician")
      return fail(`A technician quote does not fit: the recommended path is "${d.recommended_path}".`, "blocked", { ok: false, code: "wrong_path", recommended_path: d.recommended_path });

    let parts = d.estimated_parts;
    if (a.partId) {
      const part = (await compatibleParts(ctx)).find((p) => p.id === a.partId);
      if (!part) return fail("That part is not compatible with this device or does not exist.", "error", { ok: false, code: "bad_part" });
      if (part.stock <= 0) return fail(`${part.name} is out of stock.`, "blocked", { ok: false, code: "out_of_stock" });
      parts = [{ name: part.name, price_usd: part.priceCents / 100 }];
    }
    let quote: Quote;
    try {
      quote = buildQuote({ deviceType: ctx.state.deviceType!, parts, laborHours: d.estimated_labor.hours, pickup: a.pickup, technicians: await db.technician.findMany(), technicianId: a.technicianId });
    } catch (e) {
      if (e instanceof NoTechnicianError) return fail("No technician available for this device type yet.", "blocked", { ok: false, code: "no_technician" });
      throw e;
    }

    // Budget cap, enforced in code. Only the user can raise it (UI field), the model cannot.
    if (ctx.budgetCents != null && quote.totalCents > ctx.budgetCents) {
      const over = quote.totalCents - ctx.budgetCents;
      return {
        status: "blocked",
        summary: `Over budget: ${formatUsd(quote.totalCents)} vs ${formatUsd(ctx.budgetCents)} (by ${formatUsd(over)}). No job created.`,
        result: {
          ok: false, code: "over_budget", totalCents: quote.totalCents, budgetCents: ctx.budgetCents, overByCents: over,
          verifiableAlternatives: [
            "search_parts for a cheaper compatible part, then build_quote again",
            ...(d.diy_allowed ? ["DIY is allowed by the safety gate"] : ["DIY is NOT allowed by the safety gate"]),
            "refurbish, donate or recycle instead",
            "ask the user to raise the budget (only they can)",
          ],
        },
      };
    }

    // One open quote per run: replace an earlier unpaid quote instead of leaving duplicates.
    await db.job.deleteMany({ where: { agentRunId: ctx.runId, status: "quoted", paypalOrderId: null } });
    const job = await persistQuote(ctx.state.deviceId!, d, quote, { agentRunId: ctx.runId });
    ctx.state = { ...ctx.state, jobId: job.id };
    return {
      status: "ok",
      summary: `${formatUsd(quote.totalCents)} with ${quote.technicianName}${ctx.budgetCents != null ? ` (budget ${formatUsd(ctx.budgetCents)})` : ""}`,
      result: {
        ok: true, jobId: job.id, totalCents: quote.totalCents, lines: quote.lines, technician: quote.technicianName, platformFeeCents: quote.platformFeeCents,
        technicianPayoutCents: quote.technicianPayoutCents, withinBudget: ctx.budgetCents == null || quote.totalCents <= ctx.budgetCents,
      },
    };
  },
});

const requestUserApproval = define({
  name: "request_user_approval",
  label: "Asking you to approve",
  description: "Present the quote to the user and END the autonomous run. The user alone decides; you cannot approve, authorize or pay.",
  input: z.object({ jobId: z.string().min(1).max(80) }),
  modelVisible: true,
  summarizeInput: () => "the quote",
  async run(a, ctx) {
    if (ctx.state.jobId !== a.jobId) return fail("That job is not the quote built in this run.", "error", { ok: false, code: "wrong_job" });
    try {
      const approval = await requestApproval(ctx.runId, a.jobId);
      ctx.state = { ...ctx.state, approvalId: approval.id };
      const job = await db.job.findUniqueOrThrow({ where: { id: a.jobId }, include: { device: true } });
      const quote = parseQuote(job.quoteJson)!;
      const card: QuoteCard = {
        jobId: job.id, approvalId: approval.id, expiresAt: approval.expiresAt.toISOString(), deviceLabel: `${job.device.brand} ${job.device.model}`,
        lines: quote.lines.map((l) => ({ label: l.label, cents: l.cents })), totalCents: job.totalCents, budgetCents: ctx.budgetCents,
        technician: { id: quote.technicianId, name: quote.technicianName, reasons: quote.matchReasons }, platformFeeCents: quote.platformFeeCents, technicianPayoutCents: quote.technicianPayoutCents,
      };
      return {
        status: "ok", summary: "Waiting for your approval (valid 15 minutes)", terminal: true,
        result: { approvalRequested: true, note: "The run ends here. Only the user can approve; you have no way to pay." },
        ui: { quoteCard: card },
      };
    } catch (e) {
      if (e instanceof ApprovalError) return fail(e.message, "error");
      throw e;
    }
  },
});

const createPaypalOrder = define({
  name: "create_paypal_order",
  label: "Creating the PayPal order",
  description: "Creates the AUTHORIZE order. Requires the user's single-use approval token. Not available to the model.",
  input: z.object({ jobId: z.string().min(1).max(80), token: z.string().max(200).optional() }),
  modelVisible: false,
  summarizeInput: () => "approved quote",
  async run(a) {
    try {
      const order = await createOrderWithApproval(a.jobId, a.token);
      return { status: "ok", summary: `Order ${order.id} created (not yet authorized)`, result: { orderId: order.id, approveUrl: order.approveUrl, simulated: order.simulated } };
    } catch (e) {
      if (e instanceof ApprovalError) return fail(`Refused: ${e.message}`, "blocked", { ok: false, code: e.code });
      throw e;
    }
  },
});

export const TOOLS = [diagnoseDevice, checkSafety, searchParts, findTechnician, buildQuoteTool, requestUserApproval, createPaypalOrder] as const;
export type AnyTool = (typeof TOOLS)[number];
const BY_NAME = new Map<string, AnyTool>(TOOLS.map((t) => [t.name, t]));

/** Tools offered to the model, as Anthropic tool specs. create_paypal_order is deliberately absent. */
export function modelToolSpecs() {
  return TOOLS.filter((t) => t.modelVisible).map((t) => {
    const { $schema, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    void $schema;
    return { name: t.name, description: t.description, input_schema: schema as { type: "object"; [k: string]: unknown } };
  });
}

export const toolLabel = (name: string) => BY_NAME.get(name)?.label ?? name;

export interface ExecResult extends ToolOutput {
  tool: string;
  inputSummary: string;
  ms: number;
}

/**
 * The only way tools run. Arguments are validated by zod no matter who produced them; unknown tools,
 * model-hidden tools and thrown errors all come back as a result, never as an exception.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: AgentContext, opts: { fromModel: boolean }): Promise<ExecResult> {
  const started = Date.now();
  const done = (o: ToolOutput, inputSummary = ""): ExecResult => ({ ...o, tool: name, inputSummary, ms: Date.now() - started });
  const tool = BY_NAME.get(name);
  if (!tool) return done(fail(`Unknown tool "${name}".`));
  if (opts.fromModel && !tool.modelVisible) return done(fail(`"${name}" is not available to the agent. Only the user's approval can unlock it.`, "blocked"));
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) return done(fail(`Invalid arguments: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`));
  const args = parsed.data as never;
  try {
    const out = await (tool as ToolDef<z.ZodType>).run(args, ctx);
    return done(out, (tool as ToolDef<z.ZodType>).summarizeInput(args));
  } catch (e) {
    log.error("agent_tool_failed", { tool: name, error: e instanceof Error ? e.message : "unknown" });
    return done(fail(e instanceof Error ? e.message.slice(0, 200) : "Tool failed."), "");
  }
}
