import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveImageUpload } from "@/lib/uploads";

const png = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "a.png", { type: "image/png" });

describe("saveImageUpload on an unwritable disk", () => {
  afterEach(() => delete process.env.UPLOAD_DIR);
  it("throws a plain user-facing error instead of a raw fs error", async () => {
    const blocker = path.join(mkdtempSync(path.join(tmpdir(), "up-")), "file");
    writeFileSync(blocker, "x");
    process.env.UPLOAD_DIR = path.join(blocker, "sub"); // a path under a regular file cannot be created
    await expect(saveImageUpload(png)).rejects.toThrow(/storage is unavailable/);
  });
});
