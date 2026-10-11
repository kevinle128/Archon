import { createElement } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import type { ThemeChoice } from '@/lib/theme';

/** Order of the theme cycle: light, then dark, then follow the system. */
const NEXT_CHOICE: Readonly<Record<ThemeChoice, ThemeChoice>> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** The choice that follows `choice` in the theme cycle. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return NEXT_CHOICE[choice];
}

interface ThemeToggleProps {
  choice: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}

/** Top bar theme control. Each click moves to the next choice in the cycle. */
export function ThemeToggle({ choice, onChange }: ThemeToggleProps): React.ReactElement {
  const icon = ICON[choice];
  const next = nextThemeChoice(choice);
  return (
    <button
      type="button"
      onClick={(): void => {
        onChange(next);
      }}
      aria-label={`Theme: ${choice}`}
      title={`Theme: ${choice}. Click for ${next}.`}
      className="flex h-12 flex-none cursor-pointer items-center border-l border-header-line px-4 text-header-muted hover:text-header-fg"
    >
      {createElement(icon, { className: 'h-4 w-4', strokeWidth: 2, 'aria-hidden': true })}
    </button>
  );
}
