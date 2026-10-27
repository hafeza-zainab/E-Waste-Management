import { aiCapReached, isDemoMode } from "@/lib/ai/config";
import { paypalMode } from "@/lib/paypal/client";

export function DemoBanner() {
  const ai = aiCapReached()
    ? "today's live-AI limit is used up, so AI answers come from scripted fixtures"
    : isDemoMode()
      ? "AI answers come from scripted fixtures"
      : "AI answers come from live Claude calls";
  const pp =
    paypalMode() === "sandbox"
      ? "payments use the PayPal sandbox, no real money moves"
      : "PayPal is simulated locally (no sandbox credentials configured), no real money moves";
  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
      Sandbox / Demo mode: {pp}; {ai}.
    </div>
  );
}
