"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

class ApiError extends Error {
  constructor(message: string, public debugId?: string) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json as { error?: string }).error ?? "Request failed.", (json as { debugId?: string }).debugId);
  return json as T;
}

const isDev = process.env.NODE_ENV !== "production";

interface Props {
  jobId: string;
  /** Public sandbox client id (the server's own PAYPAL_CLIENT_ID); null means PayPal is simulated locally. */
  clientId: string | null;
  /**
   * Agent-built jobs: returns a fresh single-use approval token (minted by the user's Approve click endpoint)
   * for each PayPal order creation. Plain jobs omit this.
   */
  getApprovalToken?: () => Promise<string>;
}

export function PayPalCheckout({ jobId, clientId, getApprovalToken }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [popupFailed, setPopupFailed] = useState(false);

  const orderBody = async () => ({ jobId, ...(getApprovalToken ? { approvalToken: await getApprovalToken() } : {}) });

  const authorize = async (orderId: string) => {
    await post(`/api/paypal/orders/${encodeURIComponent(orderId)}/authorize`, { jobId });
    toast.success("Payment authorized. Funds are held until the repair is verified.");
    router.refresh();
  };

  /** Full-page flow: works when the popup is blocked or the browser's tracking prevention breaks it. */
  const continueInTab = async () => {
    setBusy(true);
    try {
      const order = await post<{ id: string; approveUrl: string | null }>("/api/paypal/orders", await orderBody());
      if (!order.approveUrl) throw new Error("PayPal did not return an approval link.");
      window.location.assign(order.approveUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start PayPal.");
      setBusy(false);
    }
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
              const order = await post<{ id: string }>("/api/paypal/orders", await orderBody());
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
    <div className="space-y-3">
      <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "authorize" }}>
        <PayPalButtons
          style={{ layout: "vertical", shape: "rect", label: "pay" }}
          createOrder={async () => (await post<{ id: string }>("/api/paypal/orders", await orderBody())).id}
          onApprove={async (data) => {
            try {
              await authorize(data.orderID);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Authorization failed.");
            }
          }}
          onCancel={() => toast("Payment cancelled. Nothing was charged; you can try again.")}
          onError={(err) => {
            const message = err instanceof Error ? err.message : String(err);
            const debugId = (err instanceof ApiError && err.debugId) || /debug[_\s-]?id[:=\s"]*([A-Za-z0-9]+)/i.exec(message)?.[1];
            const name = err instanceof Error ? err.name : "PayPalError";
            void fetch("/api/paypal/client-error", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, message: message.slice(0, 500), debugId: debugId || undefined, jobId }),
            }).catch(() => {});
            setPopupFailed(true);
            toast.error(`PayPal could not complete the checkout. Nothing was charged. Try "Continue to PayPal in this tab".${isDev ? ` [dev: ${name}${debugId ? `, debug id ${debugId}` : ""}]` : ""}`);
          }}
        />
      </PayPalScriptProvider>
      <div className="text-sm">
        <p className={popupFailed ? "font-medium" : "text-muted"}>
          {popupFailed ? "The popup failed." : "Popup blocked, or your browser's tracking prevention interferes?"} Use the full-page flow instead:
        </p>
        <Button variant="outline" disabled={busy} onClick={continueInTab} className="mt-2">
          {busy ? "Opening PayPal…" : "Continue to PayPal in this tab"}
        </Button>
      </div>
    </div>
  );
}
