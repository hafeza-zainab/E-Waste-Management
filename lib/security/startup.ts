export interface StartupReport {
  modes: { env: string; paypal: "sandbox" | "simulated"; ai: "live" | "scripted"; demoActions: boolean; simulatedApproval: boolean; donations: string };
  warnings: string[];
  /** Env overrides the self-check applies (e.g. force simulated approval off in production). */
  forced: Record<string, string>;
}

/** Pure: inspects an environment and says what is active. Never includes secret values. */
export function evaluateStartup(env: Record<string, string | undefined>): StartupReport {
  const prod = env.NODE_ENV === "production";
  const hasPaypal = !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET;
  const aiLive = env.DEMO_MODE === "false" && !!env.ANTHROPIC_API_KEY;
  const warnings: string[] = [];
  const forced: Record<string, string> = {};

  let simulatedApproval = env.PAYPAL_SIMULATE_APPROVAL === "true";
  if (prod && simulatedApproval) {
    // Refuse: the simulated buyer approval skips PayPal and must never exist on a hosted deployment.
    forced.PAYPAL_SIMULATE_APPROVAL = "false";
    simulatedApproval = false;
    warnings.push("PAYPAL_SIMULATE_APPROVAL=true was ignored because NODE_ENV=production. Simulated approval is disabled.");
  }
  if (prod && !hasPaypal) warnings.push("PayPal credentials are missing in production: donations are switched off and checkout is a labelled local simulation.");
  if (prod && !env.PAYPAL_WEBHOOK_ID) warnings.push("PAYPAL_WEBHOOK_ID is not set: PayPal webhooks will be rejected (the in-app flows still work).");
  if (prod && !env.NEXT_PUBLIC_APP_URL && !env.RENDER_EXTERNAL_URL) warnings.push("NEXT_PUBLIC_APP_URL is not set: PayPal return URLs and the CV QR code will point at localhost.");
  if (env.DEMO_MODE === "false" && !env.ANTHROPIC_API_KEY) warnings.push("DEMO_MODE=false but ANTHROPIC_API_KEY is missing: the app stays in scripted demo mode.");

  return {
    modes: {
      env: prod ? "production" : "development",
      paypal: hasPaypal ? "sandbox" : "simulated",
      ai: aiLive ? "live" : "scripted",
      demoActions: env.DEMO_ACTIONS === "true",
      simulatedApproval,
      donations: hasPaypal ? "sandbox" : prod ? "unavailable" : "simulated",
    },
    warnings,
    forced,
  };
}
