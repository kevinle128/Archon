import { useCallback, useEffect, useState, type ReactElement, type RefObject } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  id: string;
  label: string;
}

/** Offset in px below the scroll container's top edge at which a section counts as current. */
const ACTIVE_OFFSET = 48;

/**
 * In-page section index. Clicking scrolls the body to the section, and scrolling
 * keeps the highlighted item in step. Items are supplied by the page so sections
 * that are hidden (for example no web identity) never leave a dead link.
 */
export function SettingsNav({
  items,
  scrollRef,
}: {
  items: readonly SettingsNavItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const [active, setActive] = useState(items[0]?.id ?? '');

  const updateActive = useCallback((): void => {
    const container = scrollRef.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top;
    let current = items[0]?.id ?? '';
    for (const { id } of items) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top - top <= ACTIVE_OFFSET) current = id;
    }
    setActive(current);
  }, [items, scrollRef]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    updateActive();
    container.addEventListener('scroll', updateActive, { passive: true });
    return (): void => {
      container.removeEventListener('scroll', updateActive);
    };
  }, [scrollRef, updateActive]);

  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-border p-3 md:grid md:content-start md:gap-0.5 md:overflow-visible md:border-b-0 md:border-r md:px-4 md:py-10"
    >
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? 'true' : undefined}
          onClick={() => {
            document.getElementById(id)?.scrollIntoView({ block: 'start' });
            setActive(id);
          }}
          className={cn(
            'min-h-11 shrink-0 cursor-pointer whitespace-nowrap rounded-[10px] px-3 text-left text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent',
            active === id
              ? 'bg-accent-muted text-accent'
              : 'text-text-secondary hover:bg-surface hover:text-text-primary'
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
