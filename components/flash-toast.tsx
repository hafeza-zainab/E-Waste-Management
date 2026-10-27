"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Pages whose action results (?ok= / ?error=) are shown as toasts. Form pages (/owner/new) and the diagnosis
// page keep their persistent inline errors.
const TOAST_ERRORS = [/^\/jobs\//, /^\/technician/, /^\/donate/];
const TOAST_OK = [...TOAST_ERRORS, /^\/owner\/device\//];

/** Shows the result of a server action as a toast, then removes it from the URL so a reload doesn't repeat it. */
export function FlashToast() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const ok = sp.get("ok");
    const err = sp.get("error");
    const showOk = ok && TOAST_OK.some((r) => r.test(pathname));
    const showErr = err && TOAST_ERRORS.some((r) => r.test(pathname));
    if (!showOk && !showErr) return;
    if (showOk) toast.success(ok);
    if (showErr) toast.error(err, { duration: 9000 });
    const next = new URLSearchParams(sp.toString());
    next.delete("ok");
    next.delete("error");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [sp, pathname, router]);
  return null;
}
