"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { diagnose, generateGuide } from "@/lib/ai/diagnosis";
import { DiagnosisSchema, IntakeSchema } from "@/lib/ai/schemas";
import { createQuotedJob } from "@/lib/jobs/service";
import { getPrincipalOrNull } from "@/lib/session";
import { loadOwnedDevice } from "@/lib/auth/access";
import { saveImageUpload } from "@/lib/uploads";
import { currentTourRunId } from "@/lib/tour/server";
import { SCENARIO_INTAKE, type ScenarioKey } from "@/lib/ai/fixtures";
import { assertRate, RateLimitError } from "@/lib/security/rate-limit";
import { advancePickup, bookPickup, PickupError } from "@/lib/recycling/pickup";

function back(message: string, scenario?: string): never {
  const q = new URLSearchParams({ error: message });
  if (scenario) q.set("scenario", scenario);
  redirect(`/owner/new?${q.toString()}`);
}

export async function createDevice(formData: FormData) {
  const parsed = IntakeSchema.safeParse({
    type: formData.get("type"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    ageYears: formData.get("ageYears"),
    problem: formData.get("problem"),
    scenario: formData.get("scenario") || undefined,
  });
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Please check the form.", String(formData.get("scenario") ?? ""));
  let intake = parsed.data;
  // A demo scenario owns the device identity: whatever the form (or browser autofill) sent, the device,
  // diagnosis and job pages all show the scenario's own type, brand, model and age.
  if (intake.scenario && intake.scenario in SCENARIO_INTAKE) {
    const fixed = SCENARIO_INTAKE[intake.scenario as ScenarioKey];
    intake = { ...intake, type: fixed.type, brand: fixed.brand, model: fixed.model, ageYears: fixed.ageYears };
  }

  let deviceId: string;
  try {
    await assertRate("diagnosis");
    await assertRate("upload");
    const photo = await saveImageUpload(formData.get("photo"));
    const tourRunId = await currentTourRunId(); // guided demo: scripted diagnosis only, record tagged for cleanup
    const result = await diagnose(intake, photo ? { mediaType: photo.mediaType, base64: photo.base64 } : undefined, { scripted: !!tourRunId });
    const who = await getPrincipalOrNull();
    if (!who) throw new Error("Please log in or continue as a guest first.");
    if (who.kind !== "owner") throw new Error("Only device owners can diagnose devices.");
    const device = await db.device.create({
      data: {
        ownerId: who.ownerId,
        type: intake.type,
        brand: intake.brand,
        model: intake.model,
        ageYears: intake.ageYears,
        problem: intake.problem,
        photoPath: photo?.publicPath,
        scenario: intake.scenario,
        diagnosisJson: JSON.stringify(result.diagnosis),
        diagnosisSource: result.source,
        ...(tourRunId ? { isTour: true, tourRunId } : {}),
      },
    });
    deviceId = device.id;
  } catch (e) {
    back(e instanceof Error ? e.message : "Something went wrong. Please try again.", intake.scenario);
  }
  redirect(`/owner/device/${deviceId}`);
}

export async function createQuote(formData: FormData) {
  const deviceId = String(formData.get("deviceId") ?? "");
  const pickup = formData.get("pickup") === "on";
  let jobId: string;
  try {
    await assertRate("action");
    const who = await getPrincipalOrNull();
    if (!who || !(await loadOwnedDevice(who, deviceId))) throw new Error("Device not found.");
    jobId = (await createQuotedJob(deviceId, pickup)).id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not build a quote.";
    redirect(`/owner/device/${deviceId}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/jobs/${jobId}`);
}

export async function bookRecycling(formData: FormData) {
  const deviceId = String(formData.get("deviceId") ?? "");
  let msg: string;
  try {
    await assertRate("action");
    const who = await getPrincipalOrNull();
    if (!who || !(await loadOwnedDevice(who, deviceId))) throw new PickupError("Device not found.");
    await bookPickup({ deviceId, address: String(formData.get("address") ?? ""), pickupDate: String(formData.get("pickupDate") ?? "") });
    msg = "ok=" + encodeURIComponent("Pickup booked with the demo recycling partner.");
  } catch (e) {
    msg = "error=" + encodeURIComponent(e instanceof PickupError || e instanceof RateLimitError ? e.message : "Could not book the pickup.");
  }
  redirect(`/owner/device/${deviceId}?${msg}`);
}

/** Demo/dev only: stands in for the recycler collecting and processing the device. */
export async function advanceRecycling(formData: FormData) {
  const deviceId = String(formData.get("deviceId") ?? "");
  let msg: string;
  try {
    const who = await getPrincipalOrNull();
    if (!who || !(await loadOwnedDevice(who, deviceId))) throw new PickupError("Device not found.");
    const s = await advancePickup(deviceId);
    msg = "ok=" + encodeURIComponent(`Demo recycler marked it ${s}.`);
  } catch (e) {
    msg = "error=" + encodeURIComponent(e instanceof PickupError ? e.message : "Could not update the pickup.");
  }
  redirect(`/owner/device/${deviceId}?${msg}`);
}

export async function createGuide(formData: FormData) {
  const id = String(formData.get("deviceId") ?? "");
  const who = await getPrincipalOrNull();
  const device = who ? await loadOwnedDevice(who, id) : null;
  if (!device?.diagnosisJson) redirect("/owner");
  const diagnosis = DiagnosisSchema.parse(JSON.parse(device.diagnosisJson));
  let error: string | null = null;
  try {
    await assertRate("diagnosis");
    const guide = await generateGuide(device, diagnosis);
    await db.device.update({ where: { id }, data: { guideJson: JSON.stringify(guide) } });
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not generate the guide.";
  }
  redirect(error ? `/owner/device/${id}?error=${encodeURIComponent(error)}` : `/owner/device/${id}/guide`);
}
