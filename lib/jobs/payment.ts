import { db } from "@/lib/db";
import { PayPalError } from "@/lib/paypal/client";
import { authorizeOrder } from "@/lib/paypal/orders";
import { markPaid } from "./service";

export interface AuthorizeResult {
  ok: boolean;
  status?: string;
  alreadyPaid?: boolean;
  error?: string;
  issue?: string;
  debugId?: string;
  httpStatus: number;
}

/** Shared by the popup flow (API route) and the full-page redirect flow (return page). */
export async function authorizeJobOrder(jobId: string, orderId: string): Promise<AuthorizeResult> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: "Job not found.", httpStatus: 404 };
  // The order must be the one we created for this job.
  if (job.paypalOrderId !== orderId) return { ok: false, error: "Order does not belong to this job.", httpStatus: 409 };
  if (job.status !== "quoted") return { ok: true, status: job.status, alreadyPaid: true, httpStatus: 200 };
  try {
    const auth = await authorizeOrder(orderId);
    await markPaid(job.id, orderId, auth.authorizationId, `Funds authorized (${auth.authorizationId})`);
    return { ok: true, status: "paid", httpStatus: 200 };
  } catch (e) {
    if (e instanceof PayPalError) {
      const declined = e.issue === "INSTRUMENT_DECLINED";
      return {
        ok: false,
        error: declined ? "Your payment method was declined. Please choose another." : `PayPal error: ${e.message}`,
        issue: e.issue,
        debugId: e.debugId,
        httpStatus: declined ? 422 : 502,
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Authorization failed.", httpStatus: 500 };
  }
}
