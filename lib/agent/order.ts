import { db } from "@/lib/db";
import { deviceLabel } from "@/lib/jobs/device-label";
import { parseQuote } from "@/lib/jobs/service";
import { createOrder, type CreatedOrder } from "@/lib/paypal/orders";
import { consumeToken } from "./approval";

/**
 * The single gate for creating a PayPal order for an agent-built job. Throws ApprovalError unless the user's
 * single-use approval token verifies against this exact job, total and line items.
 * Used by the create_paypal_order tool and by POST /api/paypal/orders for agent jobs.
 */
export async function createOrderWithApproval(jobId: string, token: string | undefined): Promise<CreatedOrder> {
  const job = await consumeToken(token, jobId);
  const full = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { device: true } });
  const quote = parseQuote(full.quoteJson);
  if (!quote) throw new Error("Job has no quote.");
  const order = await createOrder(full.id, `ReLoop repair: ${deviceLabel(full.device)}`, quote);
  await db.job.update({ where: { id: full.id }, data: { paypalOrderId: order.id } });
  return order;
}
