"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Dev fallback: replays an authorization webhook through the real handler (no signature check). */
export function SimulateWebhook({ jobId }: { jobId: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        const res = await fetch("/api/paypal/webhook/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) toast.error((json as { error?: string }).error ?? "Simulation failed.");
        else toast.success(`Webhook result: ${(json as { result: string }).result}`);
        router.refresh();
      }}
    >
      Simulate PayPal webhook (dev)
    </Button>
  );
}
