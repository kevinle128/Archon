import * as React from 'react';

import { cn } from '@/lib/utils';

interface ColumnLayoutProps extends React.ComponentProps<'div'> {
  /** CSS grid-template-columns value, for example "minmax(240px,300px) minmax(0,1fr)". */
  columns: string;
}

/**
 * Grid that fills its parent height. Each direct child is a column that
 * scrolls on its own. The first column has a 2px strong right border.
 */
function ColumnLayout({ columns, className, style, ...props }: ColumnLayoutProps) {
  return (
    <div
      data-slot="column-layout"
      className={cn(
        'grid h-full min-h-0 [&>*]:min-h-0 [&>*]:overflow-auto [&>*:first-child]:border-r-2 [&>*:first-child]:border-line-strong',
        className
      )}
      style={{ gridTemplateColumns: columns, ...style }}
      {...props}
    />
  );
}

export { ColumnLayout };
export type { ColumnLayoutProps };
