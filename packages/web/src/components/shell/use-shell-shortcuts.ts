import { useEffect } from 'react';

/** Attribute that marks the list filter input of the current screen. */
export const LIST_FILTER_ATTRIBUTE = 'data-list-filter';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Handles one shell key press. `/` focuses the visible list filter. `Escape` blurs the
 * list filter when it has focus; the filter's owner clears its own value on Escape.
 * Returns true when the key was handled.
 */
export function handleShellKey(event: KeyboardEvent, doc: Document): boolean {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
    const filter = doc.querySelector<HTMLElement>(`[${LIST_FILTER_ATTRIBUTE}]`);
    if (!filter) return false;
    filter.focus();
    return true;
  }
  if (event.key === 'Escape') {
    const active = doc.activeElement;
    if (active instanceof HTMLElement && active.hasAttribute(LIST_FILTER_ATTRIBUTE)) {
      active.blur();
      return true;
    }
  }
  return false;
}

/** Registers the shell keyboard shortcuts for the lifetime of the shell. */
export function useShellShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (handleShellKey(event, document)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
