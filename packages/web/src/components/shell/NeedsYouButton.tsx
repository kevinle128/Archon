import { cn } from '@/lib/utils';

interface NeedsYouButtonProps {
  /** Paused runs in the current project filter. */
  count: number;
  onClick: () => void;
}

/** Top bar count of runs that wait for the operator. Filled only when the count is above 0. */
export function NeedsYouButton({ count, onClick }: NeedsYouButtonProps): React.ReactElement {
  const waiting = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      data-waiting={waiting ? 'true' : undefined}
      aria-label={`${String(count)} ${count === 1 ? 'run needs' : 'runs need'} you`}
      className={cn(
        'flex h-12 flex-none cursor-pointer items-center gap-2 px-4 text-[13px] font-semibold',
        waiting
          ? 'bg-status-waiting text-status-waiting-fg'
          : 'bg-transparent text-header-muted hover:text-header-fg'
      )}
    >
      <span className="text-xl font-extrabold" aria-hidden="true">
        {count}
      </span>
      <span aria-hidden="true" className="max-md:hidden">
        Needs you
      </span>
    </button>
  );
}
