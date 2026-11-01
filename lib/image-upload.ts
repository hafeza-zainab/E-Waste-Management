/** Browser-safe selection hints. The server independently checks file bytes. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp";
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(IMAGE_ACCEPT.split(","));
const EXTENSION = /\.(png|jpe?g|webp)$/i;

export function imageSelectionError(file: Pick<File, "name" | "type" | "size">): string | null {
  if (file.size === 0) return "The selected photo is empty. Please choose another image.";
  if (file.size > MAX_UPLOAD_BYTES) return "Photo is too large. The limit is 4 MB.";
  const type = file.type.toLowerCase();
  // Windows and drag/drop may provide no MIME type or a generic binary type.
  // Accept a supported filename in that case; server byte checks remain final.
  if (TYPES.has(type) || ((!type || type === "application/octet-stream") && EXTENSION.test(file.name))) return null;
  return "Photo must be a PNG, JPG, JPEG or WebP image.";
}

/** A single photo field, preserving File bytes and filename. Do not stringify it
 * or set a Content-Type header: fetch supplies the multipart boundary. */
export function attachImageFile(form: FormData, file: File | null | undefined) {
  if (!file) return;
  const error = imageSelectionError(file);
  if (error) throw new Error(error);
  form.set("photo", file, file.name);
}
