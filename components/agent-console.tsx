"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { formatUsd } from "@/lib/jobs/money";
import type { AgentEvent } from "@/lib/agent/runner";
import { simulateApprovalAction } from "@/app/jobs/actions";

export const EXAMPLES = [
  { key: "cracked-screen", title: "Cracked phone screen", goal: "My Galaxy A52 screen is cracked, fix it under $60 this weekend." },
  { key: "swollen-battery", title: "Swollen laptop battery", goal: "My Dell Inspiron 15 laptop base is bulging and the battery looks swollen. Can I just replace the battery myself?" },
  { key: "dead-tv", title: "Dead 14-year-old TV", goal: "My 14-year-old Sony Bravia KDL-32 TV is completely dead, no standby light. What should I do?" },
] as const;

interface Props {
  mode: "scripted" | "live";
  clientId: string | null;
  allowSimulate: boolean;
  initialEvents: AgentEvent[];
  /** open = awaiting approval; otherwise the quote is no longer payable. */
  initialQuoteState: "open" | "closed" | "none";
  initialGoal?: string;
}

const ICON = { ok: "✓", blocked: "⛔", error: "⚠" } as const;
const TONE = { ok: "good", blocked: "warn", error: "bad" } as const;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed.");
  return json as T;
}

export function AgentConsole({ mode, clientId, allowSimulate, initialEvents, initialQuoteState, initialGoal }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [budget, setBudget] = useState("");
  const [scenario, setScenario] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [quoteState, setQuoteState] = useState(initialQuoteState);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = async (override?: { goal: string; budget?: string; scenario?: string }) => {
    const g = override?.goal ?? goal;
    const b = override?.budget ?? budget;
    const sc = override?.scenario ?? scenario;
    if (g.trim().length < 10) return setFormError("Describe what you need in at least 10 characters.");
    setFormError(null);
    setEvents([]);
    setQuoteState("none");
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const fd = new FormData();
    fd.set("goal", g);
    if (b.trim()) fd.set("budget", b.trim());
    if (sc) fd.set("scenario", sc);
    const photo = fileRef.current?.files?.[0];
    if (photo) fd.set("photo", photo);
    try {
      const res = await fetch("/api/agent/run", { method: "POST", body: fd, signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "The agent could not start.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as AgentEvent;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "quote") setQuoteState("open");
        }
      }
    } catch (e) {
      if (ac.signal.aborted) setEvents((prev) => [...prev, { type: "error", message: "Stopped by you. Nothing was charged." }]);
      else setFormError(e instanceof Error ? e.message : "The agent could not start.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const card = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "quote" }> => e.type === "quote")?.card;
  const runMode = events.find((e): e is Extract<AgentEvent, { type: "start" }> => e.type === "start")?.mode ?? mode;

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="goal" className="font-medium">What do you need?</label>
            <textarea id="goal" value={goal} onChange={(e) => { setGoal(e.target.value); setScenario(""); }} rows={3} maxLength={1000} required disabled={running}
              placeholder="My Galaxy A52 screen is cracked, fix it under $60 this weekend" className="min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-base" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="budget" className="font-medium">Budget in dollars (optional)</label>
              <input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={running} placeholder="60"
                className="min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base" />
              <p className="text-xs text-muted">Overrides a budget written in your request. The agent cannot go over it.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="photo" className="font-medium">Photo (optional)</label>
              <input id="photo" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={running} className="block w-full text-sm" />
            </div>
          </div>
          {formError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{formError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={running}>{running ? "Agent is working…" : "Start the agent"}</Button>
            {running && <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>Stop</Button>}
            <Badge tone={mode === "scripted" ? "warn" : "good"}>{mode === "scripted" ? "Scripted demo run (no Claude key)" : "Live Claude agent"}</Badge>
          </div>
        </form>
        <div>
          <p className="mb-2 text-sm text-muted">Try an example:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x.key} type="button" disabled={running} onClick={() => { setGoal(x.goal); setScenario(x.key); setBudget(""); void start({ goal: x.goal, budget: "", scenario: x.key }); }}
                className="min-h-11 rounded-full border border-border bg-white px-4 text-sm font-medium hover:bg-primary-soft disabled:opacity-50">
                {x.title}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <section aria-labelledby="trace-h" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="trace-h" className="text-xl font-bold">Agent trace</h2>
          {events.length > 0 && runMode === "scripted" && <Badge tone="warn">Scripted demo run</Badge>}
        </div>
        <div aria-live="polite" aria-relevant="additions text" aria-busy={running} className="space-y-2">
          {events.length === 0 && !running && <p className="text-sm text-muted">Nothing yet. Describe a problem or pick an example, and watch each step here.</p>}
          {events.map((ev, i) => <TraceItem key={i} ev={ev} />)}
          {running && <p role="status" className="text-sm text-muted">⏳ Working…</p>}
        </div>
      </section>

      {card && (
        <QuoteCardView
          card={card}
          state={quoteState}
          clientId={clientId}
          allowSimulate={allowSimulate}
          onChange={() => {
            setQuoteState("closed");
            toast("Quote cancelled. Edit your request and start again.");
            document.getElementById("goal")?.focus();
          }}
        />
      )}
      {!card && events.some((e) => e.type === "step" && e.status === "blocked" && /Over budget/.test(e.resultSummary)) && !running && (
        <OverBudget events={events} onRaise={(dollars) => { setBudget(dollars); void start({ goal, budget: dollars, scenario }); }} />
      )}
    </div>
  );
}

function OverBudget({ events, onRaise }: { events: AgentEvent[]; onRaise: (dollars: string) => void }) {
  const m = [...events].reverse().map((e) => (e.type === "step" ? /Over budget: \$([\d,.]+) vs/.exec(e.resultSummary) : null)).find(Boolean);
  const needed = m ? Math.ceil(Number(m[1].replace(/,/g, ""))) : null;
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-bold">Over your budget</h2>
      <p className="text-sm">The agent could not find a quote within your budget and did not create one. You can raise the budget yourself{needed ? ` (it needs about $${needed})` : ""}, or choose another route above.</p>
      {needed && <Button variant="outline" onClick={() => onRaise(String(needed))}>Raise my budget to ${needed} and re-run</Button>}
    </Card>
  );
}

function TraceItem({ ev }: { ev: AgentEvent }) {
  switch (ev.type) {
    case "start":
      return <p className="text-xs text-muted">Run {ev.runId.slice(-6)} · {ev.mode === "scripted" ? "scripted demo" : "live"} · budget {ev.budgetCents == null ? "none" : formatUsd(ev.budgetCents)}</p>;
    case "narration":
      return <p className="rounded-lg bg-primary-soft px-3 py-2 text-sm">🤖 {ev.text}</p>;
    case "step":
      return (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{ICON[ev.status]}</span>
            <span className="sr-only">{ev.status === "ok" ? "Succeeded:" : ev.status === "blocked" ? "Blocked:" : "Failed:"}</span>
            <strong>Step {ev.index}: {ev.label}</strong>
            <Badge tone={TONE[ev.status]}>{ev.status === "ok" ? "done" : ev.status}</Badge>
            <span className="ml-auto text-xs text-muted">{ev.ms} ms</span>
          </div>
          <p className="text-muted">Input: {ev.inputSummary || "none"}</p>
          <p>Result: {ev.resultSummary}</p>
        </div>
      );
    case "safety":
      return (
        <div role="note" className={`rounded-lg border-2 px-3 py-2 text-sm ${ev.level === "high" ? "border-danger bg-red-50 text-red-950" : "border-border bg-card"}`}>
          <strong>Safety gate (code, not the AI):</strong> {ev.diyAllowed ? "DIY allowed." : "DIY is not allowed for this device."}{ev.reasons.length > 0 && ` ${ev.reasons.join(" ")}`}
        </div>
      );
    case "quote":
      return <p className="text-sm font-medium">📋 Quote ready below.</p>;
    case "final":
      return (
        <div className="space-y-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <p>{ev.text}</p>
          {ev.actions.length > 0 && (
            <ul className="flex flex-wrap gap-2">{ev.actions.map((a) => <li key={a.label}><Link className="inline-flex min-h-11 items-center font-semibold text-primary underline" href={a.href}>{a.label}</Link></li>)}</ul>
          )}
        </div>
      );
    case "error":
      return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">⚠ {ev.message}</p>;
    case "done":
      return <p className="text-xs text-muted">Run {ev.status.replaceAll("_", " ")}.</p>;
  }
}

function QuoteCardView({ card, state, clientId, allowSimulate, onChange }: {
  card: NonNullable<Extract<AgentEvent, { type: "quote" }>["card"]>;
  state: "open" | "closed" | "none";
  clientId: string | null;
  allowSimulate: boolean;
  onChange: () => void;
}) {
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const underBudget = card.budgetCents == null ? null : card.budgetCents - card.totalCents;

  const approve = async () => {
    setBusy(true);
    try {
      await postJson("/api/agent/approve", { approvalId: card.approvalId });
      setApproved(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusy(false);
    }
  };
  const change = async () => {
    setBusy(true);
    try {
      await postJson("/api/agent/cancel", { approvalId: card.approvalId });
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4" aria-labelledby="quote-h">
      <h2 id="quote-h" className="text-xl font-bold">Your quote: {card.deviceLabel}</h2>
      <ul className="divide-y divide-border text-sm">
        {card.lines.map((l) => <li key={l.label} className="flex justify-between gap-3 py-2"><span>{l.label}</span><span>{formatUsd(l.cents)}</span></li>)}
        <li className="flex justify-between gap-3 py-2 text-base font-bold"><span>Total</span><span>{formatUsd(card.totalCents)}</span></li>
      </ul>
      {card.budgetCents != null && (
        <p className="text-sm">
          Budget {formatUsd(card.budgetCents)}: <strong>{underBudget! >= 0 ? `${formatUsd(underBudget!)} under budget` : `${formatUsd(-underBudget!)} over`}</strong>
        </p>
      )}
      <p className="text-sm"><strong>{card.technician.name}</strong>: {card.technician.reasons.join(", ")}. <Link className="underline" href={`/tech/${card.technician.id}`}>See verified profile</Link></p>
      <p className="rounded-lg bg-primary-soft p-3 text-sm">
        Fee split: the technician receives <strong>{formatUsd(card.technicianPayoutCents)}</strong> after a <strong>{formatUsd(card.platformFeeCents)}</strong> platform fee, and only once you confirm the repair.
        Your payment is authorized, not captured, until then.
      </p>

      {state === "closed" ? (
        <p role="status" className="text-sm font-medium">This quote is no longer open (cancelled, expired or already paid). <Link className="underline" href={`/jobs/${card.jobId}`}>View the job</Link></p>
      ) : !approved ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve and continue to PayPal"}</Button>
          <Button variant="outline" onClick={change} disabled={busy}>Change request</Button>
          <p className="w-full text-xs text-muted">The approval is valid for 15 minutes and is bound to exactly these items and this total.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p role="status" className="text-sm font-medium">Approved by you. Now pay with PayPal (your approval token is used once per PayPal order).</p>
          <PayPalCheckout jobId={card.jobId} clientId={clientId} getApprovalToken={async () => (await postJson<{ token: string }>("/api/agent/approve", { approvalId: card.approvalId })).token} />
          {allowSimulate && (
            <form action={simulateApprovalAction} className="rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3 text-sm">
              <input type="hidden" name="jobId" value={card.jobId} />
              <p className="mb-2 font-semibold">DEV ONLY: skip PayPal approval (SIMULATED)</p>
              <Button variant="outline" type="submit">Simulate buyer approval</Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
