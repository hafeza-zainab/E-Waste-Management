import { Card } from "@/components/ui/card";
import { DEFAULT_DEMO_PASSWORD, DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL } from "@/lib/auth/constants";

/** Public sample credentials only. A private host override is never rendered. */
export function JudgeDemoAccounts() {
  const privatePassword = process.env.DEMO_ACCOUNT_PASSWORD && process.env.DEMO_ACCOUNT_PASSWORD !== DEFAULT_DEMO_PASSWORD;
  return (
    <Card role="region" aria-labelledby="judge-demo-title" className="space-y-3 border-primary bg-primary-soft">
      <h2 id="judge-demo-title" className="text-lg font-bold">Judge demo accounts</h2>
      <p className="text-sm">These accounts contain sample data, including simulated payments and payouts.</p>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-semibold">Owner email</dt><dd className="break-all"><code>{DEMO_OWNER_EMAIL}</code></dd></div>
        <div><dt className="font-semibold">Technician email</dt><dd className="break-all"><code>{DEMO_TECH_EMAIL}</code></dd></div>
        <div><dt className="font-semibold">Password for both accounts</dt><dd className="break-all">{privatePassword ? "The host has set a private password. Ask the host for judge access." : <code>{DEFAULT_DEMO_PASSWORD}</code>}</dd></div>
      </dl>
      <p className="text-sm">Log in to browse devices, completed repairs, the technician CV and impact totals. No account setup needed.</p>
    </Card>
  );
}
