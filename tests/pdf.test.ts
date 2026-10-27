import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCv } from "@/lib/pdf/cv";
import { buildCertificate, impactLine } from "@/lib/pdf/certificate";
import { pdfSafe } from "@/lib/pdf/util";
import { pdfText } from "./helpers/pdf-text";

const repair = (i: number) => ({ deviceType: "phone", repairType: `Screen replacement ${i}`, date: "2026-10-01", rating: 5, payoutRef: "ABCD…1234", demo: i % 2 === 0 });
const cv = (over = {}) => ({ name: "Aisha Rahman", city: "Metro Central", bio: "Screen specialist.", rating: 4.9, skills: ["phone", "tablet"], profileUrl: "http://localhost:3000/tech/abc", repairs: [repair(1), repair(2)], ...over });

describe("pdfSafe", () => {
  it("replaces unencodable characters and control characters, and clamps length", () => {
    expect(pdfSafe("Zoë 日本語 <b>x</b>\u0000\n(y)")).toBe("Zoë ??? <b>x</b> (y)");
    expect(pdfSafe("x".repeat(500), 50)).toHaveLength(50);
    expect(pdfSafe("\u{1F600}")).toBe("?");
  });
});

describe("Verified Repair CV", () => {
  it("produces a valid, non-empty PDF with the expected content", async () => {
    const bytes = await buildCv(cv());
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const text = pdfText(bytes);
    for (const needle of ["Aisha Rahman", "Verified Repair CV", "Verified repairs: 2", "Screen replacement 1", "ABCD", "Verified by ReLoop; payments confirmed via PayPal sandbox payout IDs", "SANDBOX / DEMO", "http://localhost:3000/tech/abc"])
      expect(text, needle).toContain(needle);
  });
  it("handles no repairs, hostile text and many rows (page break)", async () => {
    const empty = pdfText(await buildCv(cv({ repairs: [] })));
    expect(empty).toContain("No verified repairs yet.");
    const hostile = await buildCv(cv({ name: "Evil ) Tj /X <</Y>> 日本", bio: "line\u0000break ".repeat(80), repairs: [repair(1)] }));
    expect((await PDFDocument.load(hostile)).getPageCount()).toBeGreaterThanOrEqual(1);
    const many = await buildCv(cv({ repairs: Array.from({ length: 60 }, (_, i) => repair(i)) }));
    expect((await PDFDocument.load(many)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("donation certificate", () => {
  const data = { certificateId: "RL-ABCDEF12", donorName: "Maria Lindqvist", amountCents: 5000, date: new Date("2026-10-27T10:00:00Z"), simulated: false };
  it("contains donor, amount, date, id, impact line and the disclaimers", async () => {
    const text = pdfText(await buildCertificate(data));
    for (const needle of ["Maria Lindqvist", "$50.00 USD", "2026-10-27", "RL-ABCDEF12", "Helps fund about 2 devices", "not tax documentation", "does not imply tax-deductibility", "placeholder", "SANDBOX / DEMO"])
      expect(text, needle).toContain(needle);
    expect(text).not.toContain("SIMULATED");
  });
  it("says SIMULATED for simulated donations and survives hostile names", async () => {
    const bytes = await buildCertificate({ ...data, simulated: true, donorName: "日本 ) (( \\ <script>" });
    expect(pdfText(bytes)).toContain("SIMULATED");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("impact line: whole devices at $25 each, otherwise a modest sentence", () => {
    expect(impactLine(2500)).toContain("about 1 device ");
    expect(impactLine(10000)).toContain("about 4 devices");
    expect(impactLine(500)).toContain("Contributes toward");
  });
});
