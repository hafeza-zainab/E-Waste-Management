import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDevice } from "../app/owner/actions";
import { SCENARIO_INTAKE } from "@/lib/ai/fixtures";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/db", () => ({ db: { device: { create: mocks.create } } }));
vi.mock("@/lib/jobs/service", () => ({ createQuotedJob: vi.fn() }));
vi.mock("@/lib/session", () => ({ getPrincipalOrNull: async () => ({ kind: "owner", ownerId: "tour-owner" }) }));
vi.mock("@/lib/auth/access", () => ({ loadOwnedDevice: vi.fn() }));
vi.mock("@/lib/tour/server", () => ({ currentTourRunId: async () => "tour-run" }));
vi.mock("@/lib/security/rate-limit", () => ({ assertRate: async () => {}, RateLimitError: class extends Error {} }));
vi.mock("@/lib/recycling/pickup", () => ({ advancePickup: vi.fn(), bookPickup: vi.fn(), PickupError: class extends Error {} }));

beforeEach(() => { mocks.create.mockReset(); mocks.create.mockResolvedValue({ id: "swollen-device" }); });

describe("tour safety diagnosis with an unselected optional photo", () => {
  it.each(["absent", "empty-string", "", "blob", "undefined", "empty.jpg"])(
    "reaches the high-risk diagnosis instead of returning to intake (%s)", async name => {
      const form = new FormData();
      for (const [key, value] of Object.entries(SCENARIO_INTAKE["swollen-battery"])) form.set(key, String(value));
      form.set("scenario", "swollen-battery");
      if (name === "empty-string") form.set("photo", "");
      else if (name !== "absent") form.set("photo", new File([], name, { type: "application/octet-stream" }));
      // Exercise the multipart boundary as well as the actual Server Action.
      const parsed = await new Request("http://localhost/owner/new", { method: "POST", body: form }).formData();
      await expect(createDevice(parsed)).rejects.toThrow("redirect:/owner/device/swollen-device");
      expect(mocks.create).toHaveBeenCalledOnce();
      const data = mocks.create.mock.calls[0][0].data;
      const diagnosis = JSON.parse(data.diagnosisJson);
      expect(data).toMatchObject({ scenario: "swollen-battery", isTour: true, tourRunId: "tour-run" });
      expect(diagnosis.safety_risk.level).toBe("high");
      expect(diagnosis.diy_allowed).toBe(false);
      expect(data.photoPath).toBeUndefined();
    },
  );
});
