import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentTechnician, getSession } from "@/lib/session";
import { switchRole } from "@/lib/actions";

const links = [
  { href: "/agent", label: "Agent" },
  { href: "/owner", label: "My repairs" },
  { href: "/technician", label: "Technician" },
  { href: "/donate", label: "Donate" },
  { href: "/impact", label: "Impact" },
];

export async function SiteHeader() {
  const { role } = await getSession();
  const current = await getCurrentTechnician();
  const techs = await db.technician.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-primary">
          <span aria-hidden>♻</span> ReLoop
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-primary-soft">
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={switchRole} className="flex flex-wrap items-center gap-2">
          <label htmlFor="role" className="text-sm text-muted">Demo role</label>
          <select id="role" name="role" defaultValue={role} className="min-h-11 rounded-lg border border-border bg-white px-2 text-sm">
            <option value="owner">Owner</option>
            <option value="technician">Technician</option>
          </select>
          <label htmlFor="techId" className="sr-only">Acting as technician</label>
          <select id="techId" name="techId" defaultValue={current.id} className="min-h-11 rounded-lg border border-border bg-white px-2 text-sm">
            {techs.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">Switch</button>
        </form>
      </div>
    </header>
  );
}
