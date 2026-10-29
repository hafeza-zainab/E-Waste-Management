import { log } from "@/lib/log";
import { currentTourRun } from "./server";

/**
 * Last line of defence for "the tour never calls PayPal". Every PayPal-bound route calls this first; during a
 * tour session (valid tour cookie) or for a tour job it returns a 403 and logs, otherwise null.
 */
export async function blockPaypalDuringTour(route: string, job?: { isTour: boolean } | null): Promise<Response | null> {
  const run = await currentTourRun();
  if (!run && !job?.isTour) return null;
  log.warn("tour_paypal_blocked", { route });
  return Response.json(
    { error: "The guided demo never calls PayPal. Finish or stop the tour to use the real sandbox checkout.", code: "tour_paypal_blocked" },
    { status: 403 },
  );
}
