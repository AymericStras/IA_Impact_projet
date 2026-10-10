"use client";

import { frVoice } from "@/i18n/fr.voice";
import { cn } from "@/lib/utils";
import type { FieldName } from "@/types/contracts";
import { SHEET_FIELDS } from "./fieldDisplay";

interface ProgressDotsProps {
  /** The server's `missing_fields`. */
  missingFields: readonly FieldName[];
  className?: string;
}

/**
 * One dot per field, filled when the server considers it known. Nothing to read: the
 * count is given to assistive technology as text, and filled / hollow differ by shape.
 */
export function ProgressDots({ missingFields, className }: ProgressDotsProps) {
  const known = SHEET_FIELDS.filter((field) => !missingFields.includes(field)).length;
  return (
    <div
      role="img"
      aria-label={frVoice.chrome.progress(known, SHEET_FIELDS.length)}
      className={cn("flex items-center gap-1.5", className)}
      data-testid="progress-dots"
      data-known={known}
    >
      {SHEET_FIELDS.map((field) => {
        const filled = !missingFields.includes(field);
        return (
          <span
            key={field}
            data-filled={filled}
            className={cn("size-2.5 rounded-full border-2", filled ? "border-highlight bg-highlight" : "border-primary-foreground bg-transparent")}
          />
        );
      })}
    </div>
  );
}
