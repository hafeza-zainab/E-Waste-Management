/** Preserve the current run in the URL so a hard reload can restore its stored
 * trace and quote through the existing ownership-checked /agent?run= page.
 */
export function agentRunPath(href: string, runId: string): string | null {
  const url = new URL(href);
  if (url.pathname !== "/agent") return null;
  url.searchParams.set("run", runId);
  return `${url.pathname}${url.search}${url.hash}`;
}
