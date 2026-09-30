import { useState, useEffect, useId, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolCallDisplay } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  toolBodyPresentation,
  toolRawPayloadJson,
  toolRowPresentation,
  type ToolBody,
  type ToolOutcome,
  type ToolRowBadge,
} from '@/lib/tool-presentation';

interface ToolCallCardProps {
  tool: ToolCallDisplay;
}

const GLYPH_CLASS: Record<ToolOutcome, string> = {
  succeeded: 'text-success',
  failed: 'text-error',
  running: 'text-accent',
  interrupted: 'text-warning',
  unknown: 'text-text-tertiary',
};

const BADGE_TONE_CLASS: Record<ToolRowBadge['tone'], string> = {
  neutral: 'text-text-secondary',
  muted: 'text-text-tertiary',
  danger: 'text-error',
  warning: 'text-warning',
  running: 'text-primary',
  success: 'text-success',
};

function Badges({ badges }: { badges: readonly ToolRowBadge[] }): React.ReactElement | null {
  if (badges.length === 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[10px]">
      {badges.map((badge, index) => (
        <span key={`${badge.kind}-${String(index)}`} className="contents">
          {index > 0 ? (
            <span aria-hidden="true" className="text-text-tertiary">
              ·
            </span>
          ) : null}
          <span className={BADGE_TONE_CLASS[badge.tone]}>{badge.text}</span>
        </span>
      ))}
    </span>
  );
}

/** Lean, JSON-free body — same shared data as Node Room and RunStream, plainer chat-card markup. */
function ToolBodyView({ body }: { body: ToolBody }): React.ReactElement {
  switch (body.kind) {
    case 'terminal':
      return (
        <div>
          <div className="text-text-tertiary">$ {body.command}</div>
          {body.output !== null ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
              {body.output}
            </pre>
          ) : null}
        </div>
      );
    case 'file':
      return (
        <div>
          <div className="text-text-tertiary">{body.path}</div>
          {body.preview !== null ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
              {body.preview}
            </pre>
          ) : null}
        </div>
      );
    case 'matches':
    case 'paths': {
      const items: string[] =
        body.kind === 'matches'
          ? body.items.map(m =>
              m.path !== null
                ? `${m.path}${m.line !== null ? `:${String(m.line)}` : ''}: ${m.text}`
                : m.text
            )
          : body.items;
      return (
        <div>
          <div className="text-text-tertiary">
            {body.pattern}
            {body.scope !== null ? ` in ${body.scope}` : ''}
          </div>
          <ul className="mt-1 list-none">
            {items.map((line, index) => (
              <li key={index} className="whitespace-pre-wrap break-words">
                {line}
              </li>
            ))}
          </ul>
          {body.truncated ? (
            <div className="mt-1 text-text-tertiary">
              {body.omitted !== null ? `+${String(body.omitted)} more` : 'output truncated'}
            </div>
          ) : null}
        </div>
      );
    }
    case 'code':
      return (
        <div>
          {body.language !== null ? (
            <div className="text-text-tertiary">{body.language}</div>
          ) : null}
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
            {body.source}
          </pre>
          {body.result !== null ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
              {body.result}
            </pre>
          ) : null}
        </div>
      );
    case 'web':
      return (
        <div>
          <div className="text-text-tertiary">{body.title ?? body.url}</div>
          {body.markdown !== null ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
              {body.markdown}
            </pre>
          ) : null}
        </div>
      );
    case 'task':
      return (
        <div className="flex flex-col gap-1.5">
          {body.subtasks.map((subtask, index) => (
            <div key={index} className="border-l-2 border-border pl-2">
              <div className="text-text-primary">{subtask.name}</div>
              <div className="text-text-tertiary">{subtask.excerpt}</div>
            </div>
          ))}
        </div>
      );
    case 'generic':
      return (
        <div>
          {body.fields.map(field => (
            <div key={field.key}>
              <span className="text-text-tertiary">{field.key}: </span>
              <span>{field.value}</span>
            </div>
          ))}
          {body.markdown !== null ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3">
              {body.markdown}
            </pre>
          ) : null}
          {body.unreadable ? (
            <div className="mt-1 text-text-tertiary">output unreadable</div>
          ) : null}
        </div>
      );
  }
}

/**
 * The provider-reported outcome and exit code decide the result, with the
 * same precedence as the node room. `cancelled` (an operator-caused stop)
 * proves interruption; `stopped` (the run ended while the tool was still
 * open) proves nothing about the tool itself, so it degrades to `unknown`.
 * A completed call without a reported outcome keeps the historical
 * `succeeded` reading. Exported for the cross-surface parity test in
 * `tool-presentation-fixtures.test.ts`, which proves this agrees with the
 * node room's own derivation for the vocabulary they share.
 */
export function chatToolOutcome(tool: ToolCallDisplay, isRunning: boolean): ToolOutcome {
  if (isRunning) return 'running';
  if (tool.status === 'cancelled') return 'interrupted';
  if (tool.status === 'stopped') return 'unknown';
  if (tool.exitCode !== undefined && tool.exitCode !== 0) return 'failed';
  if (tool.outcome === 'error') return 'failed';
  if (tool.outcome === 'interrupted') return 'interrupted';
  if (tool.outcome === 'unknown') return 'unknown';
  return 'succeeded';
}

export function ToolCallCard({ tool }: ToolCallCardProps): React.ReactElement {
  const isTerminalWithoutResult = tool.status === 'cancelled' || tool.status === 'stopped';
  const isRunning =
    !isTerminalWithoutResult && tool.output === undefined && tool.duration === undefined;

  // Live elapsed counter — ticks every second while tool is running
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !tool.startedAt) return;
    setElapsed(Date.now() - tool.startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - tool.startedAt);
    }, 1000);
    return (): void => {
      clearInterval(interval);
    };
  }, [isRunning, tool.startedAt]);

  const outcome = chatToolOutcome(tool, isRunning);
  const presentation = useMemo(
    () =>
      toolRowPresentation(
        { name: tool.name, input: tool.input, output: tool.output },
        {
          outcome,
          exitCode: tool.exitCode ?? null,
          durationMs: tool.duration ?? null,
          runningElapsedMs: isRunning ? elapsed : null,
        }
      ),
    [tool.name, tool.input, tool.output, tool.exitCode, tool.duration, outcome, isRunning, elapsed]
  );
  // A failed call opens automatically, matching the read contract every other
  // surface follows; a running/succeeded/interrupted/unknown call starts closed.
  const [expanded, setExpanded] = useState(presentation.initialOpen);
  const [touched, setTouched] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const rawPanelId = useId();

  // A card polled in while running later resolves to failed on the same
  // mounted card. An untouched card opens once when that happens; nothing
  // here ever auto-closes a card the reader left open.
  useEffect(() => {
    if (!expanded && !touched && presentation.initialOpen) setExpanded(true);
  }, [expanded, touched, presentation.initialOpen]);

  const body: ToolBody | null = useMemo(() => {
    if (!expanded || rawOpen) return null;
    if (presentation.body !== null) return presentation.body;
    return toolBodyPresentation(
      { name: tool.name, input: tool.input, output: tool.output },
      presentation.family
    );
  }, [
    expanded,
    rawOpen,
    presentation.body,
    presentation.family,
    tool.name,
    tool.input,
    tool.output,
  ]);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface transition-colors duration-150 hover:border-border-bright',
        outcome === 'running' && 'border-l-2 border-l-accent',
        outcome === 'interrupted' && 'border-l-2 border-l-error'
      )}
    >
      {/* Header - clickable to expand */}
      <button
        aria-expanded={expanded}
        onClick={(): void => {
          setTouched(true);
          setExpanded(!expanded);
        }}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-4 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-200 motion-reduce:transition-none',
            expanded && 'rotate-90'
          )}
        />
        <span className="sr-only">{presentation.statusLabel}</span>
        <span
          aria-hidden="true"
          className={cn('shrink-0 font-bold', GLYPH_CLASS[presentation.statusLabel])}
        >
          {presentation.glyph}
        </span>
        <span className="shrink-0 font-mono text-xs font-medium text-text-secondary">
          {presentation.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
          {presentation.headline}
        </span>
        <Badges badges={presentation.badges} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 text-xs text-text-secondary">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] text-text-tertiary">
            <span className="min-w-0 flex-1 truncate">{presentation.bodyBar.label}</span>
            {presentation.bodyBar.badges.length > 0 ? (
              <span className="shrink-0 whitespace-nowrap">{presentation.bodyBar.badges}</span>
            ) : null}
            <button
              type="button"
              aria-expanded={rawOpen}
              aria-controls={rawOpen ? rawPanelId : undefined}
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                rawOpen
                  ? 'border-border-bright text-text-primary'
                  : 'border-border text-text-secondary'
              )}
              onClick={(): void => {
                setRawOpen(value => !value);
              }}
            >
              Raw{rawOpen ? ' ▾' : ''}
            </button>
          </div>
          {rawOpen ? (
            <pre
              id={rawPanelId}
              className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background p-3"
            >
              {toolRawPayloadJson(presentation.rawPayload)}
            </pre>
          ) : body !== null ? (
            <ToolBodyView body={body} />
          ) : null}
        </div>
      )}
    </div>
  );
}
