import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

type UnderlineTabsSize = 'list' | 'node';

const UnderlineTabsSizeContext = React.createContext<UnderlineTabsSize>('list');

const LIST_SIZE_CLASS: Record<UnderlineTabsSize, string> = {
  list: 'text-xs',
  node: 'text-[13px]',
};

const TRIGGER_SIZE_CLASS: Record<UnderlineTabsSize, string> = {
  list: 'border-b-2 px-3 py-2 text-xs',
  node: 'border-b-[3px] px-4 py-2.5 text-[13px]',
};

interface UnderlineTabsProps extends React.ComponentProps<typeof TabsPrimitive.Root> {
  /** `list` is 12px with a 2px underline. `node` is 13px with a 3px underline. */
  size?: UnderlineTabsSize;
}

function UnderlineTabs({ size = 'list', className, ...props }: UnderlineTabsProps) {
  return (
    <UnderlineTabsSizeContext.Provider value={size}>
      <TabsPrimitive.Root
        data-slot="underline-tabs"
        className={cn('flex flex-col', className)}
        {...props}
      />
    </UnderlineTabsSizeContext.Provider>
  );
}

function UnderlineTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const size = React.useContext(UnderlineTabsSizeContext);
  return (
    <TabsPrimitive.List
      data-slot="underline-tabs-list"
      className={cn('border-border flex border-b', LIST_SIZE_CLASS[size], className)}
      {...props}
    />
  );
}

function UnderlineTabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const size = React.useContext(UnderlineTabsSizeContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="underline-tabs-trigger"
      className={cn(
        'text-text-secondary hover:text-text-primary data-[state=active]:text-text-primary data-[state=active]:border-accent -mb-px inline-flex items-center gap-1.5 border-transparent font-semibold whitespace-nowrap disabled:pointer-events-none disabled:opacity-50',
        TRIGGER_SIZE_CLASS[size],
        className
      )}
      {...props}
    />
  );
}

function UnderlineTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="underline-tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { UnderlineTabs, UnderlineTabsList, UnderlineTabsTrigger, UnderlineTabsContent };
export type { UnderlineTabsProps, UnderlineTabsSize };
