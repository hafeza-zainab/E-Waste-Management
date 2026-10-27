import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/paypal/orders";
import { buildCv } from "@/lib/pdf/cv";
import { verifiedRepairsFor } from "@/lib/profile/queries";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/tech/[id]/cv">) {
  const { id } = await ctx.params;
  const tech = await db.technician.findUnique({ where: { id }, select: { id: true, name: true, city: true, bio: true, skills: true, rating: true } });
  if (!tech) return new Response("Not found", { status: 404 });
  const repairs = await verifiedRepairsFor(id);
  const pdf = await buildCv({
    name: tech.name,
    city: tech.city,
    bio: tech.bio,
    rating: tech.rating,
    skills: tech.skills.split(",").map((s) => s.trim()),
    profileUrl: `${appBaseUrl().replace(/\/$/, "")}/tech/${tech.id}`,
    repairs: repairs.map((r) => ({ deviceType: r.deviceType, repairType: r.repairType, date: r.date.toISOString().slice(0, 10), rating: r.rating, payoutRef: r.payoutRef, demo: r.demo })),
  });
  const safeName = tech.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "technician";
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="verified-repair-cv-${safeName}.pdf"`, "Cache-Control": "no-store" },
  });
}
