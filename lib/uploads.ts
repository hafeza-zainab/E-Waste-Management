import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_UPLOAD_BYTES } from "./image-upload";

/** Where uploads are stored. Served by app/uploads/[name]/route.ts (Next only serves public/ files that existed at build time). */
export const uploadDir = () => process.env.UPLOAD_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");

export { MAX_UPLOAD_BYTES } from "./image-upload";
type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Identify an image by its magic bytes; never trust the client-supplied MIME type or filename. */
function sniff(buf: Buffer): { mediaType: ImageType; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mediaType: "image/jpeg", ext: "jpg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mediaType: "image/png", ext: "png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { mediaType: "image/webp", ext: "webp" };
  return null;
}

export interface SavedImage {
  publicPath: string;
  mediaType: ImageType;
  base64: string;
}

/** Returns null when no file was provided; throws a user-facing Error when the file is invalid. */
export async function saveImageUpload(file: FormDataEntryValue | null): Promise<SavedImage | null> {
  if (file === null) return null;
  if (typeof file === "string") throw new Error("Photo must be an image file, not text.");
  // Multipart parsers can supply File objects from a different realm. Do not
  // silently discard those with an instanceof check against the global File.
  if (file.size === 0) {
    // An unselected input can arrive as an empty generic Blob named "blob"
    // after multipart/Server Action serialization, rather than an unnamed File.
    // Required-photo callers still reject null; named empty images remain errors.
    if (!file.name || (file.name === "blob" && (!file.type || file.type === "application/octet-stream"))) return null;
    throw new Error("The selected photo is empty. Please choose another image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Photo is too large. The limit is 4 MB.");
  let buf: Buffer;
  try { buf = Buffer.from(await file.arrayBuffer()); }
  catch { throw new Error("Could not read the selected photo. Please select it again."); }
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("Photo is too large. The limit is 4 MB.");
  const kind = sniff(buf);
  if (!kind) throw new Error("Photo must be a JPEG, PNG or WebP image.");
  const dir = uploadDir();
  const name = `${randomUUID()}.${kind.ext}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf);
  } catch {
    // Read-only or full disk: report plainly instead of surfacing a raw fs error.
    throw new Error("Photo storage is unavailable right now. Please try again later.");
  }
  return { publicPath: `/uploads/${name}`, mediaType: kind.mediaType, base64: buf.toString("base64") };
}
