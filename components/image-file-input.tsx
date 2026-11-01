"use client";
import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { IMAGE_ACCEPT, imageSelectionError } from "@/lib/image-upload";

/** Keep a native FileList for FormData, refs and native file drops. */
export const ImageFileInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "accept" | "multiple">>(
  function ImageFileInput({ onChange, "aria-describedby": describedBy, ...props }, ref) {
    const [error, setError] = useState<string | null>(null);
    const errorId = useId();
    return (
      <>
        <input {...props} ref={ref} type="file" accept={IMAGE_ACCEPT}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            const message = file ? imageSelectionError(file) : null;
            event.currentTarget.setCustomValidity(message ?? "");
            setError(message);
            onChange?.(event);
          }} />
        {error && <p id={errorId} role="alert" className="mt-1 text-sm text-red-800">{error}</p>}
      </>
    );
  },
);
