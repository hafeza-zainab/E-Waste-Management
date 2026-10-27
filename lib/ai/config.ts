/** Single place that decides which model to call and whether we are in demo (fixture) mode. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/** Demo mode is the default. Real AI needs DEMO_MODE=false AND an API key. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== "false" || !process.env.ANTHROPIC_API_KEY;
}
