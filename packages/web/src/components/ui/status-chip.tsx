import * as React from 'react';

import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';

interface StatusChipProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  status: string;
  /** Replaces the default label, for example "Done" instead of "Completed". */
  label?: string;
}

/** Glyph and label for a status. The waiting tone is a filled chip. */
function StatusChip({ status, label, className, ...props }: StatusChipProps) {
  const presentation = getStatusPresentation(status);
  const filled = presentation.tone === 'waiting';
  return (
    <span
      data-slot="status-chip"
      data-tone={presentation.tone}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 px-1.5 py-0.5 text-[13px] leading-none font-semibold whitespace-nowrap',
        filled
          ? 'bg-status-waiting text-status-waiting-fg'
          : STATUS_TONE_TEXT_CLASS[presentation.tone],
        className
      )}
      {...props}
    >
      <span aria-hidden="true">{presentation.glyph}</span>
      <span>{label ?? presentation.label}</span>
    </span>
  );
}

export { StatusChip };
export type { StatusChipProps };
