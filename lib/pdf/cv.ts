import { A4, drawQr, footer, GREY, INK, newDoc, pdfSafe, TEAL, wrap } from "./util";

export interface CvData {
  name: string;
  city: string;
  bio: string;
  rating: number;
  skills: string[];
  profileUrl: string;
  repairs: { deviceType: string; repairType: string; date: string; rating: number; payoutRef: string; demo: boolean }[];
}

/** Verified Repair CV. Every string from the database is passed through pdfSafe. */
export async function buildCv(data: CvData): Promise<Uint8Array> {
  const { doc, font, bold } = await newDoc(`Verified Repair CV - ${data.name}`);
  let page = doc.addPage(A4);
  const W = A4[0];
  let y = A4[1] - 60;

  page.drawText("Verified Repair CV", { x: 50, y, size: 12, font: bold, color: TEAL });
  y -= 30;
  page.drawText(pdfSafe(data.name, 60), { x: 50, y, size: 24, font: bold, color: INK });
  y -= 18;
  page.drawText(pdfSafe(`${data.city} | rating ${data.rating.toFixed(1)} / 5`, 80), { x: 50, y, size: 11, font, color: GREY });
  drawQr(page, data.profileUrl, W - 50 - 80, A4[1] - 140, 80);
  page.drawText("Scan for live profile", { x: W - 50 - 80, y: A4[1] - 152, size: 7, font, color: GREY });
  y -= 24;

  for (const l of wrap(pdfSafe(data.bio, 400), font, 11, W - 100 - 100)) {
    page.drawText(l, { x: 50, y, size: 11, font, color: INK });
    y -= 15;
  }
  y -= 8;
  const n = data.repairs.length;
  const avg = n ? data.repairs.filter((r) => r.rating > 0).reduce((s, r, _, a) => s + r.rating / a.length, 0) : 0;
  page.drawText(pdfSafe(`Skills: ${data.skills.join(", ")}`, 120), { x: 50, y, size: 11, font, color: INK });
  y -= 16;
  page.drawText(`Verified repairs: ${n}${n && avg ? `   |   Average customer rating: ${avg.toFixed(1)}` : ""}`, { x: 50, y, size: 11, font: bold, color: INK });
  y -= 28;

  const cols = [50, 130, 300, 380, 420];
  const head = () => {
    ["Device", "Repair", "Date", "Rating", "Payout ref"].forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 10, font: bold, color: TEAL }));
    y -= 6;
    page.drawLine({ start: { x: 50, y }, end: { x: W - 50, y }, thickness: 0.5, color: GREY });
    y -= 14;
  };
  head();
  if (n === 0) page.drawText("No verified repairs yet.", { x: 50, y, size: 10, font, color: GREY });
  for (const r of data.repairs) {
    if (y < 110) {
      footer(page, font);
      page = doc.addPage(A4);
      y = A4[1] - 60;
      head();
    }
    const repair = wrap(pdfSafe(r.repairType, 80), font, 9, 160)[0] ?? "";
    page.drawText(pdfSafe(r.deviceType, 20), { x: cols[0], y, size: 9, font, color: INK });
    page.drawText(repair, { x: cols[1], y, size: 9, font, color: INK });
    page.drawText(pdfSafe(r.date, 20), { x: cols[2], y, size: 9, font, color: INK });
    page.drawText(r.rating > 0 ? `${r.rating}/5` : "pending", { x: cols[3], y, size: 9, font, color: INK });
    page.drawText(pdfSafe(r.payoutRef + (r.demo ? " (demo)" : ""), 40), { x: cols[4], y, size: 9, font, color: INK });
    y -= 15;
  }

  y -= 20;
  if (y < 110) { footer(page, font); page = doc.addPage(A4); y = A4[1] - 60; }
  for (const l of wrap("Verified by ReLoop; payments confirmed via PayPal sandbox payout IDs. Entries marked (demo) come from seeded or simulated data.", font, 10, W - 100)) {
    page.drawText(l, { x: 50, y, size: 10, font, color: INK });
    y -= 13;
  }
  page.drawText(pdfSafe(data.profileUrl, 200), { x: 50, y: y - 4, size: 9, font, color: TEAL });
  footer(page, font);
  return doc.save();
}
