"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dollarsToCents, PRESET_DONATION_CENTS } from "@/lib/donations/amount";

interface Props {
  mode: "sandbox" | "simulated";
  /** Server's PAYPAL_CLIENT_ID (public by design). Null when PayPal is simulated. */
  clientId: string | null;
  deviceId?: string;
  /** Dev-only: show the labelled "Simulate approval" button. */
  allowSimulate: boolean;
  /** Guided demo in progress: PayPal is neither loaded nor called; the payment area shows a labelled note. */
  tour?: boolean;
}

const isDev = process.env.NODE_ENV !== "production";
const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed.");
  return json as T;
}

export function DonateForm({ mode, clientId, deviceId, allowSimulate, tour }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState<number | "custom">(1000);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [popupFailed, setPopupFailed] = useState(false);
  const orderRef = useRef(""); // public id of the donation behind the PayPal order currently being approved

  const { cents, amountError } = useMemo(() => {
    if (preset !== "custom") return { cents: preset, amountError: null };
    if (!custom.trim()) return { cents: null, amountError: "Enter an amount between $1 and $500." };
    try {
      return { cents: dollarsToCents(custom), amountError: null };
    } catch (e) {
      return { cents: null, amountError: e instanceof Error ? e.message : "Invalid amount." };
    }
  }, [preset, custom]);

  const payload = () => ({ amount: (cents! / 100).toFixed(2), donorName: name, message, deviceId });
  const thanks = (publicId: string) => router.push(`/donate/thanks/${publicId}`);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Donation failed.");
    } finally {
      setBusy(false);
    }
  };

  const inTab = () =>
    run(async () => {
      const o = await post<{ approveUrl: string | null }>("/api/donations", payload());
      if (!o.approveUrl) throw new Error("PayPal did not return an approval link.");
      window.location.assign(o.approveUrl);
    });

  const simulateApproval = () =>
    run(async () => {
      const o = await post<{ publicId: string }>("/api/donations", payload());
      await post(`/api/donations/${o.publicId}/simulate`);
      thanks(o.publicId);
    });

  const simulatedPaypal = () =>
    run(async () => {
      const o = await post<{ publicId: string; id: string }>("/api/donations", payload());
      await post(`/api/donations/${o.publicId}/capture`, { orderId: o.id });
      thanks(o.publicId);
    });


  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="font-medium">Amount (USD)</legend>
        <div className="flex flex-wrap gap-2">
          {PRESET_DONATION_CENTS.map((c) => (
            <label key={c} className={`flex min-h-11 cursor-pointer items-center rounded-lg border px-4 font-semibold ${preset === c ? "border-primary bg-primary-soft" : "border-border bg-white"}`}>
              <input type="radio" name="amount" className="sr-only" checked={preset === c} onChange={() => setPreset(c)} />${c / 100}
            </label>
          ))}
          <label className={`flex min-h-11 cursor-pointer items-center rounded-lg border px-4 font-semibold ${preset === "custom" ? "border-primary bg-primary-soft" : "border-border bg-white"}`}>
            <input type="radio" name="amount" className="sr-only" checked={preset === "custom"} onChange={() => setPreset("custom")} />Custom
          </label>
        </div>
        {preset === "custom" && (
          <div>
            <label htmlFor="custom" className="text-sm text-muted">Custom amount, $1 to $500</label>
            <input id="custom" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className={field} placeholder="15.00" aria-invalid={!!amountError} aria-describedby="amount-error" />
          </div>
        )}
        <p id="amount-error" role="alert" className="min-h-5 text-sm text-danger">{preset === "custom" ? amountError : ""}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="donorName" className="font-medium">Your name (optional)</label>
          <input id="donorName" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={field} autoComplete="name" />
          <p className="text-xs text-muted">Only your first name is shown publicly. Blank means &ldquo;Anonymous&rdquo;. Your certificate uses the name you type.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="message" className="font-medium">Message (optional)</label>
          <input id="message" value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} className={field} />
        </div>
      </div>

      {tour ? (
        <p data-tour="donate-tour-note" className="rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
          <strong>Tour simulation.</strong> The PayPal donation button is not loaded during the guided demo, so nothing here can reach PayPal. Finish the tour to donate with the real sandbox.
        </p>
      ) : mode === "sandbox" && clientId ? (
        <div className="space-y-3">
          {/* Own namespace + intent=capture: never shares an SDK instance with the job pages (intent=authorize). */}
          <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture", dataNamespace: "paypal_donate" }}>
            <PayPalButtons
              key={`${cents}`}
              disabled={cents === null || busy}
              forceReRender={[cents, name, message]}
              style={{ layout: "vertical", shape: "rect", label: "donate" }}
              createOrder={async () => {
                if (cents === null) throw new Error(amountError ?? "Invalid amount.");
                const o = await post<{ publicId: string; id: string }>("/api/donations", payload());
                orderRef.current = o.publicId;
                return o.id;
              }}
              onApprove={async (data) => {
                try {
                  const r = await post<{ status: string }>(`/api/donations/${orderRef.current}/capture`, { orderId: data.orderID });
                  if (r.status === "failed") throw new Error("The donation could not be completed.");
                  thanks(orderRef.current);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Donation failed.");
                }
              }}
              onCancel={() => toast("Donation cancelled. Nothing was charged.")}
              onError={(err) => {
                const msg = err instanceof Error ? err.message : String(err);
                void fetch("/api/paypal/client-error", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: err instanceof Error ? err.name : "PayPalError", message: `[donation] ${msg}`.slice(0, 500), debugId: /debug[_\s-]?id[:=\s"]*([A-Za-z0-9]+)/i.exec(msg)?.[1] }),
                }).catch(() => {});
                setPopupFailed(true);
                toast.error(`PayPal could not complete the donation. Nothing was charged. Try "Continue to PayPal in this tab".${isDev ? ` [dev: ${msg.slice(0, 120)}]` : ""}`);
              }}
            />
          </PayPalScriptProvider>
          <div className="text-sm">
            <p className={popupFailed ? "font-medium" : "text-muted"}>{popupFailed ? "The popup failed." : "Popup blocked or tracking prevention in the way?"} Use the full-page flow:</p>
            <Button variant="outline" disabled={cents === null || busy} onClick={inTab} className="mt-2">{busy ? "Opening PayPal…" : "Continue to PayPal in this tab"}</Button>
          </div>
          {allowSimulate && (
            <div className="rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3 text-sm">
              <p className="mb-2 font-semibold">DEV ONLY: skip PayPal approval</p>
              <Button variant="outline" disabled={cents === null || busy} onClick={simulateApproval}>Simulate approval (SIMULATED donation)</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">PayPal simulation: no sandbox credentials are configured, so this runs the same server flow without contacting PayPal. The donation will be tagged SIMULATED.</p>
          <Button disabled={cents === null || busy} onClick={simulatedPaypal}>{busy ? "Donating…" : "Donate (simulated PayPal)"}</Button>
        </div>
      )}
    </div>
  );
}
