"use client";

import { useRef } from "react";
import { Minus } from "lucide-react";
import { sanitizePointDraft, togglePointSign } from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PointAdjustmentInput({
  value,
  onValueChange,
  onCommit,
  onBlur,
  disabled = false,
  name,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onCommit?: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  name?: string;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const negative = value.startsWith("-");

  function apply(next: string) {
    onValueChange(next);
    onCommit?.(next);
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        type="button"
        variant={negative ? "secondary" : "outline"}
        size="icon-xs"
        disabled={disabled}
        aria-pressed={negative}
        aria-label={negative ? "Hapus tanda minus" : "Jadikan poin minus"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          apply(togglePointSign(value));
          requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
          });
        }}
      >
        <Minus />
      </Button>
      <Input
        ref={inputRef}
        name={name}
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        className="h-8 w-14 px-1 text-center tabular-nums"
        onChange={(event) => onValueChange(sanitizePointDraft(event.target.value))}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}
