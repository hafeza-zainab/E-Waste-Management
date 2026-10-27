import { z } from "zod";
import { db } from "@/lib/db";
import { certificateId } from "@/lib/donations/amount";
import { certificateAvailable } from "@/lib/donations/service";
import { buildCertificate } from "@/lib/pdf/certificate";

export const runtime = "nodejs";

/** Certificates exist only for completed (captured or simulated) donations, and only via the unguessable public id. */
export async function GET(_req: Request, ctx: RouteContext<"/donate/certificate/[publicId]">) {
  const { publicId } = await ctx.params;
  if (!z.string().uuid().safeParse(publicId).success) return new Response("Not found", { status: 404 });
  const d = await db.donation.findUnique({ where: { publicId } });
  if (!d) return new Response("Not found", { status: 404 });
  if (!certificateAvailable(d)) return new Response("No certificate: this donation was not completed.", { status: 409 });
  const pdf = await buildCertificate({
    certificateId: certificateId(d.publicId),
    donorName: d.donorName,
    amountCents: d.amountCents,
    date: d.capturedAt ?? d.createdAt,
    simulated: d.simulated,
  });
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="reloop-donation-${certificateId(d.publicId)}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
