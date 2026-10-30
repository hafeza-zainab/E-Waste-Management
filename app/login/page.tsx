import Link from "next/link";
import { redirect } from "next/navigation";
import { GuestButton, LoginForm } from "@/components/auth/auth-forms";
import { Card } from "@/components/ui/card";
import { homeFor, safeNext } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/sessions";

export const metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined, "");
  const user = await getSessionUser();
  if (user) redirect(safeNext(next, homeFor(user.role)));
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Log in</h1>
        <p className="mt-1 text-muted">New here? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-primary underline">Create an account</Link>.</p>
      </div>
      <Card className="space-y-4">
        <LoginForm next={next || undefined} />
      </Card>
      <Card className="space-y-2">
        <h2 className="text-lg font-bold">Just looking around?</h2>
        <GuestButton next={next || undefined} />
      </Card>
    </div>
  );
}
