"use client";

import { sanitizePointDraft } from "@/lib/scoring";
import { Input } from "@/components/ui/input";

export function PointAdjustmentInput({
  value,
  onValueChange,
  onBlur,
  disabled = false,
  name,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  name?: string;
  label: string;
}) {
  return (
    <Input
      name={name}
      aria-label={label}
      autoComplete="off"
      value={value}
      disabled={disabled}
      className="mx-auto h-8 w-16 px-1 text-center tabular-nums"
      onChange={(event) => onValueChange(sanitizePointDraft(event.target.value))}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
