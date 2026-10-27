import { isDemoMode } from "@/lib/ai/config";

export function DemoBanner() {
  const demo = isDemoMode();
  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
      Sandbox / Demo mode: PayPal runs in the <strong>sandbox</strong>, no real money moves
      {demo ? "; AI answers come from scripted fixtures." : "; AI answers come from live Claude calls."}
    </div>
  );
}
