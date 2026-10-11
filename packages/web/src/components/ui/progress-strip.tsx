import * as React from 'react';

import { getStatusPresentation, STATUS_TONE_SEGMENT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';

interface ProgressStripProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** One status per item, in order. */
  statuses: readonly string[];
}

/** One 4px segment per item, 2px apart, colored by status. */
function ProgressStrip({ statuses, className, ...props }: ProgressStripProps) {
  const done = statuses.filter(s => getStatusPresentation(s).tone === 'done').length;
  return (
    <div
      role="img"
      aria-label={`${String(done)} of ${String(statuses.length)} done`}
      data-slot="progress-strip"
      className={cn('flex h-1 gap-0.5', className)}
      {...props}
    >
      {statuses.map((status, index) => (
        <span
          // Items are positional and never reorder, so the index is a stable key.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          data-segment={getStatusPresentation(status).tone}
          className={cn(
            'h-full min-w-0 flex-1',
            STATUS_TONE_SEGMENT_CLASS[getStatusPresentation(status).tone]
          )}
        />
      ))}
    </div>
  );
}

export { ProgressStrip };
export type { ProgressStripProps };
