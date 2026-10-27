/** Single place that decides which model to call and whether we are in demo (fixture) mode. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/** Max live Claude calls per UTC day (per process). Beyond it the app falls back to scripted demo mode. */
export function aiDailyCap(): number {
  const n = Number(process.env.AI_DAILY_CALL_CAP ?? 200);
  return Number.isInteger(n) && n >= 0 ? n : 200;
}

const usage = { day: "", calls: 0 };
const today = () => new Date().toISOString().slice(0, 10);
function roll() {
  if (usage.day !== today()) { usage.day = today(); usage.calls = 0; }
}

/** Call immediately before each live Claude request. */
export function recordAiCall() {
  roll();
  usage.calls += 1;
}
export const aiCallsToday = () => (roll(), usage.calls);
export const resetAiUsage = () => { usage.day = ""; usage.calls = 0; };

/** True when a key exists, DEMO_MODE=false was chosen, but today's cap is used up. */
export function aiCapReached(): boolean {
  if (process.env.DEMO_MODE === "false" && process.env.ANTHROPIC_API_KEY) return aiCallsToday() >= aiDailyCap();
  return false;
}

/** Demo mode is the default. Real AI needs DEMO_MODE=false AND an API key AND budget left under the daily cap. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== "false" || !process.env.ANTHROPIC_API_KEY || aiCapReached();
}
