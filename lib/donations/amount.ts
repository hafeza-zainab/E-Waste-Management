import { z } from "zod";

export const MIN_DONATION_CENTS = 100; // $1
export const MAX_DONATION_CENTS = 50_000; // $500
export const PRESET_DONATION_CENTS = [500, 1000, 2500] as const;

/** Converts a user-typed dollar amount to integer cents, rounding half-up to the cent. Throws on invalid input. */
export function dollarsToCents(input: string | number): number {
  const n = typeof input === "number" ? input : Number(String(input).trim().replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter an amount in dollars.");
  const cents = Math.round(n * 100 + 1e-9); // epsilon: 10.005 -> 1001, not 1000
  if (cents < MIN_DONATION_CENTS) throw new Error("The minimum donation is $1.");
  if (cents > MAX_DONATION_CENTS) throw new Error("The maximum donation is $500.");
  return cents;
}

/** Server-side validation for a new donation. Text is trimmed, size-limited and stripped of control characters. */
export const DonationInputSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v, ctx) => {
    try {
      return dollarsToCents(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Invalid amount." });
      return z.NEVER;
    }
  }),
  donorName: z
    .string()
    .max(60, "Name is too long")
    .optional()
    .transform((s) => (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()),
  message: z
    .string()
    .max(200, "Message is too long (200 characters)")
    .optional()
    .transform((s) => (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || undefined),
  deviceId: z.string().max(40).optional(),
});
export type DonationInput = z.infer<typeof DonationInputSchema>;

/** What public lists may show: first name only, else "Anonymous". */
export function publicDonorName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? first.slice(0, 30) : "Anonymous";
}

/** Short certificate id derived from the public id. It is NOT enough to access the certificate. */
export const certificateId = (publicId: string) => `RL-${publicId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
