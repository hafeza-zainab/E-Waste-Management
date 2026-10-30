import Link from "next/link";
import { getViewer } from "@/lib/session";

const linkClass = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-primary-soft";

export async function SiteHeader() {
  const { user, tour, principal } = await getViewer();
  // The guided demo shows both sides, so its caption can walk from one to the other.
  const links = [
    { href: "/agent", label: "Agent" },
    ...(tour || principal?.kind === "owner" ? [{ href: "/owner", label: "My repairs" }] : []),
    ...(tour || principal?.kind === "technician" ? [{ href: "/technician", label: "Technician" }] : []),
    { href: "/donate", label: "Donate" },
    { href: "/impact", label: "Impact" },
  ];
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex min-h-11 items-center gap-2 text-xl font-bold text-primary">
          <span aria-hidden>♻</span> ReLoop
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} data-tour={`nav-${l.href.slice(1)}`} className={linkClass}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-tour="account-area">
          {tour ? (
            <span className="text-muted">Guided demo</span>
          ) : user ? (
            <>
              <span>
                <strong>{user.isGuest ? "Guest" : user.name}</strong>
                <span className="text-muted"> · {user.isGuest ? "demo owner" : user.role}</span>
              </span>
              {user.isGuest && <Link href="/signup" className="min-h-11 content-center text-primary underline">Create an account to keep your data</Link>}
              <form action="/api/auth/logout" method="post">
                <button className="min-h-11 rounded-lg border border-border px-4 font-semibold hover:bg-primary-soft">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={linkClass}>Log in</Link>
              <Link href="/signup" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-white hover:bg-primary-hover">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
