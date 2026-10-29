import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StartTourButton } from "@/components/tour/tour-host";

const problems = [
  "People can't tell whether a fix is safe or worth it, so working devices become e-waste.",
  "Unknown repairers are hard to trust, and there is no safe way to pay before the work is done.",
  "Skilled young technicians have no way to prove their track record.",
];

const steps = [
  { n: 1, title: "Describe", text: "Tell the agent what is wrong and your budget. Add a photo if you like." },
  { n: 2, title: "Safe, priced plan", text: "AI diagnosis, then a hard safety check in code. Risky devices are never sent to DIY." },
  { n: 3, title: "You approve, PayPal holds", text: "The agent builds a quote. Only you can approve it; PayPal then holds the payment." },
  { n: 4, title: "Verified payout", text: "The technician is paid only after you confirm the repair. Their record grows." },
];

const scenarios = [
  { key: "cracked-screen", title: "Cracked phone screen", text: "Galaxy A52, budget $60. The agent finds a cheaper part, quotes it and checks out with PayPal." },
  { key: "swollen-battery", title: "Swollen laptop battery", text: "The safety gate blocks DIY and routes to a technician." },
  { key: "dead-tv", title: "Dead 14-year-old TV", text: "Not worth repairing: recycle or donate, with the impact." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-4" data-tour="hero">
        <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
          Most e-waste could have been repaired.{" "}
          <span className="text-primary">ReLoop makes repair the easy choice.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          An AI repair agent diagnoses the problem, checks it is safe, finds a technician within your budget, and PayPal holds the money until you confirm the work.
        </p>
        <p className="max-w-2xl rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-950">
          <strong>Sandbox demo.</strong> Payments use the PayPal sandbox: no real money moves, and nothing here is a real repair shop.
        </p>
        <div className="flex flex-wrap gap-3">
          {process.env.DEMO_ACTIONS === "true" && <StartTourButton className={buttonVariants({ className: "bg-amber-500 text-slate-950 hover:bg-amber-400" })} />}
          <Link href="/agent" className={buttonVariants({ variant: process.env.DEMO_ACTIONS === "true" ? "outline" : "default" })}>Try it yourself: open the agent</Link>
          <Link href="/owner/new" className={buttonVariants({ variant: "outline" })}>Diagnose manually</Link>
          <Link href="/impact" className={buttonVariants({ variant: "outline" })}>See the impact</Link>
        </div>
      </section>

      <section aria-labelledby="problem" data-tour="problem">
        <h2 id="problem" className="mb-4 text-2xl font-bold">The problem</h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {problems.map((p) => (
            <li key={p}><Card className="h-full text-sm">{p}</Card></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" data-tour="flow">
        <h2 id="how" className="mb-4 text-2xl font-bold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n}>
              <Card className="h-full">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-white" aria-hidden>{s.n}</div>
                <h3 className="font-semibold"><span className="sr-only">Step {s.n}: </span>{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="try">
        <h2 id="try" className="mb-1 text-2xl font-bold">Try a demo scenario</h2>
        <p className="mb-4 text-sm text-muted">Each button runs the full flow on a prepared device. In demo mode the AI is a scripted fixture; the safety gate, quotes and approvals are the real code.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {scenarios.map((s) => (
            <Card key={s.key} className="flex flex-col">
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 flex-1 text-sm text-muted">{s.text}</p>
              <Link href={`/owner/new?scenario=${s.key}`} data-tour={`scenario-${s.key}`} className={buttonVariants({ className: "mt-4" })}>
                Try demo scenario<span className="sr-only">: {s.title}</span>
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
