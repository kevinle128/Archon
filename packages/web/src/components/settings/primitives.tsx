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
  'min-h-11 w-full min-w-0 rounded-[10px] border border-border bg-background px-3 text-sm text-text-primary transition-colors duration-150 motion-reduce:transition-none placeholder:text-text-tertiary hover:border-text-tertiary focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:hover:border-border';

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
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
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
  primary: 'border-accent bg-accent text-on-accent hover:opacity-90',
  secondary: 'border-border bg-background text-text-primary hover:bg-surface-elevated',
  ghost:
    'border-transparent bg-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
  danger: 'border-transparent bg-transparent text-error hover:border-error',
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
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-4 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:border-border disabled:bg-transparent disabled:text-text-tertiary disabled:hover:bg-transparent',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

export type Tone = 'done' | 'wait' | 'pend' | 'fail' | 'warn';

const TONE_CLASS: Record<Tone, string> = {
  done: 'text-success',
  wait: 'border-accent text-accent',
  pend: 'text-text-secondary',
  fail: 'text-error',
  warn: 'text-warning',
};

/** Status pill: colored dot, outlined for pending, never color-only (always has text). */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-2 whitespace-nowrap rounded-full border border-border px-2.5 text-xs font-medium',
        TONE_CLASS[tone]
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'pend' ? 'border border-current' : 'bg-current'
        )}
      />
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
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-4 gap-6 border-t border-border py-10 first:border-t-0 first:pt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-[60ch] gap-2">
          <h2 id={`${id}-title`} className="text-xl font-semibold leading-tight text-text-primary">
            {title}
          </h2>
          {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
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
        'min-h-9 cursor-pointer rounded-lg px-3 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent',
        scope === value
          ? 'bg-accent-muted text-accent'
          : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Settings scope"
      className="flex shrink-0 items-center gap-0.5 rounded-[10px] border border-border p-0.5"
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
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-4 last:border-b-0';
