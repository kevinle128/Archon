import * as React from 'react';

import { cn } from '@/lib/utils';

interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name for the group. */
  'aria-label': string;
  className?: string;
}

/** Segmented control with radio-group semantics. The selected segment is inverted. */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn('border-line-strong inline-flex border', className)}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => {
              onValueChange(option.value);
            }}
            className={cn(
              'h-8 px-3 text-left text-[13px] font-semibold disabled:opacity-50',
              selected
                ? 'bg-foreground text-background'
                : 'bg-card text-foreground hover:bg-selection'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
export type { SegmentedOption, SegmentedProps };
