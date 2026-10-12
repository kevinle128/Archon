import * as React from 'react';

import { cn } from '@/lib/utils';

interface ListRowProps extends React.ComponentProps<'div'> {
  selected?: boolean;
}

/** Selectable list row: 3px left bar, selection background on hover and when selected. */
function ListRow({ selected = false, className, ...props }: ListRowProps) {
  return (
    <div
      data-slot="list-row"
      data-selected={selected ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'border-border hover:bg-selection border-b border-l-[3px] px-4 py-3',
        selected ? 'border-l-accent bg-selection' : 'border-l-transparent',
        className
      )}
      {...props}
    />
  );
}

export { ListRow };
export type { ListRowProps };
