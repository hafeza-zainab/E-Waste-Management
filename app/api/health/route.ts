import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Render health check: 200 only if the database answers. Exposes no configuration. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
