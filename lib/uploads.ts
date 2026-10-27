import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where uploads are stored. Served by app/uploads/[name]/route.ts (Next only serves public/ files that existed at build time). */
export const uploadDir = () => process.env.UPLOAD_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
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
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Photo is too large. The limit is 4 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw new Error("Photo must be a JPEG, PNG or WebP image.");
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${kind.ext}`;
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), buf);
  return { publicPath: `/uploads/${name}`, mediaType: kind.mediaType, base64: buf.toString("base64") };
}
