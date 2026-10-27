import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const v = (name: string) => new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(css)![1];

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("WCAG AA colour contrast (>= 4.5:1 for normal text)", () => {
  const pairs: [string, string, string][] = [
    ["foreground", "background", "body text"],
    ["muted", "background", "muted text on page"],
    ["muted", "card", "muted text on cards"],
    ["muted", "primary-soft", "muted text on tinted boxes"],
    ["primary", "background", "links"],
    ["primary", "primary-soft", "primary text on tinted boxes"],
    ["primary-hover", "primary-soft", "badge text"],
    ["danger", "card", "error text"],
  ];
  it.each(pairs)("%s on %s (%s)", (fg, bg) => expect(ratio(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5));
  it("white on primary / primary-hover buttons", () => {
    expect(ratio("#ffffff", v("primary"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", v("primary-hover"))).toBeGreaterThanOrEqual(4.5);
  });
});
