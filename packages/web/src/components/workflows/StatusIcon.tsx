import { Check, CircleDashed, CircleHelp, Minus, Pause, X } from 'lucide-react';

/** Node/run status glyph. One stroke width; color carries the state. */
export function StatusIcon({ status }: { status: string }): React.ReactElement {
  switch (status) {
    case 'completed':
      return <Check aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-success" />;
    case 'running':
      return (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" />
      );
    case 'paused':
      return <Pause aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-warning" />;
    case 'awaiting':
      return (
        <CircleHelp
          strokeWidth={2}
          className="h-4 w-4 text-accent"
          aria-label="waiting on you"
          role="img"
        />
      );
    case 'failed':
      return <X aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-error" />;
    case 'cancelled':
      return <X aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-text-tertiary" />;
    case 'skipped':
      return <Minus aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-text-tertiary" />;
    default:
      return (
        <CircleDashed aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-text-tertiary" />
      );
  }
}
