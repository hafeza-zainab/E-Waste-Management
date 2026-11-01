"use client";
import { useState, type FormEvent } from "react";

export async function requestLogout(send: typeof fetch = fetch) {
  const response = await send("/api/auth/logout", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || result?.ok !== true) throw new Error(result?.error || "Could not log out. Please try again.");
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await requestLogout();
      // A new document discards authenticated router/layout caches as well as
      // reflecting the now-expired cookie. Only navigate after server success.
      window.location.replace("/");
    } catch {
      setError("Could not log out. Check your connection and try again.");
      setBusy(false);
    }
  }
  return (
    <form action="/api/auth/logout" method="post" onSubmit={submit} className="space-y-1">
      <button type="submit" disabled={busy} aria-busy={busy} className="min-h-11 rounded-lg border border-border px-4 font-semibold hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && <p role="alert" className="max-w-xs text-sm text-danger">{error}</p>}
    </form>
  );
}
