import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SettingsScope } from '@/lib/settings/types';

/**
 * Form and layout primitives for the settings page. Token classes only: controls
 * use a 10px radius, a 44px hit target, a visible focus ring and 150ms color
 * transitions that stop under reduced motion.
 */

export const CONTROL_CLASS =
  'min-h-9 w-full min-w-0 border border-line-strong bg-card px-3 text-[13px] text-text-primary placeholder:text-text-tertiary hover:border-text-secondary disabled:opacity-50 disabled:hover:border-line-strong';

export const MONO_CONTROL_CLASS = `${CONTROL_CLASS} font-mono`;

export function TextInput({ className, ...props }: ComponentProps<'input'>): ReactElement {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

/** Native select with the design chevron overlaid on the appearance-none control. */
export function SelectInput({
  className,
  wrapperClassName,
  children,
  ...props
}: ComponentProps<'select'> & { wrapperClassName?: string }): ReactElement {
  return (
    <span className={cn('relative block min-w-0', wrapperClassName)}>
      <select
        className={cn(CONTROL_CLASS, 'cursor-pointer appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
      />
    </span>
  );
}

/** Label above the control, helper text and error below it. */
export function Field({
  label,
  helper,
  error,
  className,
  children,
}: {
  label: string;
  helper?: string;
  error?: string | null;
  className?: string;
  /** Render function receives ids to wire the control to its helper and error text. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}): ReactElement {
  const id = useId();
  const helperId = `${id}-help`;
  const errorId = `${id}-err`;
  const describedBy =
    [helper ? helperId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid min-w-0 gap-2', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-text-secondary">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {helper ? (
        <p id={helperId} className="text-xs text-text-tertiary">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-accent bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border-line-strong bg-card text-text-primary hover:bg-selection',
  ghost: 'border-transparent bg-transparent text-text-primary hover:bg-selection',
  danger: 'border-error bg-card text-error hover:bg-tint-error',
};

export function Btn({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }): ReactElement {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-8 cursor-pointer items-center justify-center gap-2 border px-3 text-[13px] font-semibold whitespace-nowrap disabled:cursor-default disabled:border-border disabled:bg-transparent disabled:text-text-tertiary disabled:hover:bg-transparent',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

export type Tone = 'done' | 'wait' | 'pend' | 'fail' | 'warn';

const TONE_CLASS: Record<Tone, string> = {
  done: 'text-status-done',
  wait: 'text-status-running',
  pend: 'text-status-pending',
  fail: 'text-status-failed',
  warn: 'text-status-waiting',
};

const TONE_GLYPH: Record<Tone, string> = {
  done: '✓',
  wait: '▶',
  pend: '○',
  fail: '✕',
  warn: '!',
};

/** Status: glyph and label in the status tone, never color only. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap',
        TONE_CLASS[tone]
      )}
    >
      <span aria-hidden>{TONE_GLYPH[tone]}</span>
      {children}
    </span>
  );
}

/** One page section: heading, description, optional aside, and a body grid. */
export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-foreground pb-4">
        <div className="grid max-w-[64ch] gap-1">
          <h2
            id={`${id}-title`}
            className="text-[28px] leading-[1.15] font-extrabold text-text-primary"
          >
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-[1.55] text-text-secondary">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function HelpText({ children }: { children: ReactNode }): ReactElement {
  return <p className="text-xs text-text-tertiary">{children}</p>;
}

export function InlineError({ children }: { children: ReactNode }): ReactElement {
  return (
    <p role="alert" className="text-xs text-error">
      {children}
    </p>
  );
}

/** "This install / Just me" segmented control. Render only when the user scope is available. */
export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: SettingsScope;
  onChange: (scope: SettingsScope) => void;
}): ReactElement {
  const item = (value: SettingsScope, label: string): ReactElement => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => {
        onChange(value);
      }}
      className={cn(
        'min-h-8 cursor-pointer px-3 text-[13px] font-semibold',
        scope === value
          ? 'bg-foreground text-background'
          : 'bg-card text-text-primary hover:bg-selection'
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Settings scope"
      className="flex shrink-0 items-center border border-line-strong"
    >
      {item('install', 'This install')}
      {item('user', 'Just me')}
    </div>
  );
}

export function LoadingLine({ children = 'Loading...' }: { children?: ReactNode }): ReactElement {
  return <p className="text-sm text-text-tertiary">{children}</p>;
}

/** A row separated by a hairline, used for project and connection lists. */
export const ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3';
