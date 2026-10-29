"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({ children, pendingText, tour }: { children: React.ReactNode; pendingText: string; /** data-tour hook for the guided demo */ tour?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} data-tour={tour}>
      {pending ? (
        <>
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          {pendingText}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
