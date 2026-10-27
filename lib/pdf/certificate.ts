import { devicesFunded } from "@/lib/impact/totals";
import { DEMO_BENEFICIARY, REFURB_SUBSIDY_CENTS_PER_DEVICE } from "@/lib/impact/constants";
import { A4, footer, GREY, INK, newDoc, pdfSafe, TEAL, wrap } from "./util";

export interface CertificateData {
  certificateId: string;
  donorName: string;
  amountCents: number;
  date: Date;
  simulated: boolean;
}

/** Impact sentence. Formula: floor(amount / REFURB_SUBSIDY_CENTS_PER_DEVICE), an illustrative estimate. */
export function impactLine(amountCents: number): string {
  const n = devicesFunded(amountCents);
  const per = (REFURB_SUBSIDY_CENTS_PER_DEVICE / 100).toFixed(0);
  return n >= 1
    ? `Helps fund about ${n} device${n === 1 ? "" : "s"} kept in use (illustrative estimate at $${per} per refurbished device).`
    : `Contributes toward the next refurbished device (illustrative estimate: $${per} per device).`;
}

export async function buildCertificate(d: CertificateData): Promise<Uint8Array> {
  const { doc, font, bold } = await newDoc(`Donation certificate ${d.certificateId}`);
  const page = doc.addPage(A4);
  const W = A4[0];
  const center = (text: string, y: number, size: number, f = font, color = INK) =>
    page.drawText(text, { x: (W - f.widthOfTextAtSize(text, size)) / 2, y, size, font: f, color });

  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: A4[1] - 60, borderColor: TEAL, borderWidth: 3 });
  center("ReLoop", 740, 14, bold, TEAL);
  center("Certificate of Donation", 690, 30, bold);
  center("This certifies that", 630, 12, font, GREY);
  const name = pdfSafe(d.donorName || "Anonymous", 60);
  center(name, 590, name.length > 28 ? 22 : 30, bold, TEAL);
  center("donated", 550, 12, font, GREY);
  center(`$${(d.amountCents / 100).toFixed(2)} USD`, 510, 32, bold);
  center("to the Refurbish & Donate Fund", 478, 13);

  let y = 430;
  for (const l of wrap(impactLine(d.amountCents), font, 12, W - 160)) { center(l, y, 12); y -= 17; }
  y -= 6;
  for (const l of wrap(pdfSafe(`Beneficiary: ${DEMO_BENEFICIARY}`), font, 10, W - 160)) { center(l, y, 10, font, GREY); y -= 14; }

  center(`Date: ${d.date.toISOString().slice(0, 10)}`, 250, 11);
  center(`Certificate ID: ${pdfSafe(d.certificateId, 30)}`, 232, 11, bold);
  const disclaimer = [
    "DEMO CERTIFICATE. This donation was made through the PayPal sandbox" + (d.simulated ? " and was SIMULATED" : "") + "; no real money moved.",
    "This is not a receipt, is not tax documentation and does not imply tax-deductibility.",
    "The beneficiary is a placeholder, not a real organisation.",
  ];
  y = 180;
  for (const t of disclaimer) for (const l of wrap(t, font, 9, W - 160)) { center(l, y, 9, font, GREY); y -= 12; }
  footer(page, font);
  return doc.save();
}
