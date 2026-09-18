/**
 * Inspect-only node transcript room: render projected agent history for the
 * selected execution. Cursor paging and Ask placement stay in NodeTranscriptPane.
 */
import { useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { AgentHistoryItem } from '@/lib/agent-history';
import { getWorkflowNodeMessage, type WorkflowNodeMessageResponse } from '@/lib/api';
import {
  toolRawPayloadJson,
  toolRowPresentation,
  type ToolFamily,
  type ToolOutcome,
  type ToolRowBadge,
  type ToolRowBadgeTone,
  type ToolRowPresentation,
} from '@/lib/tool-presentation';
import { cn } from '@/lib/utils';

import type { LogRowSelection } from './build-log-rows';
import { RoomIncompleteNotice } from './RoomIncompleteNotice';

export interface NodeRoomProps {
  nodeId: string | null;
  items: readonly AgentHistoryItem[];
  unknownScope: boolean;
  runId: string;
  isPending: boolean;
  error: string | null;
  onRetry: () => void;
  loadMessage?: typeof getWorkflowNodeMessage;
  renderAfterItem?: (item: AgentHistoryItem) => React.ReactNode;
  renderAtEnd?: React.ReactNode;
}

const UNKNOWN_SCOPE_NOTICE =
  'Execution scope was not recorded; this history may include other executions of the same node.';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS = {
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>): React.ReactElement => (
    <pre
      className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }): React.ReactElement => {
    const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
    if (isBlock) {
      return (
        <code className={cn(className, 'font-mono')} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-background px-1.5 py-0.5 font-mono text-sm text-accent-bright"
        {...props}
      >
        {children}
      </code>
    );
  },
  blockquote: ({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'blockquote'>): React.ReactElement => (
    <blockquote className="border-l-2 border-primary pl-4 text-text-secondary" {...props}>
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>): React.ReactElement => (
    <a
      className="text-primary underline decoration-primary/40 hover:decoration-primary"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessageResponse[],
  selection: LogRowSelection
): WorkflowNodeMessageResponse[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  if (selection.kind === 'occurrence' || selection.kind === 'node') return ordered;
  if (selection.kind !== 'loop_iteration') return ordered;
  const detail = String(selection.iteration);
  const start = ordered.findIndex(
    message =>
      message.kind === 'status' &&
      message.payload.state === 'iteration_started' &&
      message.payload.detail === detail
  );
  if (start < 0) return ordered;
  const terminalOffset = ordered
    .slice(start + 1)
    .findIndex(
      message =>
        message.kind === 'status' &&
        (message.payload.state === 'iteration_completed' ||
          message.payload.state === 'iteration_failed') &&
        message.payload.detail === detail
    );
  if (terminalOffset >= 0) return ordered.slice(start, start + terminalOffset + 2);
  const nextStartOffset = ordered
    .slice(start + 1)
    .findIndex(
      message => message.kind === 'status' && message.payload.state === 'iteration_started'
    );
  return ordered.slice(start, nextStartOffset >= 0 ? start + nextStartOffset + 1 : undefined);
}

export function RoomPlaceholder({ children }: { children: string }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}

export function RoomRegion({
  nodeId,
  children,
}: {
  nodeId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      role="region"
      aria-label={nodeId + ' room'}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {children}
    </section>
  );
}

function AssistantHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'assistant' }>;
}): React.ReactElement {
  return (
    <div
      className="chat-markdown max-w-none text-sm text-text-primary"
      style={{ overflowWrap: 'anywhere' }}
    >
      <div className="mb-1 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
        ASSISTANT
      </div>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {item.text}
      </ReactMarkdown>
    </div>
  );
}

function LifecycleHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'lifecycle' }>;
}): React.ReactElement {
  return (
    <p className="text-xs text-text-secondary">
      {item.state}
      {item.detail !== null && item.detail.length > 0 ? ` ${item.detail}` : ''}
    </p>
  );
}

const CHIP_TONE: Record<ToolFamily, { className?: string; style?: React.CSSProperties }> = {
  shell: {
    className: 'text-node-bash',
    style: { borderColor: 'color-mix(in oklch, var(--node-bash) 40%, transparent)' },
  },
  file: {
    className: 'text-node-command',
    style: { borderColor: 'color-mix(in oklch, var(--node-command) 40%, transparent)' },
  },
  search: {
    style: {
      color: 'color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))',
      borderColor: 'color-mix(in oklch, var(--node-prompt) 45%, transparent)',
    },
  },
  glob: {
    style: {
      color: 'color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))',
      borderColor: 'color-mix(in oklch, var(--node-prompt) 45%, transparent)',
    },
  },
  code: {
    className: 'text-node-bash',
    style: { borderColor: 'color-mix(in oklch, var(--node-bash) 40%, transparent)' },
  },
  todo: {
    className: 'text-node-approval',
    style: { borderColor: 'color-mix(in oklch, var(--node-approval) 40%, transparent)' },
  },
  task: {
    className: 'text-node-approval',
    style: { borderColor: 'color-mix(in oklch, var(--node-approval) 40%, transparent)' },
  },
  web: {
    className: 'text-node-command',
    style: { borderColor: 'color-mix(in oklch, var(--node-command) 40%, transparent)' },
  },
  generic: { className: 'text-text-secondary' },
};

const GLYPH_TONE: Record<ToolOutcome, string> = {
  succeeded: 'text-success',
  failed: 'text-error',
  running: 'text-accent-bright',
  interrupted: 'text-warning',
  unknown: 'text-text-secondary',
};

const BADGE_TONE: Record<ToolRowBadgeTone, { className?: string; style?: React.CSSProperties }> = {
  neutral: { className: 'text-text-secondary' },
  warning: { className: 'text-warning' },
  running: { className: 'text-accent-bright' },
  muted: { className: 'text-text-tertiary' },
  danger: {
    style: { color: 'color-mix(in oklch, var(--error) 75%, var(--text-primary))' },
  },
};

/**
 * Splits a `path` headline into a shrinkable head and the fixed final segment.
 * `/` and `\` are the only separators; a trailing separator stays with the
 * tail. No usable separator/segment yields null — the caller renders one tail.
 */
function splitHeadline(headline: string): { head: string; tail: string } | null {
  for (let index = headline.length - 1; index > 0; index--) {
    const char = headline[index];
    if (char !== '/' && char !== '\\') continue;
    const next = headline[index + 1];
    if (next !== undefined && next !== '/' && next !== '\\') {
      return { head: headline.slice(0, index + 1), tail: headline.slice(index + 1) };
    }
  }
  return null;
}

function ToolHeadline({ presentation }: { presentation: ToolRowPresentation }): React.ReactElement {
  const split = presentation.headlineKind === 'path' ? splitHeadline(presentation.headline) : null;
  if (split === null) {
    return (
      <span
        className={cn(
          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
          presentation.family === 'todo' ? 'text-text-secondary' : 'text-text-primary'
        )}
      >
        {presentation.headline}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap">
      <span className="min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary">
        {split.head}
      </span>
      <span className="max-w-full flex-none overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
        {split.tail}
      </span>
    </span>
  );
}

function ToolBadge({ badge }: { badge: ToolRowBadge }): React.ReactElement {
  const tone = BADGE_TONE[badge.tone];
  // State badges duplicate the hidden status word, and the placeholder only
  // holds badge alignment; both stay decorative for assistive technology.
  const decorative = badge.kind === 'state' || badge.kind === 'placeholder';
  const shrinkable = badge.kind === 'duration';
  return (
    <span
      aria-hidden={decorative ? true : undefined}
      className={cn(
        shrinkable ? 'min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis' : 'flex-none',
        tone.className
      )}
      style={tone.style}
    >
      {badge.text}
    </span>
  );
}

function ToolHistory({
  item,
  runId,
  nodeId,
  loadMessage,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  runId: string;
  nodeId: string;
  loadMessage: typeof getWorkflowNodeMessage;
}): React.ReactElement {
  const [open, setOpen] = useState<boolean>(item.presentation.initialOpen);
  const [touched, setTouched] = useState<boolean>(false);
  const [rawOpen, setRawOpen] = useState<boolean>(false);
  const rawPanelId = useId();
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [hasFullOutput, setHasFullOutput] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Rebuild from the latest polled item facts after a full-output fetch. Storing
  // a presentation snapshot here would freeze outcome/exit/duration updates.
  const presentation = hasFullOutput
    ? toolRowPresentation(
        { name: item.name, input: item.input, output: fullOutput },
        {
          outcome: item.outcome,
          exitCode: item.exitCode,
          durationMs: item.durationMs,
          outputState: 'full',
        }
      )
    : item.presentation;

  // An untouched row that turns failed opens once; nothing ever auto-closes.
  useEffect(() => {
    if (!open && !touched && presentation.initialOpen) setOpen(true);
  }, [open, touched, presentation.initialOpen]);

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void loadMessage(runId, nodeId, item.messageId)
      .then((message): void => {
        if (message.kind !== 'tool' || message.payload.output === undefined) {
          setLoadError('Full output is not available for this call');
          setLoading(false);
          return;
        }
        setFullOutput(message.payload.output);
        setHasFullOutput(true);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  const onToggle = (event: React.SyntheticEvent<HTMLDetailsElement>): void => {
    // Toggle events dispatched by nested interactive body elements bubble up
    // to this row; only the outer row's own toggle may mark it touched or
    // rewrite `open`.
    if (event.target !== event.currentTarget) return;
    // React's controlled `open` write echoes back as a toggle event; a genuine
    // user activation flips the DOM state away from the rendered state first.
    if (event.currentTarget.open !== open) setTouched(true);
    setOpen(event.currentTarget.open);
  };

  const chip = CHIP_TONE[presentation.family];
  const chipTitle =
    presentation.label === presentation.family
      ? presentation.family
      : `${presentation.family} · ${presentation.label}`;
  const facts = presentation.badges.filter(badge => badge.kind !== 'placeholder');

  return (
    <details data-tool-id={item.toolUseId} open={open} onToggle={onToggle}>
      <summary className="flex min-h-[24px] cursor-pointer list-none items-baseline gap-2 overflow-hidden rounded-[6px] px-1.5 py-1 font-mono text-[12px] font-normal hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className={cn(
            'w-[9px] flex-none text-center text-[10px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none',
            open && 'rotate-90'
          )}
        >
          ▶
        </span>{' '}
        <span className="sr-only">{presentation.statusLabel}</span>{' '}
        <span
          aria-hidden="true"
          className={cn(
            'w-[12px] flex-none text-center text-[12px] font-bold leading-none',
            GLYPH_TONE[presentation.statusLabel]
          )}
        >
          {presentation.glyph}
        </span>{' '}
        <span
          className={cn(
            'max-w-[24ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] border border-border bg-surface-elevated px-[7px] py-px text-[11px]',
            chip.className
          )}
          style={chip.style}
          title={chipTitle}
          aria-label={chipTitle}
        >
          {presentation.label}
        </span>{' '}
        <ToolHeadline presentation={presentation} />{' '}
        <span className="flex min-w-0 items-baseline whitespace-nowrap text-[11px]">
          {presentation.badges.map((badge, index) => (
            <span key={`${badge.kind}-${index}`} className="contents">
              {index > 0 ? (
                <span aria-hidden="true" className="flex-none text-text-tertiary">
                  ·
                </span>
              ) : null}
              <ToolBadge badge={badge} />
            </span>
          ))}
        </span>
      </summary>
      <div className="mb-2 ml-[29px] mt-0.5 border-l-2 border-border pl-2.5">
        <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] text-text-secondary">
          <span className="min-w-0">
            {[presentation.family, ...facts.map(badge => badge.text)].join(' · ')}
          </span>
          <button
            type="button"
            aria-expanded={rawOpen}
            aria-controls={rawOpen ? rawPanelId : undefined}
            className={cn(
              'ml-auto inline-flex min-h-[24px] flex-none cursor-pointer items-center rounded-[4px] border px-[7px] py-px focus-visible:outline-2 focus-visible:outline-accent-bright',
              rawOpen
                ? 'border-border-bright text-text-primary'
                : 'border-border text-text-secondary hover:border-border-bright hover:text-text-primary focus-visible:border-border-bright focus-visible:text-text-primary'
            )}
            onClick={(): void => {
              setRawOpen(value => !value);
            }}
          >
            Raw
            {rawOpen ? <span aria-hidden="true"> ▾</span> : null}
          </button>
        </div>
        {rawOpen ? (
          <pre
            id={rawPanelId}
            className="m-0 min-w-0 max-w-full whitespace-pre-wrap rounded-[6px] border border-border bg-surface-inset px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-text-primary [overflow-wrap:anywhere]"
          >
            {toolRawPayloadJson(presentation.rawPayload)}
          </pre>
        ) : null}
        {item.canLoadFullOutput ? (
          <button
            type="button"
            className="mt-1.5 text-xs text-primary hover:text-accent-bright"
            disabled={loading}
            onClick={loadFull}
          >
            View full output
          </button>
        ) : null}
        {loadError !== null ? (
          <div className="mt-1.5 text-[11px] text-error">
            <span>{loadError}</span>
            <button
              type="button"
              className="ml-2 text-xs text-primary hover:text-accent-bright"
              onClick={loadFull}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function NodeRoom({
  nodeId,
  items,
  unknownScope,
  runId,
  isPending,
  error,
  onRetry,
  loadMessage = getWorkflowNodeMessage,
  renderAfterItem,
  renderAtEnd,
}: NodeRoomProps): React.ReactElement {
  if (nodeId === null) {
    return <RoomPlaceholder>Select a node</RoomPlaceholder>;
  }

  let body: React.ReactNode;
  if (isPending && items.length === 0 && error === null) {
    body = <RoomPlaceholder>Loading node transcript</RoomPlaceholder>;
  } else if (items.length === 0 && error !== null) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <RoomIncompleteNotice error={error} onRetry={onRetry} />
        {renderAtEnd === undefined || renderAtEnd === null || renderAtEnd === false ? null : (
          <div className="mt-1.5">{renderAtEnd}</div>
        )}
      </div>
    );
  } else if (items.length === 0) {
    body = renderAtEnd ?? <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>;
  } else {
    body = (
      <div
        className="flex min-h-0 flex-1 flex-col px-3 py-2.5"
        style={{ overflowWrap: 'anywhere' }}
      >
        {unknownScope ? (
          <p className="mb-1.5 text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p>
        ) : null}
        {items.map(item => {
          if (item.kind === 'assistant') {
            return (
              <div key={item.id} className="my-1.5">
                <AssistantHistory item={item} />
                {renderAfterItem ? <div className="mt-1.5">{renderAfterItem(item)}</div> : null}
              </div>
            );
          }
          if (item.kind === 'tool') {
            return (
              <div key={item.id}>
                <ToolHistory item={item} runId={runId} nodeId={nodeId} loadMessage={loadMessage} />
                {renderAfterItem ? <div className="mt-1.5">{renderAfterItem(item)}</div> : null}
              </div>
            );
          }
          return (
            <div key={item.id} className="my-1.5">
              <LifecycleHistory item={item} />
              {renderAfterItem ? <div className="mt-1.5">{renderAfterItem(item)}</div> : null}
            </div>
          );
        })}
        {error !== null ? <RoomIncompleteNotice error={error} onRetry={onRetry} /> : null}
        {renderAtEnd === undefined || renderAtEnd === null || renderAtEnd === false ? null : (
          <div className="mt-1.5">{renderAtEnd}</div>
        )}
      </div>
    );
  }

  return <RoomRegion nodeId={nodeId}>{body}</RoomRegion>;
}
