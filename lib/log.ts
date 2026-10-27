/**
 * Structured one-line JSON logging. Keys that look secret/PII are dropped, string values are scrubbed of
 * emails and long token-like strings. PayPal `debug_id`s are deliberately kept.
 */
type Level = "info" | "warn" | "error";

const SENSITIVE_KEY = /secret|token|password|authorization|cookie|api[-_]?key|email|address|phone|credential/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{40,})\b/g;

export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(LONG_SECRET, "[redacted]").slice(0, 300);
  if (value instanceof Error) return scrub(value.message, depth);
  if (depth > 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SENSITIVE_KEY.test(k)).map(([k, v]) => [k, scrub(v, depth + 1)]));
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
