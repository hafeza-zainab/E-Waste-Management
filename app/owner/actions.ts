"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { diagnose, generateGuide } from "@/lib/ai/diagnosis";
import { DiagnosisSchema, IntakeSchema } from "@/lib/ai/schemas";
import { getDemoOwner } from "@/lib/session";
import { saveImageUpload } from "@/lib/uploads";

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
  const intake = parsed.data;

  let deviceId: string;
  try {
    const photo = await saveImageUpload(formData.get("photo"));
    const result = await diagnose(intake, photo ? { mediaType: photo.mediaType, base64: photo.base64 } : undefined);
    const owner = await getDemoOwner();
    const device = await db.device.create({
      data: {
        ownerId: owner.id,
        type: intake.type,
        brand: intake.brand,
        model: intake.model,
        ageYears: intake.ageYears,
        problem: intake.problem,
        photoPath: photo?.publicPath,
        scenario: intake.scenario,
        diagnosisJson: JSON.stringify(result.diagnosis),
        diagnosisSource: result.source,
      },
    });
    deviceId = device.id;
  } catch (e) {
    back(e instanceof Error ? e.message : "Something went wrong. Please try again.", intake.scenario);
  }
  redirect(`/owner/device/${deviceId}`);
}

export async function createGuide(formData: FormData) {
  const id = String(formData.get("deviceId") ?? "");
  const device = await db.device.findUnique({ where: { id } });
  if (!device?.diagnosisJson) redirect("/owner");
  const diagnosis = DiagnosisSchema.parse(JSON.parse(device.diagnosisJson));
  let error: string | null = null;
  try {
    const guide = await generateGuide(device, diagnosis);
    await db.device.update({ where: { id }, data: { guideJson: JSON.stringify(guide) } });
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not generate the guide.";
  }
  redirect(error ? `/owner/device/${id}?error=${encodeURIComponent(error)}` : `/owner/device/${id}/guide`);
}
