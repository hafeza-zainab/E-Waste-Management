import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { currentTourRun, setTourRole, tourEnabled } from "@/lib/tour/server";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("role", [z.object({ role: z.literal("owner") }), z.object({ role: z.literal("technician"), techId: z.string().min(1).max(40) })]);

/**
 * Switches the TOUR-ONLY identity overlay (cookie `reloop_tour_role`, bound to this tour run). It never reads, changes
 * or replaces the visitor's real session cookie. A technician overlay is accepted only for a technician who has a
 * job in this very run, and it only ever authorizes records tagged with this run.
 */
export async function POST(req: Request) {
  if (!tourEnabled()) return NextResponse.json({ error: "The guided demo is not enabled here." }, { status: 403 });
  const limited = rateLimitResponse(req, "tourRole");
  if (limited) return limited;
  const run = await currentTourRun();
  if (!run) return NextResponse.json({ error: "No active guided demo session." }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.data.role === "technician") {
    const job = await db.job.findFirst({ where: { tourRunId: run.id, technicianId: body.data.techId }, select: { id: true } });
    if (!job) return NextResponse.json({ error: "That technician has no job in your guided demo." }, { status: 403 });
    setTourRole(await cookies(), run.id, "technician", body.data.techId);
  } else {
    setTourRole(await cookies(), run.id, "owner");
  }
  return NextResponse.json({ ok: true, role: body.data.role });
}
