/**
 * Pulls a dollar budget out of free text ("under $60", "max 80 dollars", "budget of $120.50").
 * Returns integer cents or null. Pure and conservative: when several amounts appear, the smallest
 * budget-flavoured one wins; a lone "$N" is used only if nothing budget-flavoured matched.
 */
export function parseBudgetCents(text: string): number | null {
  const toCents = (s: string) => Math.round(Number(s) * 100);
  const keyword = /(?:under|below|less than|up to|within|at most|no more than|max(?:imum)?(?: of)?|budget(?: is| of)?|cap(?:ped)? at|can'?t spend more than|<=?)\s*(?:usd\s*)?\$?\s*(\d{1,6}(?:\.\d{1,2})?)(?:\s*(?:dollars|usd|bucks))?/gi;
  const found: number[] = [];
  for (const m of text.matchAll(keyword)) found.push(toCents(m[1]));
  if (found.length === 0) for (const m of text.matchAll(/\$\s*(\d{1,6}(?:\.\d{1,2})?)/g)) found.push(toCents(m[1]));
  const valid = found.filter((c) => c > 0 && c <= 10_000_000);
  return valid.length ? Math.min(...valid) : null;
}
