/**
 * CSRF defence for route handlers: a state-changing request must come from this app's own origin.
 * Browsers always send Origin (or at least Referer) on cross-site POSTs and page scripts cannot forge either.
 * Server Actions have the same check built into Next.js; this covers the /api routes (see proxy.ts).
 */
type H = { get(n: string): string | null };

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function allowedHosts(headers: H, env: Record<string, string | undefined> = process.env): Set<string> {
  const out = new Set<string>();
  const host = headers.get("host")?.toLowerCase();
  if (host) out.add(host);
  for (const u of [env.NEXT_PUBLIC_APP_URL, env.RENDER_EXTERNAL_URL]) {
    const h = hostOf(u);
    if (h) out.add(h);
  }
  return out;
}

/** True when the Origin (else Referer) host is one of ours. A state-changing request with neither is rejected. */
export function isSameOrigin(method: string, headers: H, env: Record<string, string | undefined> = process.env): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const origin = headers.get("origin");
  const source = origin ? (origin === "null" ? null : hostOf(origin)) : hostOf(headers.get("referer"));
  return !!source && allowedHosts(headers, env).has(source);
}

/** PayPal calls this server-to-server with no Origin; it is authenticated by signature verification instead. */
export const csrfExempt = (pathname: string) => pathname === "/api/paypal/webhook";
