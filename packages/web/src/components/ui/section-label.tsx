import * as React from 'react';

import { cn } from '@/lib/utils';

/** Small uppercase label that titles a block of content. */
function SectionLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="section-label"
      className={cn(
        'text-text-secondary text-[11px] font-semibold tracking-[0.08em] uppercase',
        className
      )}
      {...props}
    />
  );
}

export { SectionLabel };
