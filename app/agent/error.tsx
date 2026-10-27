"use client";

export default function AgentError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
      <p className="font-semibold">The agent page hit a problem. Nothing was charged.</p>
      <button onClick={reset} className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-white">Try again</button>
    </div>
  );
}
