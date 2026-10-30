/**
 * `?next=` may only be a same-origin relative path. Absolute URLs, protocol-relative `//host`, backslash tricks,
 * control characters and the auth/API routes themselves fall back to the role's home.
 */
export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 500) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  if (/^\/(login|signup|api)(\/|\?|$)/.test(next)) return fallback;
  try {
    if (new URL(next, "http://app.invalid").origin !== "http://app.invalid") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

export const homeFor = (role: string) => (role === "technician" ? "/technician" : "/owner");
