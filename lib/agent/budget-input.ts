/** Converts the UI budget field ("60", "$60.50") to integer cents. Throws a user-facing Error. */
export function dollarsToCents(input: string): number {
  const n = Number(input.trim().replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a budget in dollars, like 60.");
  const cents = Math.round(n * 100 + 1e-9);
  if (cents > 10_000_000) throw new Error("That budget is too large.");
  return cents;
}
