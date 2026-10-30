"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base";
const SKILLS = ["phone", "laptop", "tablet", "tv", "appliance", "other"] as const;

type Errors = Record<string, string>;
type Result = { ok?: boolean; redirect?: string; error?: string; fields?: Errors };

async function post(url: string, body: unknown): Promise<Result & { status: number }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ...((await res.json().catch(() => ({}))) as Result), status: res.status };
  } catch {
    return { error: "Could not reach the server. Check your connection and try again.", status: 0 };
  }
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

const describe = (id: string, e?: Errors, hint?: boolean) => (e?.[id.split("-").pop()!] ? `${id}-err` : hint ? `${id}-hint` : undefined);

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const r = await post("/api/auth/login", { email: f.get("email"), password: f.get("password"), next });
    if (r.ok && r.redirect) {
      router.push(r.redirect);
      router.refresh();
      return;
    }
    setError(r.error ?? "Email or password is incorrect.");
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>}
      <Field id={`${uid}-email`} label="Email"><input id={`${uid}-email`} name="email" type="email" autoComplete="email" required maxLength={254} className={field} /></Field>
      <Field id={`${uid}-password`} label="Password"><input id={`${uid}-password`} name="password" type="password" autoComplete="current-password" required maxLength={128} className={field} /></Field>
      <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const uid = useId();
  const [role, setRole] = useState<"owner" | "technician">("owner");
  const [skills, setSkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErrors({});
    const body: Record<string, unknown> = { role, name: f.get("name"), email: f.get("email"), password: f.get("password"), next };
    if (role === "technician") {
      Object.assign(body, { skills, area: f.get("area"), payoutEmail: f.get("payoutEmail") });
      // Obvious gaps are reported here without a request; the server re-validates everything anyway.
      const missing: Errors = {};
      if (skills.length === 0) missing.skills = "Choose at least one device type.";
      if (!String(f.get("area") ?? "").trim()) missing.area = "Enter your city or area.";
      if (!String(f.get("payoutEmail") ?? "").trim()) missing.payoutEmail = "Enter your PayPal sandbox email.";
      if (Object.keys(missing).length) {
        setErrors(missing);
        setBusy(false);
        return;
      }
    }
    const r = await post("/api/auth/signup", body);
    if (r.ok && r.redirect) {
      router.push(r.redirect);
      router.refresh();
      return;
    }
    setErrors({ ...(r.fields ?? {}), ...(r.fields ? {} : { form: r.error ?? "Could not create the account." }) });
    setBusy(false);
  }
  const id = (n: string) => `${uid}-${n}`;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-tour="signup-form">
      {errors.form && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{errors.form}</p>}
      <fieldset className="space-y-2" data-tour="signup-roles">
        <legend className="font-medium">I am joining as</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["owner", "Owner", "I have a broken device and want a safe, priced repair."],
            ["technician", "Technician", "I repair devices and want to be paid after the work is verified."],
          ] as const).map(([v, title, text]) => (
            <label key={v} className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border-2 p-3 ${role === v ? "border-primary bg-primary-soft" : "border-border bg-white"}`}>
              <input type="radio" name="role" value={v} checked={role === v} onChange={() => setRole(v)} className="mt-1 h-5 w-5" />
              <span><span className="block font-semibold">{title}</span><span className="block text-sm text-muted">{text}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id={id("name")} label="Name" error={errors.name}><input id={id("name")} name="name" autoComplete="name" required maxLength={200} aria-invalid={!!errors.name} aria-describedby={describe(id("name"), errors)} className={field} /></Field>
      <Field id={id("email")} label="Email" error={errors.email}><input id={id("email")} name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={!!errors.email} aria-describedby={describe(id("email"), errors)} className={field} /></Field>
      <Field id={id("password")} label="Password" error={errors.password} hint="10 to 128 characters. Use a throwaway password: this is a demo.">
        <input id={id("password")} name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} aria-invalid={!!errors.password} aria-describedby={describe(id("password"), errors, true)} className={field} />
      </Field>
      {role === "technician" && (
        <>
          <fieldset aria-describedby={errors.skills ? id("skills-err") : undefined} className="space-y-2">
            <legend className="font-medium">Device types you repair</legend>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((s) => (
                <label key={s} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3">
                  <input type="checkbox" checked={skills.includes(s)} onChange={(e) => setSkills(e.target.checked ? [...skills, s] : skills.filter((x) => x !== s))} className="h-5 w-5" />
                  {s}
                </label>
              ))}
            </div>
            {errors.skills && <p id={id("skills-err")} className="text-sm font-medium text-danger">{errors.skills}</p>}
          </fieldset>
          <Field id={id("area")} label="Your city or area" error={errors.area}><input id={id("area")} name="area" autoComplete="address-level2" required maxLength={80} aria-invalid={!!errors.area} aria-describedby={describe(id("area"), errors)} className={field} /></Field>
          <Field id={id("payoutEmail")} label="PayPal sandbox email for payouts" error={errors.payoutEmail} hint="Sandbox only: no real money moves.">
            <input id={id("payoutEmail")} name="payoutEmail" type="email" required maxLength={254} aria-invalid={!!errors.payoutEmail} aria-describedby={describe(id("payoutEmail"), errors, true)} className={field} />
          </Field>
        </>
      )}
      <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}

export function GuestButton({ next }: { next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    setError("");
    const r = await post("/api/auth/guest", { next });
    if (r.ok && r.redirect) {
      router.push(r.redirect);
      router.refresh();
      return;
    }
    setError(r.error ?? "Could not start a guest session.");
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={go} disabled={busy} aria-busy={busy} data-tour="guest-button">{busy ? "Starting…" : "Continue as guest (demo)"}</Button>
      <p className="text-sm text-muted">No sign-up needed. A temporary guest account is created and deleted after 24 hours.</p>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
