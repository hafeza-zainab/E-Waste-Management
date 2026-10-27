/**
 * Dev diagnostics for the PayPal sandbox integration. Run: npm run paypal:check
 * Prints identifiers and pass/fail only. It never prints the secret or any access token.
 */
import { PAYPAL_BASE } from "../lib/paypal/client";
import { appBaseUrl, approveLink, buildOrderPayload } from "../lib/paypal/orders";

const id = process.env.PAYPAL_CLIENT_ID ?? "";
const secret = process.env.PAYPAL_CLIENT_SECRET ?? "";
const publicId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => console.log(`  FAIL  ${m}`);
const info = (m: string) => console.log(`        ${m}`);

async function main() {
  console.log(`\nPayPal sandbox check\n  host: ${new URL(PAYPAL_BASE).host} (sandbox is hard-coded in lib/paypal/client.ts)`);

  console.log("\n1. Credentials");
  if (!id || !secret) {
    bad("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are empty. The app then runs in SIMULATED mode and never opens PayPal.");
    return;
  }
  ok(`server client id present (${id.length} chars, starts ${id.slice(0, 6)}…)`);

  console.log("\n2. Browser SDK client id vs server app");
  if (!publicId) ok("NEXT_PUBLIC_PAYPAL_CLIENT_ID is empty; the job page uses the server's PAYPAL_CLIENT_ID for the SDK, so they cannot differ.");
  else if (publicId === id) ok("NEXT_PUBLIC_PAYPAL_CLIENT_ID is identical to PAYPAL_CLIENT_ID.");
  else bad("NEXT_PUBLIC_PAYPAL_CLIENT_ID DIFFERS from PAYPAL_CLIENT_ID (the page ignores it, but remove or fix it to avoid confusion).");

  console.log("\n3. OAuth token");
  const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) {
    bad(`token request rejected: HTTP ${tokenRes.status}. The client id/secret are wrong or belong to a LIVE app.`);
    return;
  }
  const t = (await tokenRes.json()) as { access_token: string; scope?: string; app_id?: string };
  ok(`token issued, app_id=${t.app_id ?? "n/a"}`);
  const scopes = (t.scope ?? "").split(" ").map((s) => s.replace("https://uri.paypal.com/services/", ""));
  info(`scopes: ${scopes.join(", ")}`);
  const payouts = scopes.some((s) => s.includes("payments/payouts"));
  (payouts ? ok : bad)(`Payouts permission ${payouts ? "is" : "is NOT"} in the token scopes${payouts ? "" : " (enable Payouts on the app, see README)"}`);

  const create = async (label: string, body: unknown) => {
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": `check-${Date.now()}-${Math.random()}` },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { id?: string; status?: string; links?: { rel: string; href: string }[]; name?: string; debug_id?: string; details?: { issue?: string; description?: string }[] };
    if (!r.ok) {
      bad(`${label}: HTTP ${r.status} ${j.name ?? ""} ${j.details?.[0]?.issue ?? ""} ${j.details?.[0]?.description ?? ""} debug_id=${j.debug_id ?? "n/a"}`);
      return;
    }
    ok(`${label}: order ${j.id} status=${j.status}`);
    const link = approveLink(j);
    info(`approve link (open it in Chrome Incognito and log in as a US *Personal* sandbox buyer):\n        ${link ?? "none returned"}`);
  };

  console.log("\n4. Minimal AUTHORIZE order, 1.00 USD");
  await create("minimal order", {
    intent: "AUTHORIZE",
    purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }],
    payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: `${appBaseUrl()}/check/return`, cancel_url: `${appBaseUrl()}/check/cancel` } } },
  });

  console.log("\n5. The app's real payload shape (sample quote)");
  const quote = {
    technicianId: "t", technicianName: "Check", matchReasons: [], pickup: true,
    lines: [
      { kind: "part" as const, label: "Screen assembly", cents: 3999 },
      { kind: "labor" as const, label: "Labor, 1 h at $18.00/h", cents: 1800 },
      { kind: "logistics" as const, label: "Pickup and delivery (2.1 km)", cents: 484 },
    ],
    partsCents: 3999, laborCents: 1800, logisticsCents: 484, totalCents: 6283, platformFeeCents: 628, technicianPayoutCents: 5655,
  };
  const payload = buildOrderPayload("check-job", "ReLoop repair check", quote, appBaseUrl());
  info(`payload: ${JSON.stringify(payload)}`);
  await create("app-shaped order", payload);

  console.log("\nSDK script must use intent=authorize&currency=USD (components/paypal-checkout.tsx sets both).");
  console.log("If both orders were created but the buyer popup still shows genericError, the app is not at fault: use the approve link above in Incognito with a fresh US Personal sandbox account.\n");
}

main().catch((e) => {
  console.error("check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
