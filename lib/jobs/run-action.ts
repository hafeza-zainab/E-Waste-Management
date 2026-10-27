import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { assertRate } from "@/lib/security/rate-limit";
import { ActionError } from "./permissions";

/** Runs a lifecycle action, then redirects back with `?error=` or `?ok=` so the page can show the outcome. */
export async function runAction(back: string, fn: () => Promise<{ ok: false; error: string } | unknown>, okMessage: string): Promise<never> {
  let msg: { key: "ok" | "error"; text: string };
  try {
    await assertRate("action");
    const r = await fn();
    const failed = r && typeof r === "object" && "ok" in r && r.ok === false;
    msg = failed ? { key: "error", text: String((r as unknown as { error: string }).error) } : { key: "ok", text: okMessage };
  } catch (e) {
    // redirect() throws a special error; none of our actions call it, so anything here is a real failure.
    msg = { key: "error", text: e instanceof ActionError || e instanceof Error ? e.message : "Something went wrong." };
    if (!(e instanceof ActionError)) log.error("action_failed", { error: e instanceof Error ? e.message : "unknown" });
  }
  revalidatePath("/", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${msg.key}=${encodeURIComponent(msg.text)}`);
}
