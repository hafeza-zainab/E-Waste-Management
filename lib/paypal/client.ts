/**
 * Minimal PayPal REST client. SANDBOX ONLY: the base URL is hard-coded so the
 * app can never move real money. Secrets are read from the environment and are
 * never logged.
 */
import { log } from "@/lib/log";

export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

export type PaypalMode = "sandbox" | "simulated";

/** "sandbox" when credentials exist; otherwise a clearly labelled local simulation. */
export function paypalMode(): PaypalMode {
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "simulated";
}

export const isSimulatedId = (id: string | null | undefined) => !!id && id.startsWith("SIM-");

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public issue?: string,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new PayPalError("PayPal rejected the sandbox credentials.", res.status);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
}

/** Authenticated JSON call. Pass `requestId` for idempotent POSTs (PayPal-Request-Id). */
export async function paypalFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; requestId?: string } = {},
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T & PayPalErrorBody) : ({} as T & PayPalErrorBody);
  if (!res.ok) {
    const issue = json.details?.[0]?.issue;
    // Log identifiers only: never tokens, headers or credentials.
    log.error("paypal_error", { method: init.method ?? "GET", path: path.replace(/\/[A-Z0-9-]{10,}/g, "/:id"), status: res.status, name: json.name, issue, debug_id: json.debug_id });
    throw new PayPalError(json.details?.[0]?.description ?? json.message ?? "PayPal request failed.", res.status, issue, json.debug_id);
  }
  return json;
}
