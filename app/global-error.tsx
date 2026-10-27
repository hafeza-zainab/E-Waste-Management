"use client";

/** Last-resort error page (replaces the root layout, so it brings its own html/body and no app styles). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f6faf9", color: "#0f2a27", padding: "3rem 1rem", textAlign: "center" }}>
        <h1>ReLoop hit an unexpected error</h1>
        <p>Nothing was charged. Please try again.</p>
        <button onClick={reset} style={{ minHeight: 44, padding: "0 20px", borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", fontWeight: 600 }}>Try again</button>
      </body>
    </html>
  );
}
