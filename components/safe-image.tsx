"use client";
import { useState } from "react";

/** An uploaded photo that degrades to a short note if the file is gone (uploads are ephemeral on a free host). */
export function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">The photo is no longer available (the demo server clears uploads when it restarts).</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
