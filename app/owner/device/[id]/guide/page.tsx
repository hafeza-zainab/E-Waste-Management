import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { DiagnosisSchema, GuideSchema } from "@/lib/ai/schemas";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function GuidePage(props: PageProps<"/owner/device/[id]/guide">) {
  const { id } = await props.params;
  const device = await db.device.findUnique({ where: { id } });
  if (!device?.diagnosisJson) notFound();
  const diagnosis = DiagnosisSchema.parse(JSON.parse(device.diagnosisJson));
  // The gate is re-checked on read, so a stored guide can never be shown for a non-DIY case.
  if (!diagnosis.diy_allowed || !device.guideJson) redirect(`/owner/device/${id}`);
  const guide = GuideSchema.parse(JSON.parse(device.guideJson));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/owner/device/${id}`} className="text-sm text-primary underline">Back to diagnosis</Link>
      <div>
        <h1 className="text-3xl font-bold">{guide.title}</h1>
        <p className="text-muted">{device.brand} {device.model} · about {guide.estimated_minutes} minutes</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-bold">Tools</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">{guide.tools.map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
        <Card>
          <h2 className="font-bold">Parts</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">{guide.parts.map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
      </div>
      <ol className="space-y-4">
        {guide.steps.map((s, i) => (
          <li key={s.title}>
            <Card className="space-y-2">
              <h2 className="text-lg font-bold">Step {i + 1}: {s.title}</h2>
              <p>{s.instruction}</p>
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                <strong>Stop and book a technician if:</strong> {s.stop_and_book_if}
              </p>
            </Card>
          </li>
        ))}
      </ol>
      <Link href={`/owner/device/${id}`} className={buttonVariants({ variant: "outline" })}>Back to diagnosis</Link>
    </div>
  );
}
