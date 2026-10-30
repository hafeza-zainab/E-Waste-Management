import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { wipeAll } from "./helpers/wipe";
import { authenticate } from "@/lib/auth/accounts";
import { DEFAULT_DEMO_PASSWORD, DEMO_OWNER_EMAIL, DEMO_TECH_EMAIL, NO_PASSWORD } from "@/lib/auth/constants";
import { ensureDemoAccounts } from "@/lib/auth/demo";
import { evaluateStartup } from "@/lib/security/startup";

beforeEach(async () => {
  await wipeAll();
});

describe("demo accounts", () => {
  it("makes the demo owner and demo technician log-in-able on a migrated database; other technicians stay unusable", async () => {
    // As the auth migration leaves them: linked users with no usable password.
    for (const [id, name, email, role] of [["o1", "Demo Owner", DEMO_OWNER_EMAIL, "owner"], ["t1", "Aisha Rahman", "tech-t1@reloop.invalid", "technician"], ["t2", "Diego Martins", "tech-t2@reloop.invalid", "technician"]] as const) {
      const u = await db.user.create({ data: { id: `usr_${id}`, name, email, passwordHash: NO_PASSWORD, role } });
      if (role === "owner") await db.owner.create({ data: { id, name, email, userId: u.id } });
      else await db.technician.create({ data: { id, name, city: "C", bio: "b", skills: "phone", rating: 4, distanceKm: 1, hourlyCents: 1, paypalEmail: "p@x.test", userId: u.id } });
    }
    await ensureDemoAccounts(db, {});
    expect((await authenticate(DEMO_OWNER_EMAIL, DEFAULT_DEMO_PASSWORD))?.role).toBe("owner");
    expect((await authenticate(DEMO_TECH_EMAIL, DEFAULT_DEMO_PASSWORD))?.role).toBe("technician");
    expect(await authenticate(DEMO_TECH_EMAIL, "wrong password here")).toBeNull();
    expect(await authenticate("tech-t2@reloop.invalid", DEFAULT_DEMO_PASSWORD)).toBeNull();
    expect((await db.technician.findUniqueOrThrow({ where: { id: "t1" } })).userId).toBe("usr_t1"); // same row, linked, nothing recreated
  });
  it("uses DEMO_ACCOUNT_PASSWORD when set, and is idempotent", async () => {
    const u = await db.user.create({ data: { name: "Demo Owner", email: DEMO_OWNER_EMAIL, passwordHash: NO_PASSWORD, role: "owner" } });
    await db.owner.create({ data: { name: "Demo Owner", email: DEMO_OWNER_EMAIL, userId: u.id } });
    await ensureDemoAccounts(db, { DEMO_ACCOUNT_PASSWORD: "my own demo password" });
    await ensureDemoAccounts(db, { DEMO_ACCOUNT_PASSWORD: "my own demo password" });
    expect(await authenticate(DEMO_OWNER_EMAIL, "my own demo password")).toBeTruthy();
    expect(await authenticate(DEMO_OWNER_EMAIL, DEFAULT_DEMO_PASSWORD)).toBeNull();
  });
});

describe("startup self-check for accounts", () => {
  const prod = { NODE_ENV: "production" };
  it("reports the auth mode and never includes secrets", () => {
    const r = evaluateStartup({ ...prod, NEXT_PUBLIC_APP_URL: "https://reloop.example.com", DEMO_ACCOUNT_PASSWORD: "a-secret-demo-password" });
    expect(r.fatal).toEqual([]);
    expect(r.modes.auth).toMatch(/scrypt.*secure.*httpOnly.*SameSite=Lax/);
    expect(JSON.stringify(r)).not.toContain("a-secret-demo-password");
  });
  it("refuses to start in production on a public http URL, an invalid URL, or a too-short demo password", () => {
    expect(evaluateStartup({ ...prod, NEXT_PUBLIC_APP_URL: "http://reloop.example.com" }).fatal[0]).toMatch(/https/);
    expect(evaluateStartup({ ...prod, NEXT_PUBLIC_APP_URL: "not a url" }).fatal[0]).toMatch(/valid URL/);
    expect(evaluateStartup({ ...prod, DEMO_ACCOUNT_PASSWORD: "short" }).fatal[0]).toMatch(/10-character/);
  });
  it("allows http on localhost (local production build) and in development", () => {
    expect(evaluateStartup({ ...prod, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).fatal).toEqual([]);
    expect(evaluateStartup({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://example.com" }).fatal).toEqual([]);
  });
});
void vi;
