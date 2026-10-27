import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Technician not found</h1>
      <p className="text-muted">This profile does not exist. <Link href="/owner" className="underline">Back to my repairs</Link></p>
    </div>
  );
}
