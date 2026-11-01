import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachImageFile, IMAGE_ACCEPT, imageSelectionError, MAX_UPLOAD_BYTES } from "@/lib/image-upload";
import { saveImageUpload } from "@/lib/uploads";
import { GET } from "../app/uploads/[name]/route";
import { getPrincipalOrNull } from "@/lib/session";
import { canReadUpload } from "@/lib/auth/access";

vi.mock("@/lib/session", () => ({ getPrincipalOrNull: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ canReadUpload: vi.fn() }));

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const webp = Buffer.from("RIFF\x08\x00\x00\x00WEBPVP8 ", "binary");
const cases = [
  { name: "photo.png", type: "image/png", bytes: png, ext: "png", served: "image/png" },
  { name: "photo.jpg", type: "image/jpeg", bytes: jpeg, ext: "jpg", served: "image/jpeg" },
  { name: "photo.jpeg", type: "image/jpeg", bytes: jpeg, ext: "jpg", served: "image/jpeg" },
  { name: "PHOTO.JPG", type: "image/jpg", bytes: jpeg, ext: "jpg", served: "image/jpeg" },
  { name: "photo.webp", type: "image/webp", bytes: webp, ext: "webp", served: "image/webp" },
  { name: "photo.JPEG", type: "", bytes: jpeg, ext: "jpg", served: "image/jpeg" },
  { name: "photo.PNG", type: "application/octet-stream", bytes: png, ext: "png", served: "image/png" },
];

beforeEach(() => {
  vi.stubEnv("UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "reloop-upload-check-")));
  vi.mocked(getPrincipalOrNull).mockResolvedValue({ kind: "owner", ownerId: "owner" });
  vi.mocked(canReadUpload).mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("image selection and multipart uploads", () => {
  it("uses all requested picker MIME types", () => {
    expect(IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/jpg,image/webp");
  });
  it.each(cases)("attaches, parses, stores and serves $name ($type) with original bytes", async c => {
    const photo = new File([c.bytes], c.name, { type: c.type });
    expect(imageSelectionError(photo)).toBeNull();
    const body = new FormData();
    body.set("goal", "Repair my screen");
    attachImageFile(body, photo);
    const request = new Request("http://localhost/api/agent/run", { method: "POST", body });
    expect(request.headers.get("Content-Type")).toMatch(/^multipart\/form-data; boundary=/);
    const parsed = await request.formData();
    expect(parsed.get("goal")).toBe("Repair my screen");
    expect((parsed.get("photo") as File).name).toBe(c.name);
    const saved = await saveImageUpload(parsed.get("photo"));
    expect(saved!.mediaType).toBe(c.served);
    expect(saved!.publicPath).toMatch(new RegExp(`^/uploads/[0-9a-f-]{36}\\.${c.ext}$`));
    const response = await GET(new Request(`http://localhost${saved!.publicPath}`), { params: Promise.resolve({ name: path.basename(saved!.publicPath) }) } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(c.served);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(c.bytes);
  });
  it("replaces the single photo field without duplicating it, and handles no optional photo", () => {
    const body = new FormData();
    attachImageFile(body, undefined);
    expect(body.get("photo")).toBeNull();
    attachImageFile(body, new File([jpeg], "first.jpg", { type: "image/jpeg" }));
    attachImageFile(body, new File([png], "second.png", { type: "image/png" }));
    expect(body.getAll("photo")).toHaveLength(1);
    expect((body.get("photo") as File).name).toBe("second.png");
  });
  it("reports empty, unsupported and oversize selections before attaching them", () => {
    const body = new FormData();
    expect(() => attachImageFile(body, new File([], "empty.jpg", { type: "image/jpeg" }))).toThrow(/empty/);
    expect(() => attachImageFile(body, new File(["gif"], "photo.gif", { type: "image/gif" }))).toThrow(/PNG, JPG, JPEG or WebP/);
    expect(() => attachImageFile(body, new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.jpg", { type: "image/jpeg" }))).toThrow(/4 MB/);
    expect(body.has("photo")).toBe(false);
    expect(imageSelectionError(new File([jpeg], "photo.unknown"))).toMatch(/PNG, JPG, JPEG or WebP/);
  });
  it("rejects spoofed image labels by checking actual bytes on the server", async () => {
    const fake = new File(["not an image"], "photo.jpg", { type: "image/jpg" });
    expect(imageSelectionError(fake)).toBeNull(); // picker validation is only a hint
    await expect(saveImageUpload(fake)).rejects.toThrow(/JPEG, PNG or WebP/);
  });
  it("does not silently discard a parser-supplied File from another realm", async () => {
    const parserFile = { name: "photo.jpeg", size: jpeg.length, type: "image/jpeg", arrayBuffer: async () => Uint8Array.from(jpeg).buffer } as File;
    expect(parserFile instanceof File).toBe(false);
    expect((await saveImageUpload(parserFile))!.mediaType).toBe("image/jpeg");
  });
  it("distinguishes absent optional files from empty, textual and unreadable submissions", async () => {
    expect(await saveImageUpload(null)).toBeNull();
    expect(await saveImageUpload(new File([], ""))).toBeNull();
    await expect(saveImageUpload("photo.jpg")).rejects.toThrow(/image file/);
    await expect(saveImageUpload(new File([], "empty.jpg"))).rejects.toThrow(/empty/);
    const file = new File([jpeg], "photo.jpg");
    vi.spyOn(file, "arrayBuffer").mockRejectedValueOnce(new Error("read failed"));
    await expect(saveImageUpload(file)).rejects.toThrow(/Could not read/);
    await expect(saveImageUpload(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.jpg"))).rejects.toThrow(/4 MB/);
  });
  it("keeps uploaded photos private when serving them", async () => {
    const saved = await saveImageUpload(new File([png], "photo.png"));
    const context = { params: Promise.resolve({ name: path.basename(saved!.publicPath) }) } as never;
    vi.mocked(canReadUpload).mockResolvedValue(false);
    expect((await GET(new Request("http://localhost/uploads/photo"), context)).status).toBe(404);
    vi.mocked(getPrincipalOrNull).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/uploads/photo"), context)).status).toBe(401);
  });
});
