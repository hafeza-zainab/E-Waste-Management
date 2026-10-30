import { db } from "@/lib/db";
import { isDemoMode } from "@/lib/ai/config";
import type { AgentEvent } from "@/lib/agent/runner";
import { paypalMode } from "@/lib/paypal/client";
import { simulationAllowed } from "@/lib/jobs/lifecycle";
import { requirePrincipal } from "@/lib/session";
import { AgentConsole } from "@/components/agent-console";

export const metadata = { title: "Repair agent" };

export default async function AgentPage(props: PageProps<"/agent">) {
  const who = await requirePrincipal("owner", "/agent");
  const sp = await props.searchParams;
  const runId = typeof sp.run === "string" ? sp.run.slice(0, 40) : undefined;
  const found = runId ? await db.agentRun.findUnique({ where: { id: runId } }) : null;
  // A run is shown only to the owner who started it (and, for the tour identity, only within its own run).
  const run = found && found.ownerId === who.ownerId && (who.tourRunId ? found.tourRunId === who.tourRunId : !found.isTour) ? found : null;

  let events: AgentEvent[] = [];
  let quoteState: "open" | "closed" | "none" = "none";
  if (run) {
    events = JSON.parse(run.eventsJson) as AgentEvent[];
    if (run.jobId && events.some((e) => e.type === "quote")) {
      const job = await db.job.findUnique({ where: { id: run.jobId } });
      const approval = await db.agentApproval.findFirst({ where: { jobId: run.jobId }, orderBy: { createdAt: "desc" } });
      quoteState = job?.status === "quoted" && approval && approval.expiresAt > new Date() ? "open" : "closed";
    }
  }
  const clientId = paypalMode() === "sandbox" ? process.env.PAYPAL_CLIENT_ID || null : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Repair agent</h1>
        <p className="mt-1 text-muted">
          Tell the agent what you need. It diagnoses, checks safety, finds parts and a technician, and builds a quote within your budget. It can never pay: you approve, then approve again in PayPal.
        </p>
      </div>
      <AgentConsole
        mode={isDemoMode() ? "scripted" : "live"}
        clientId={clientId}
        allowSimulate={simulationAllowed()}
        initialEvents={events}
        initialQuoteState={quoteState}
        initialGoal={run?.goal}
      />
    </div>
  );
}
