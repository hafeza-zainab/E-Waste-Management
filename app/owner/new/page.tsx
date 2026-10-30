import { createDevice } from "../actions";
import { requirePrincipal } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/submit-button";
import { SCENARIO_INTAKE, type ScenarioKey } from "@/lib/ai/fixtures";
import { DEVICE_TYPES } from "@/lib/ai/schemas";

const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base";

export const metadata = { title: "Diagnose a device" };

export default async function NewDevicePage(props: PageProps<"/owner/new">) {
  const sp = await props.searchParams;
  const scenarioParam = typeof sp.scenario === "string" ? sp.scenario : undefined;
  await requirePrincipal("owner", `/owner/new${scenarioParam && /^[a-z-]{1,40}$/.test(scenarioParam) ? `?scenario=${scenarioParam}` : ""}`);
  const scenario = scenarioParam && scenarioParam in SCENARIO_INTAKE ? (scenarioParam as ScenarioKey) : undefined;
  const pre = scenario ? SCENARIO_INTAKE[scenario] : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Diagnose a device</h1>
        <p className="mt-1 text-muted">
          Tell us what is wrong. The AI checks likely causes, severity and, first of all, whether it is safe to touch.
        </p>
      </div>
      {pre && (
        <p className="rounded-lg bg-primary-soft px-4 py-3 text-sm">
          Demo scenario loaded. The device details are fixed to the scenario so every page shows the same device. Edit the problem if you like and press <strong>Diagnose</strong>, or <a className="underline" href="/owner/new">enter your own device</a>.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}
      <Card>
        <form action={createDevice} className="space-y-5">
          {scenario && <input type="hidden" name="scenario" value={scenario} />}
          {pre && <input type="hidden" name="type" value={pre.type} />}
          <div className="space-y-1">
            <label htmlFor="type" className="font-medium">Device type</label>
            <select id="type" name="type" defaultValue={pre?.type ?? "phone"} className={field} required autoComplete="off" disabled={!!pre}>
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="brand" className="font-medium">Brand</label>
              <input id="brand" name="brand" defaultValue={pre?.brand} maxLength={60} required readOnly={!!pre} autoComplete="off" className={field} />
            </div>
            <div className="space-y-1">
              <label htmlFor="model" className="font-medium">Model</label>
              <input id="model" name="model" defaultValue={pre?.model} maxLength={80} required readOnly={!!pre} autoComplete="off" className={field} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="ageYears" className="font-medium">Age in years</label>
            <input id="ageYears" name="ageYears" type="number" min={0} max={40} defaultValue={pre?.ageYears ?? 2} required readOnly={!!pre} autoComplete="off" className={field} />
          </div>
          <div className="space-y-1">
            <label htmlFor="problem" className="font-medium">What is the problem?</label>
            <textarea id="problem" name="problem" rows={4} minLength={10} maxLength={1500} defaultValue={pre?.problem} required className={`${field} py-2`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="photo" className="font-medium">Photo (optional)</label>
            <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" />
            <p className="text-sm text-muted">JPEG, PNG or WebP, up to 4 MB.</p>
          </div>
          <SubmitButton tour="diagnose" pendingText="Diagnosing…">Diagnose</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
