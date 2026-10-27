"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed.");
  return json as T;
}

interface Props {
  jobId: string;
  /** Public sandbox client id; null means PayPal is simulated locally. */
  clientId: string | null;
}

export function PayPalCheckout({ jobId, clientId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const authorize = async (orderId: string) => {
    await post(`/api/paypal/orders/${encodeURIComponent(orderId)}/authorize`, { jobId });
    toast.success("Payment authorized. Funds are held until the repair is verified.");
    router.refresh();
  };

  if (!clientId) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          PayPal simulation: no sandbox credentials are configured, so this button runs the same server flow without contacting PayPal.
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const order = await post<{ id: string }>("/api/paypal/orders", { jobId });
              await authorize(order.id);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Payment failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Authorizing…" : "Approve and pay (simulated PayPal)"}
        </Button>
      </div>
    );
  }

  return (
    <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "authorize" }}>
      <PayPalButtons
        style={{ layout: "vertical", shape: "rect", label: "pay" }}
        createOrder={async () => (await post<{ id: string }>("/api/paypal/orders", { jobId })).id}
        onApprove={async (data) => {
          try {
            await authorize(data.orderID);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Authorization failed.");
          }
        }}
        onCancel={() => toast("Payment cancelled. Nothing was charged; you can try again.")}
        onError={() => toast.error("PayPal could not complete the checkout. Nothing was charged.")}
      />
    </PayPalScriptProvider>
  );
}
