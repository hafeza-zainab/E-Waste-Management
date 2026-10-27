import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <p className="text-5xl" aria-hidden>🔌</p>
      <h1 className="text-3xl font-bold">We couldn&apos;t find that page</h1>
      <p className="text-muted">The link may be old, or the demo database was reset (the free demo server clears its data when it restarts).</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonVariants()}>Back to the start</Link>
        <Link href="/agent" className={buttonVariants({ variant: "outline" })}>Open the agent</Link>
      </div>
    </div>
  );
}
