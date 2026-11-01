import { describe, expect, it, vi } from "vitest";
import { requestLogout } from "@/components/auth/logout-button";

describe("logout button request", () => {
  it("posts the same-origin session and requests JSON without following a form redirect", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await expect(requestLogout(send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" },
    });
  });
  it("does not report success when the server rejects logout", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Request blocked" }, { status: 403 }));
    await expect(requestLogout(send)).rejects.toThrow("Request blocked");
  });
  it("does not silently accept an unexpected HTML response or network failure", async () => {
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>unexpected redirect</html>"));
    await expect(requestLogout(html)).rejects.toThrow(/Could not log out/);
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("Network failed"));
    await expect(requestLogout(offline)).rejects.toThrow("Network failed");
  });
});
