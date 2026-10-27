import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { certificateId } from "@/lib/donations/amount";
import { certificateAvailable } from "@/lib/donations/service";
import { formatUsd } from "@/lib/jobs/money";
import { impactLine } from "@/lib/pdf/certificate";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";

/** Reachable only with the unguessable public id. Shows no PayPal ids. */
export default async function Thanks(props: PageProps<"/donate/thanks/[publicId]">) {
  const { publicId } = await props.params;
  if (!z.string().uuid().safeParse(publicId).success) notFound();
  const d = await db.donation.findUnique({ where: { publicId } });
  if (!d) notFound();
  const done = certificateAvailable(d);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {done ? (
        <>
          <div>
            <h1 className="text-3xl font-bold">Thank you{d.donorName !== "Anonymous" ? `, ${d.donorName.split(" ")[0]}` : ""}!</h1>
            <p className="mt-1 text-muted">Your {formatUsd(d.amountCents)} donation to the Refurbish &amp; Donate Fund is complete. {d.simulated && <Badge tone="warn">SIMULATED</Badge>}</p>
          </div>
          <Card className="space-y-3">
            <p>{impactLine(d.amountCents)}</p>
            <p className="text-sm text-muted">Certificate ID {certificateId(d.publicId)}. Demo certificate: not a receipt, no tax-deductibility is implied.</p>
            <a href={`/donate/certificate/${d.publicId}`} download className={buttonVariants()}>Download certificate (PDF)</a>
          </Card>
        </>
      ) : (
        <Card className="space-y-2" role="status">
          <h1 className="text-2xl font-bold">{d.status === "pending" ? "Your donation is processing" : "This donation is not complete"}</h1>
          <p className="text-muted">
            {d.status === "pending"
              ? "PayPal is still confirming the payment. Refresh in a minute; the certificate appears as soon as it is confirmed."
              : "No payment was taken for this attempt, so there is no certificate."}
          </p>
        </Card>
      )}
      <Link href="/donate" className="text-primary underline">Back to the fund</Link>
    </div>
  );
}
