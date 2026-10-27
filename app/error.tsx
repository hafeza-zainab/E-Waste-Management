"use client";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <p className="text-5xl" aria-hidden>🛠️</p>
      <h1 className="text-3xl font-bold">Something broke on our side</h1>
      <p className="text-muted">Nothing was charged. You can try again, or go back to the start.{error.digest ? ` (Reference ${error.digest})` : ""}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-white hover:bg-primary-hover">Try again</button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white px-5 font-semibold">Back to the start</Link>
      </div>
    </div>
  );
}
