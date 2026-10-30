import { readFile } from "node:fs/promises";
import path from "node:path";
import { canReadUpload } from "@/lib/auth/access";
import { getPrincipalOrNull } from "@/lib/session";
import { uploadDir } from "@/lib/uploads";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Serves uploaded photos at runtime (in production Next only serves public/ files that existed at build time).
 * Access is checked per file (lib/auth/access.ts). Only names we generate (uuid.ext) are accepted, so there is no path traversal. A missing file is a plain 404,
 * which the UI handles (uploads are ephemeral on a free host).
 */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[name]">) {
  const { name } = await ctx.params;
  const m = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.exec(name);
  if (!m) return new Response("Not found", { status: 404 });
  // Photos are private: only the owner of the device/job and the assigned technician may read them. 404 (not 403) so
  // nobody can probe which file names exist.
  const who = await getPrincipalOrNull();
  if (!who) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!(await canReadUpload(who, name))) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const buf = await readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), name));
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[m[1]], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
