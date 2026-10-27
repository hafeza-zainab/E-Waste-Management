import { describe, expect, it } from "vitest";
import { ALL_STATUSES, TRANSITIONS, canTransition, assertTransition, type Actor } from "@/lib/jobs/state-machine";
import { ACTION_RULES, ActionError, checkPermission, type Action, type Principal } from "@/lib/jobs/permissions";

const ACTORS: Actor[] = ["owner", "technician", "system"];

describe("transition table", () => {
  it("allows exactly the listed (from, to, actor) triples and rejects every other combination", () => {
    for (const from of ALL_STATUSES)
      for (const to of ALL_STATUSES)
        for (const actor of ACTORS) {
          const listed = TRANSITIONS.some((r) => r.from === from && r.to === to && r.actors.includes(actor));
          expect(canTransition(from, to, actor), `${from}->${to} by ${actor}`).toBe(listed);
        }
  });
  it("covers the documented lifecycle with the right actors", () => {
    expect(canTransition("quoted", "paid", "system")).toBe(true);
    expect(canTransition("paid", "accepted", "technician")).toBe(true);
    expect(canTransition("accepted", "in_progress", "technician")).toBe(true);
    expect(canTransition("in_progress", "completed", "technician")).toBe(true);
    expect(canTransition("completed", "customer_confirmed", "owner")).toBe(true);
    expect(canTransition("customer_confirmed", "payout_released", "system")).toBe(true);
    expect(canTransition("customer_confirmed", "payout_failed", "system")).toBe(true);
    expect(canTransition("payout_failed", "payout_released", "system")).toBe(true);
    expect(canTransition("paid", "cancelled", "owner")).toBe(true);
    expect(canTransition("completed", "authorization_expired", "system")).toBe(true);
  });
  it("rejects wrong actors, skips, reversals and leaving terminal states", () => {
    expect(canTransition("completed", "customer_confirmed", "technician")).toBe(false); // can't confirm own job
    expect(canTransition("completed", "customer_confirmed", "system")).toBe(false);
    expect(canTransition("paid", "accepted", "owner")).toBe(false);
    expect(canTransition("quoted", "accepted", "technician")).toBe(false);
    expect(canTransition("accepted", "cancelled", "owner")).toBe(false); // cancel only before acceptance
    expect(canTransition("payout_released", "paid", "system")).toBe(false);
    for (const t of ["cancelled", "authorization_expired"] as const) for (const to of ALL_STATUSES) expect(canTransition(t, to)).toBe(false);
    expect(() => assertTransition("completed", "customer_confirmed", "technician")).toThrow(/Illegal/);
    expect(() => assertTransition("bogus", "paid", "system")).toThrow(/Illegal/);
  });
});

describe("role enforcement per action", () => {
  const owner: Principal = { kind: "owner", ownerId: "o1" };
  const otherOwner: Principal = { kind: "owner", ownerId: "o2" };
  const tech: Principal = { kind: "technician", techId: "t1" };
  const otherTech: Principal = { kind: "technician", techId: "t2" };
  const stateFor = (a: Action) => ACTION_RULES[a].from[0];
  const job = (a: Action) => ({ status: stateFor(a), technicianId: "t1", ownerId: "o1" });
  const technicianOnly: Action[] = ["accept", "decline", "start", "complete", "upload_proof"];
  const ownerOnly: Action[] = ["confirm", "report", "cancel", "rate"];

  it.each(technicianOnly)("%s: only the assigned technician", (a) => {
    expect(() => checkPermission(a, tech, job(a))).not.toThrow();
    for (const who of [otherTech, owner]) expect(() => checkPermission(a, who, job(a))).toThrow(ActionError);
  });
  it.each(ownerOnly)("%s: only the job's owner", (a) => {
    expect(() => checkPermission(a, owner, job(a))).not.toThrow();
    for (const who of [otherOwner, tech, otherTech]) expect(() => checkPermission(a, who, job(a))).toThrow(ActionError);
  });
  it("retry_payout: the owner or the assigned technician, nobody else", () => {
    const j = { status: "payout_failed", technicianId: "t1", ownerId: "o1" };
    expect(() => checkPermission("retry_payout", owner, j)).not.toThrow();
    expect(() => checkPermission("retry_payout", tech, j)).not.toThrow();
    expect(() => checkPermission("retry_payout", otherTech, j)).toThrow(ActionError);
    expect(() => checkPermission("retry_payout", otherOwner, j)).toThrow(ActionError);
  });
  it("a technician can never confirm their own job", () => {
    expect(() => checkPermission("confirm", tech, { status: "completed", technicianId: "t1", ownerId: "o1" })).toThrow(/owner/);
  });
  it("rejects the right actor in the wrong state", () => {
    expect(() => checkPermission("confirm", owner, { status: "in_progress", technicianId: "t1", ownerId: "o1" })).toThrow(/can't be done/);
    expect(() => checkPermission("cancel", owner, { status: "accepted", technicianId: "t1", ownerId: "o1" })).toThrow(ActionError);
  });
});
