import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  id: string;
  label: string;
  /** Short state shown at the right, such as a count or "2 not set". */
  hint?: string;
  /** True when the hint asks for attention. */
  hintAttention?: boolean;
}

/**
 * Settings section list. One section shows at a time; the page keeps the choice
 * in the URL. Items are supplied by the page so hidden sections leave no row.
 */
export function SettingsNav({
  items,
  active,
  onSelect,
}: {
  items: readonly SettingsNavItem[];
  active: string;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-col max-md:flex-row max-md:overflow-x-auto"
    >
      {items.map(item => {
        const current = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={current ? 'true' : undefined}
            onClick={() => {
              onSelect(item.id);
            }}
            className={cn(
              'flex shrink-0 cursor-pointer items-baseline justify-between gap-2 border-l-[3px] px-4 py-2.5 text-left text-sm font-semibold whitespace-nowrap hover:bg-selection',
              current ? 'border-l-accent bg-selection' : 'border-l-transparent'
            )}
          >
            <span>{item.label}</span>
            {item.hint !== undefined ? (
              <span
                className={cn(
                  'text-xs font-normal',
                  item.hintAttention === true ? 'text-status-waiting' : 'text-text-secondary'
                )}
              >
                {item.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
