import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const steps = [
  { n: 1, title: "Describe", text: "Tell us the device and what went wrong. Add a photo if you like." },
  { n: 2, title: "AI diagnoses", text: "Likely causes, severity and a hard safety check. Risky devices are never sent to DIY." },
  { n: 3, title: "Book and pay", text: "An agent builds a quote and matches a technician. You approve, PayPal holds the payment." },
  { n: 4, title: "Verified payout", text: "The technician is paid only after you confirm the repair. Their record grows." },
];

const scenarios = [
  { key: "cracked-screen", title: "Cracked phone screen", text: "Galaxy A52, budget $60. Agent quotes a repair and checks out with PayPal." },
  { key: "swollen-battery", title: "Swollen laptop battery", text: "Safety gate blocks DIY and routes to a technician." },
  { key: "dead-tv", title: "Dead 14-year-old TV", text: "Not worth repairing: recycle or donate path with impact." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Most e-waste could have been repaired.{" "}
          <span className="text-primary">ReLoop makes repair the easy choice.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          People don&apos;t know if a fix is safe or worth it, don&apos;t trust unknown repairers, and have no safe way
          to pay. Skilled young technicians can&apos;t prove their work. ReLoop tackles all three with an AI agent and
          PayPal.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/owner" className={buttonVariants()}>Start a repair</Link>
          <Link href="/impact" className={buttonVariants({ variant: "outline" })}>See the impact</Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-4 text-2xl font-bold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n}>
              <Card className="h-full">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-white">
                  {s.n}
                </div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="try">
        <h2 id="try" className="mb-4 text-2xl font-bold">Try a demo scenario</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {scenarios.map((s) => (
            <Card key={s.key} className="flex flex-col">
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 flex-1 text-sm text-muted">{s.text}</p>
              <Link href={`/owner?scenario=${s.key}`} className={buttonVariants({ className: "mt-4" })}>
                Try demo scenario
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
