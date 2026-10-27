import { inflateSync } from "node:zlib";

/** Best-effort text extraction for pdf-lib output (Flate content streams, hex or literal Tj strings). */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = Buffer.from(m[1], "latin1");
    try {
      body = inflateSync(body);
    } catch {
      /* not compressed */
    }
    const s = body.toString("latin1");
    for (const h of s.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) out.push(Buffer.from(h[1].replace(/\s/g, ""), "hex").toString("latin1"));
    for (const l of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
  }
  return out.join("\n");
}
