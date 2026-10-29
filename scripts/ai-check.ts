/**
 * Live Claude readiness check. Run: npm run ai:check
 *
 * Part 1 always runs and needs NO key: it drives the real diagnosis code against a stubbed Anthropic API
 * (good response, prose around JSON, malformed JSON, and every error class).
 * Part 2 runs only with ANTHROPIC_API_KEY set and DEMO_MODE=false: one real diagnosis and one real agent run,
 * hard-capped at 12 API calls and 90 seconds in total.
 *
 * Never prints the key. Live runs write a device/job row to the local database (DATABASE_URL), so use a dev DB.
 */

const MAX_CALLS = 12;
const TIMEOUT_MS = 90_000;
const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const LIVE = process.env.DEMO_MODE === "false" && !!KEY;

// ---- fetch wrapper: counts and caps calls, records usage and failures, can be stubbed ---------------------
type Stub = (url: string, init?: RequestInit) => Response | Promise<Response>;
let stub: Stub | null = null;
const seen = { offline: 0, anthropic: 0, paypal: 0, tokensIn: 0, tokensOut: 0, lastFailure: "" as string };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/paypal\.com/.test(url)) {
    seen.paypal += 1;
    throw new Error("ai:check blocks all PayPal traffic");
  }
  if (!/api\.anthropic\.com/.test(url) && !stub) return realFetch(input, init);
  if (stub) {
    seen.offline += 1;
    return stub(url, init);
  }
  seen.anthropic += 1;
  if (seen.anthropic > MAX_CALLS) throw new Error(`ai:check call cap (${MAX_CALLS}) reached`);
  try {
    const res = await realFetch(input, init);
    if (!res.ok) seen.lastFailure = `HTTP ${res.status}`;
    else {
      const body = (await res.clone().json().catch(() => null)) as { usage?: { input_tokens?: number; output_tokens?: number } } | null;
      seen.tokensIn += body?.usage?.input_tokens ?? 0;
      seen.tokensOut += body?.usage?.output_tokens ?? 0;
    }
    return res;
  } catch (e) {
    seen.lastFailure = "network";
    throw e;
  }
}) as typeof fetch;

const redact = (s: string) => (KEY ? s.split(KEY).join("[key]") : s);
let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => { failures += 1; console.log(`  FAIL  ${redact(m)}`); };
const info = (m: string) => console.log(`        ${redact(m)}`);
const check = (ok: boolean, m: string) => (ok ? pass(m) : bad(m));

/** Turns an SDK error into "what to change". */
function explain(e: unknown): string {
  const status = (e as { status?: number }).status;
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401) return "Authentication failed (401): ANTHROPIC_API_KEY is invalid or revoked. Create a new key at console.anthropic.com and update it.";
  if (status === 403) return "Permission denied (403): this key's workspace cannot use the model or API. Check the workspace and billing.";
  if (status === 404) return "Model not found or not available (404): set ANTHROPIC_MODEL to a model your account can use (the default is in lib/ai/config.ts).";
  if (status === 429) return "Rate limited (429): wait a minute and retry, or check usage limits and billing in the Anthropic console.";
  if (status === 529) return "Anthropic is overloaded (529): not your fault. Retry in a few minutes.";
  if (status && status >= 500) return `Anthropic server error (${status}): retry shortly.`;
  if (/Connection error|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg) || seen.lastFailure === "network") return "Network error: cannot reach api.anthropic.com. Check internet, proxy or firewall.";
  if (/timeout|timed out|abort/i.test(msg)) return "Timed out after 90 seconds. Retry, or set a faster ANTHROPIC_MODEL.";
  return `Unexpected error: ${msg.slice(0, 200)}`;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "retry-after-ms": "0", ...extra } });
const message = (text: string) => ({
  id: "msg_fixture", type: "message", role: "assistant", model: "fixture", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 50 },
});
const errorBody = (type: string, m: string) => ({ type: "error", error: { type, message: m } });

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

async function main() {
  // The real code reads these when first used.
  const offlineKey = KEY || "sk-ant-offline-fixture-key";
  process.env.ANTHROPIC_API_KEY = offlineKey;
  const { CLAUDE_MODEL, resetAiUsage } = await import("../lib/ai/config");
  const { diagnose } = await import("../lib/ai/diagnosis");
  const { DIAGNOSIS_FIXTURES, SCENARIO_INTAKE } = await import("../lib/ai/fixtures");
  const { DiagnosisSchema } = await import("../lib/ai/schemas");
  const { modelToolSpecs, TOOLS } = await import("../lib/agent/tools");

  console.log("\nai:check\n");
  console.log("Part 1: offline checks (no key needed)");

  check(typeof CLAUDE_MODEL === "string" && CLAUDE_MODEL.length > 3, `model constant defined: ${CLAUDE_MODEL}${process.env.ANTHROPIC_MODEL ? " (from ANTHROPIC_MODEL)" : " (default)"}`);

  const specs = modelToolSpecs();
  const specProblems: string[] = [];
  for (const s of specs) {
    const sch = s.input_schema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s.name)) specProblems.push(`${s.name}: bad name`);
    if (!s.description) specProblems.push(`${s.name}: no description`);
    if (sch.type !== "object") specProblems.push(`${s.name}: input_schema.type is not "object"`);
    if (sch.properties && sch.required?.some((r) => !(r in sch.properties!))) specProblems.push(`${s.name}: required lists an unknown property`);
    try { JSON.parse(JSON.stringify(s)); } catch { specProblems.push(`${s.name}: not serialisable`); }
  }
  check(specProblems.length === 0, `${specs.length} tool definitions are valid Anthropic tool-use format${specProblems.length ? `: ${specProblems.join("; ")}` : ""}`);
  check(!specs.some((s) => s.name === "create_paypal_order") && TOOLS.some((t) => t.name === "create_paypal_order"), "create_paypal_order exists but is never offered to the model");

  // Drive the REAL diagnose() against a stubbed API, in live mode.
  process.env.DEMO_MODE = "false";
  const intake = { ...SCENARIO_INTAKE["cracked-screen"], scenario: undefined as string | undefined };
  const goodJson = JSON.stringify(DIAGNOSIS_FIXTURES["cracked-screen"]);
  const run = async (s: Stub) => { stub = s; resetAiUsage(); try { return { ok: true as const, v: await diagnose(intake) }; } catch (e) { return { ok: false as const, e }; } finally { stub = null; } };

  const good = await run(() => json(message(goodJson)));
  check(good.ok && DiagnosisSchema.safeParse(good.v.diagnosis).success && good.v.source === "claude", "realistic response parses and passes the safety gate");

  const prose = await run(() => json(message(`Sure, here is my diagnosis:\n\`\`\`json\n${goodJson}\n\`\`\`\nHope this helps!`)));
  if (prose.ok) pass("response with prose around the JSON is handled");
  else info(`prose around JSON is rejected with: "${prose.e instanceof Error ? prose.e.message : prose.e}"`);
  check(prose.ok || (prose.e instanceof Error && !/Unexpected|JSON|position/i.test(prose.e.message)), "prose-wrapped response never surfaces a raw parser error");

  const malformed = await run(() => json(message(`{"summary": "cut off`)));
  check(!malformed.ok && malformed.e instanceof Error && !/Unexpected|JSON|position/i.test(malformed.e.message), `malformed response fails safely with a friendly message${!malformed.ok && malformed.e instanceof Error ? `: "${malformed.e.message}"` : ""}`);

  const wrongShape = await run(() => json(message(JSON.stringify({ summary: "x" }))));
  check(!wrongShape.ok, "response with the wrong shape is rejected");

  for (const [status, type, want] of [[401, "authentication_error", "401"], [404, "not_found_error", "404"], [429, "rate_limit_error", "429"], [529, "overloaded_error", "529"]] as const) {
    const r = await run(() => json(errorBody(type, "fixture"), status));
    check(!r.ok && explain(r.e).includes(want), `HTTP ${status} is explained: ${r.ok ? "(no error)" : explain(r.e).slice(0, 90)}…`);
  }
  const net = await run(() => { throw new TypeError("fetch failed"); });
  check(!net.ok && /Network error/.test(explain(net.e)), "network failure is explained");

  console.log("\nPart 2: live run");
  if (!LIVE) {
    console.log("  SKIP  live stages. To run them: set ANTHROPIC_API_KEY, set DEMO_MODE=false, then npm run ai:check");
    console.log(`        (cost control: set ANTHROPIC_MODEL to a cheaper model; currently ${CLAUDE_MODEL})`);
    return finish();
  }
  process.env.DEMO_MODE = "false";
  seen.anthropic = 0;
  resetAiUsage();
  console.log(`  model: ${CLAUDE_MODEL}  (set ANTHROPIC_MODEL to use a cheaper one)  cap: ${MAX_CALLS} calls, ${TIMEOUT_MS / 1000}s`);

  // Stage: auth + diagnosis
  let authOk = false;
  try {
    const d = await withTimeout(diagnose({ ...SCENARIO_INTAKE["cracked-screen"], scenario: undefined } as never), TIMEOUT_MS, "diagnosis");
    authOk = true;
    pass("auth: API key accepted");
    check(d.source === "claude", "diagnosis came from Claude (not the scripted fixture)");
    check(DiagnosisSchema.safeParse(d.diagnosis).success, "diagnosis schema valid");
    const { isDiyAllowed } = await import("../lib/ai/safety");
    check(d.diagnosis.diy_allowed === isDiyAllowed(d.diagnosis) && Array.isArray(d.diagnosis.gate_notes), `safety gate applied (diy_allowed=${d.diagnosis.diy_allowed}, path=${d.diagnosis.recommended_path})`);
  } catch (e) {
    bad(`diagnosis failed. ${explain(e)}`);
    return finish();
  }

  // Stage: agent run
  const { db } = await import("../lib/db");
  const { runAgent } = await import("../lib/agent/runner");
  const owner = await db.owner.findFirst();
  if (!owner) { bad("No owner in the database. Run: npm run db:seed"); return finish(); }
  const events: { type: string; [k: string]: unknown }[] = [];
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), TIMEOUT_MS + 5000);
  let result: { runId: string; status: string } | null = null;
  try {
    result = await runAgent({
      goal: "My Samsung Galaxy A52 screen is cracked, fix it under $60 this weekend.",
      budgetCents: 6000,
      ownerId: owner.id,
      signal: ac.signal,
      emit: (e) => events.push(e as never),
      forceMode: "live",
      timeoutMs: TIMEOUT_MS,
    });
  } catch (e) {
    bad(`agent run crashed. ${explain(e)}`);
  } finally {
    clearTimeout(killer);
  }
  if (result) {
    const errEvent = events.find((e) => e.type === "error");
    if (errEvent) bad(`agent run reported an error. ${seen.lastFailure ? explain(Object.assign(new Error(seen.lastFailure), { status: Number(/\d+/.exec(seen.lastFailure)?.[0]) || undefined })) : String(errEvent.message)}`);
    const steps = events.filter((e) => e.type === "step") as unknown as { tool: string; status: string }[];
    info(`tool calls: ${steps.map((s) => `${s.tool}:${s.status}`).join(" > ") || "none"}`);
    check(steps.some((s) => s.tool === "request_user_approval" && s.status === "ok") && result.status === "awaiting_approval", `tool loop reached request_user_approval (run status: ${result.status})`);
    const run = await db.agentRun.findUnique({ where: { id: result.runId } });
    const job = run?.jobId ? await db.job.findUnique({ where: { id: run.jobId } }) : null;
    check(!!job && !job.paypalOrderId && seen.paypal === 0, "no PayPal order created (job has no order id, no PayPal request was attempted)");
  }
  await db.$disconnect();
  void authOk;
  return finish();
}

function finish() {
  console.log(`\nAPI calls made to Anthropic: ${seen.anthropic}/${MAX_CALLS}`);
  if (LIVE && seen.tokensIn + seen.tokensOut > 0) {
    console.log(`Tokens: ${seen.tokensIn} in, ${seen.tokensOut} out`);
    const pin = Number(process.env.AI_PRICE_INPUT_PER_MTOK);
    const pout = Number(process.env.AI_PRICE_OUTPUT_PER_MTOK);
    if (pin > 0 && pout > 0) console.log(`Approximate cost: $${((seen.tokensIn * pin + seen.tokensOut * pout) / 1e6).toFixed(4)} (using your AI_PRICE_* values)`);
    else console.log("Cost: set AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK (USD per million tokens, from anthropic.com/pricing) to get an estimate.");
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(redact(`ai:check crashed: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
