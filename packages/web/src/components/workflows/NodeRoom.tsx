/**
 * Inspect-only node transcript room: render projected agent history for the
 * selected execution. Cursor paging and Ask placement stay in NodeTranscriptPane.
 */
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import {
  initialToolExpanded,
  toolRowView,
  type AgentHistoryItem,
  type BadgeTone,
  type ToolOutcome,
} from '@/lib/agent-history';
import { getWorkflowNodeMessage, type WorkflowNodeMessageResponse } from '@/lib/api';
import { formatToolIo } from '@/lib/pair-tool-transcript';
import { elideHeadline, FAMILY_CHIP_TOKEN } from '@/lib/tool-presentation';
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

function glyphColor(outcome: ToolOutcome): string {
  switch (outcome) {
    case 'succeeded':
      return 'var(--success)';
    case 'failed':
      return 'var(--error)';
    case 'running':
      return 'var(--accent-bright)';
    case 'interrupted':
      return 'var(--warning)';
    case 'unknown':
      return 'var(--text-secondary)';
  }
}

function badgeColor(tone: BadgeTone): string {
  switch (tone) {
    case 'error':
      return 'var(--error)';
    case 'warning':
      return 'var(--warning)';
    case 'default':
    case 'muted':
      return 'var(--text-secondary)';
  }
}

function useToolDisclosure(outcome: ToolOutcome): {
  detailsRef: React.RefObject<HTMLDetailsElement | null>;
  initialOpen: boolean;
  markTouched: () => void;
} {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const touchedRef = useRef(false);
  const initialOpenRef = useRef(initialToolExpanded(outcome));

  useEffect(() => {
    if (!touchedRef.current && outcome === 'failed' && detailsRef.current !== null) {
      detailsRef.current.open = true;
    }
  }, [outcome]);

  return {
    detailsRef,
    initialOpen: initialOpenRef.current,
    markTouched: (): void => {
      touchedRef.current = true;
    },
  };
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
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;
  const displayedOutputState = fullOutput === undefined ? item.outputState : 'full';
  const disclosure = useToolDisclosure(item.outcome);
  const row = toolRowView(item, displayedOutputState);
  const elided = elideHeadline(item.presentation.headline, item.presentation.headlineKind);
  const chipToken = FAMILY_CHIP_TOKEN[item.presentation.family];
  const chipStyle: React.CSSProperties = {
    color: `var(${chipToken})`,
    borderColor: `color-mix(in oklch, var(${chipToken}) 40%, transparent)`,
    backgroundColor: 'var(--surface-elevated)',
  };

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void loadMessage(runId, nodeId, item.messageId)
      .then((message): void => {
        const output = message.kind === 'tool' ? message.payload.output : undefined;
        setFullOutput(output);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  return (
    <details
      ref={disclosure.detailsRef}
      data-tool-id={item.toolUseId}
      open={disclosure.initialOpen || undefined}
      className="ptool group rounded-[var(--radius)] bg-surface-inset px-2.5 py-2"
      style={{ border: 'var(--rv-tool-card-border)', overflowWrap: 'anywhere' }}
    >
      <summary
        data-testid="tool-summary"
        onClick={disclosure.markTouched}
        className="flex min-h-6 min-w-0 list-none flex-nowrap items-center gap-2 [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden="true" className="shrink-0 group-open:hidden">
          ▸
        </span>
        <span aria-hidden="true" className="hidden shrink-0 group-open:inline">
          ▾
        </span>
        <span
          role="img"
          aria-label={row.outcomeLabel}
          className="shrink-0"
          style={{ color: glyphColor(item.outcome) }}
        >
          {row.glyph}
        </span>
        <span
          aria-label={item.presentation.chipAriaLabel}
          title={item.presentation.family}
          className="shrink-0 rounded-sm border px-1 text-[11px] font-medium"
          style={chipStyle}
        >
          {item.presentation.label}
        </span>
        {elided.kind === 'path' ? (
          <span className="flex min-w-0 overflow-hidden">
            <span className="min-w-0 truncate">{elided.head}</span>
            <span className="shrink-0">{elided.tail}</span>
          </span>
        ) : (
          <span className="min-w-0 truncate">{elided.text}</span>
        )}
        <span className="ml-auto flex flex-nowrap items-center gap-1.5">
          {row.badges.map((badge, index) => (
            <span
              key={`${String(index)}:${badge.text}`}
              className={
                badge.priority === 'sticky'
                  ? 'shrink-0 text-[11px]'
                  : 'min-w-0 shrink overflow-hidden text-[11px]'
              }
              style={{ color: badgeColor(badge.tone) }}
            >
              {badge.text}
            </span>
          ))}
        </span>
      </summary>
      <div className="mt-1.5">
        <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
          Input
        </div>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
          {formatToolIo(item.input)}
        </pre>
      </div>
      <div className="mt-1.5">
        <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-tertiary">
          Output
        </div>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
          {formatToolIo(displayedOutput)}
        </pre>
      </div>
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
        {renderAtEnd}
      </div>
    );
  } else if (items.length === 0) {
    body = renderAtEnd ?? <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>;
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" style={{ overflowWrap: 'anywhere' }}>
        {unknownScope ? <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
        {items.map(item => {
          if (item.kind === 'assistant') {
            return (
              <div key={item.id}>
                <AssistantHistory item={item} />
                {renderAfterItem?.(item)}
              </div>
            );
          }
          if (item.kind === 'tool') {
            return (
              <div key={item.id}>
                <ToolHistory item={item} runId={runId} nodeId={nodeId} loadMessage={loadMessage} />
                {renderAfterItem?.(item)}
              </div>
            );
          }
          return (
            <div key={item.id}>
              <LifecycleHistory item={item} />
              {renderAfterItem?.(item)}
            </div>
          );
        })}
        {error !== null ? <RoomIncompleteNotice error={error} onRetry={onRetry} /> : null}
        {renderAtEnd}
      </div>
    );
  }

  return <RoomRegion nodeId={nodeId}>{body}</RoomRegion>;
}
