import Link from "next/link";
import { redirect } from "next/navigation";
import { GuestButton, SignupForm } from "@/components/auth/auth-forms";
import { JudgeDemoAccounts } from "@/components/auth/judge-demo-accounts";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StartTourButton } from "@/components/tour/tour-host";
import { homeFor, safeNext } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/sessions";

export const metadata = { title: "Sign up" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined, "");
  const user = await getSessionUser();
  if (user && !user.isGuest) redirect(homeFor(user.role));
  const tour = process.env.DEMO_ACTIONS === "true";
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Create your account</h1>
        <p className="mt-1 text-muted">Already have one? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-primary underline">Log in</Link>.</p>
      </div>
      <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-950">
        <strong>Use a throwaway password.</strong> This is a demo; the database resets when the server redeploys.
      </p>
      <Card className="space-y-4">
        <JudgeDemoAccounts />
        <SignupForm next={next || undefined} />
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Just looking around?</h2>
        <GuestButton next={next || undefined} />
        {tour && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm text-muted">Or watch a narrated, hands-off walkthrough. It never fills in or submits this form and never creates an account.</p>
            <StartTourButton returnTo="/signup" className={buttonVariants({ className: "bg-amber-500 text-slate-950 hover:bg-amber-400" })} />
          </div>
        )}
      </Card>
    </div>
  );
}
