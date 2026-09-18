/**
 * Pinned todo strip for the Console node room: one collapsible fold of the
 * execution's recorded todo state, mounted as the first child of the room
 * region so it stays put while the transcript scroller moves beneath it.
 */
import { useId, useState } from 'react';

import {
  summarizeTodoState,
  TODO_STATUS_PRESENTATION,
  type TodoItem,
  type TodoPhase,
  type TodoStatus,
} from '@/lib/todo-state';
import { cn } from '@/lib/utils';

export interface ConsoleTodoStripProps {
  phases: readonly TodoPhase[];
}

// The Console surface's running colour is --running.
const RUNNING_MARKER = 'shadow-[inset_2px_0_0_var(--running)]';

const GLYPH_TONE: Record<TodoStatus, string> = {
  completed: 'text-success',
  in_progress: 'text-[color:var(--running)]',
  blocked: 'text-warning',
  pending: 'text-text-secondary',
  abandoned: 'text-text-secondary',
};

const METER_TONE: Record<TodoStatus, string> = {
  completed: 'bg-success',
  in_progress: 'bg-[color:var(--running)]',
  blocked: 'bg-warning',
  pending: 'bg-border-bright',
  abandoned: 'bg-border-bright',
};

/**
 * The complete spoken status. For a blocked item it carries the reason so the
 * visible `· blocked: …` suffix can stay decorative without losing it.
 */
function statusPhrase(item: TodoItem): string {
  const label = TODO_STATUS_PRESENTATION[item.status].label;
  return item.status === 'blocked' && item.blocker !== undefined
    ? `${label} — ${item.blocker}`
    : label;
}

function visibleSuffix(item: TodoItem): string | null {
  if (item.status === 'blocked' && item.blocker !== undefined) {
    return `· blocked: ${item.blocker}`;
  }
  if (item.status === 'abandoned') return '· dropped';
  return null;
}

function ConsoleTodoStripRow({
  item,
  current,
}: {
  item: TodoItem;
  current: boolean;
}): React.ReactElement {
  const presentation = TODO_STATUS_PRESENTATION[item.status];
  const suffix = visibleSuffix(item);
  return (
    <li
      className={cn(
        'flex items-baseline gap-2 rounded-[4px] py-[1px] pr-[4px] pl-[2px] font-mono text-[11.5px] leading-[1.85]',
        current ? cn('bg-surface text-text-primary', RUNNING_MARKER) : 'text-text-secondary'
      )}
    >
      <span
        aria-hidden="true"
        className={cn('w-[12px] flex-none text-center font-bold', GLYPH_TONE[item.status])}
      >
        {presentation.glyph}
      </span>
      <span className="sr-only">{statusPhrase(item)}</span>
      <span className={cn('min-w-0', item.status === 'abandoned' && 'line-through')}>
        {item.content}
      </span>
      {suffix === null ? null : (
        <span aria-hidden="true" className="text-text-secondary">
          {suffix}
        </span>
      )}
    </li>
  );
}

export function ConsoleTodoStrip({ phases }: ConsoleTodoStripProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (phases.length === 0) return null;

  const summary = summarizeTodoState(phases);
  const items = phases.flatMap(phase => phase.items);
  const representative = summary.current;
  const currentItem = items.find(item => item.status === 'in_progress') ?? null;

  return (
    <section aria-label="Todo" className="flex-none border-b border-border bg-surface-elevated">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={(): void => {
          setOpen(value => !value);
        }}
        className="flex min-h-[24px] w-full items-center gap-2 overflow-hidden whitespace-nowrap px-[10px] py-[6px] text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2"
      >
        <span className="flex-none text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary">
          TODO
        </span>
        {representative === null ? null : (
          <span className="flex min-w-0 flex-1 items-baseline gap-[7px] font-mono text-[11.5px]">
            <span className="sr-only">{TODO_STATUS_PRESENTATION[representative.status].label}</span>
            <span
              aria-hidden="true"
              className={cn(
                'w-[12px] flex-none text-center font-bold',
                GLYPH_TONE[representative.status]
              )}
            >
              {TODO_STATUS_PRESENTATION[representative.status].glyph}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
              {representative.content}
            </span>
          </span>
        )}
        <span
          aria-hidden="true"
          data-testid="todo-meter"
          className="flex w-[66px] flex-none items-center gap-[2px]"
        >
          {items.map((item, index) => (
            <span
              key={`meter-${index}`}
              className={cn('h-[3px] flex-1', METER_TONE[item.status])}
            />
          ))}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-[10px] text-text-secondary">
          {summary.done}/{summary.total}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'w-[9px] flex-none text-center text-[9px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none',
            open && 'rotate-180'
          )}
        >
          ▾
        </span>
      </button>
      <div
        id={bodyId}
        data-testid="todo-list"
        hidden={!open}
        className="max-h-[168px] overflow-y-auto border-t border-border px-[10px] pb-[8px] pt-[4px]"
      >
        {phases.map(phase => (
          <div key={phase.phase}>
            <h3 className="mt-[4px] text-[10px] uppercase tracking-[0.07em] text-text-secondary">
              {phase.phase}
            </h3>
            <ul>
              {phase.items.map((item, index) => (
                <ConsoleTodoStripRow
                  key={`${index}-${item.content}`}
                  item={item}
                  current={item === currentItem}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
