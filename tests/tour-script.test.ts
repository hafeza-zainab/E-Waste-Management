import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import captions from "../docs/tour-captions.json";
import { CHAPTERS, captionFor } from "@/lib/tour/script";

/** Every data-tour name the app can render (static attribute, SubmitButton `tour=`, or a template-literal prefix). */
function collectTargets() {
  const names = new Set<string>();
  const prefixes = new Set<string>();
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(n)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/data-tour="([a-z0-9-]+)"/g)) names.add(m[1]);
        for (const m of src.matchAll(/\btour="([a-z0-9-]+)"/g)) names.add(m[1]);
        for (const m of src.matchAll(/data-tour=\{`([a-z0-9-]+-)\$\{/g)) prefixes.add(m[1]);
        // conditional form: data-tour={cond ? "name" : undefined}
        for (const m of src.matchAll(/data-tour=\{[^}`]*"([a-z0-9-]+)"[^}`]*\}/g)) names.add(m[1]);
      }
    }
  };
  for (const d of ["app", "components"]) walk(path.join(process.cwd(), d));
  return { names, prefixes };
}

describe("guided demo script", () => {
  const { names, prefixes } = collectTargets();
  const exists = (target: string) => {
    const base = target.replace(/@job$/, "");
    return names.has(base) || [...prefixes].some((p) => base.startsWith(p));
  };
  const steps = CHAPTERS.flatMap((c) => c.steps.map((s) => ({ chapter: c.id, s })));

  it("every caption key exists and is not empty", () => {
    for (const { chapter, s } of steps) if ("cap" in s && s.cap) expect(captionFor(s.cap), `${chapter}: ${s.cap}`).not.toBe("");
  });
  it("every step with a caption names a target, and that target exists in the app's markup", () => {
    for (const { chapter, s } of steps) {
      if (!("cap" in s) || !s.cap) continue;
      const target = "target" in s ? s.target : "tour-bar"; // the closing caption is shown in the tour bar itself
      expect(target, `${chapter}: caption ${s.cap} has no target`).toBeTruthy();
      expect(exists(target), `${chapter}: target "${target}" is not in any page`).toBe(true);
    }
  });
  it("every target used by any step exists in the app's markup (no position-based selectors)", () => {
    for (const { chapter, s } of steps) if ("target" in s) expect(exists(s.target), `${chapter}: ${s.target}`).toBe(true);
  });
  it("has no unused captions", () => {
    const used = new Set(steps.flatMap(({ s }) => ("cap" in s && s.cap ? [s.cap] : [])));
    for (const [group, items] of Object.entries(captions)) {
      if (group === "_help" || group === "ui") continue;
      for (const key of Object.keys(items as object)) expect(used.has(`${group}.${key}`), `unused caption ${group}.${key}`).toBe(true);
    }
  });
  it("chapters that depend on earlier ones say so, and tour-only steps are labelled in their captions", () => {
    const need = Object.fromEntries(CHAPTERS.map((c) => [c.id, c.needs ?? []]));
    expect(need.technician).toEqual(["job", "paid"]);
    expect(need.payout).toEqual(["job", "paid", "completed"]);
    expect(captionFor("control.tourpay")).toMatch(/TOUR-SIMULATED/);
    expect(captionFor("control.paypal")).toMatch(/never loads or calls PayPal/i);
  });
  it("never targets a PayPal element and never opens a PayPal or checkout URL", () => {
    const json = JSON.stringify(CHAPTERS);
    expect(json).not.toMatch(/paypal\.com|\/api\/paypal|checkout/i);
  });
});
