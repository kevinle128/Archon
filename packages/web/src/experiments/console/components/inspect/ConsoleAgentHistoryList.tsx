/**
 * Console-owned agent history renderer. Uses AgentHistoryItem only as data and
 * never imports Legacy React components.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
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
import { formatToolIo } from '@/lib/pair-tool-transcript';
import { elideHeadline, FAMILY_CHIP_TOKEN } from '@/lib/tool-presentation';

export const UNKNOWN_SCOPE_NOTICE =
  'Execution scope was not recorded; this history may include other executions of the same node.';

export interface ConsoleAgentHistoryListProps {
  items: readonly AgentHistoryItem[];
  showToolCalls: boolean;
  showSystem: boolean;
  onLoadFullOutput: (item: Extract<AgentHistoryItem, { kind: 'tool' }>) => Promise<unknown>;
  renderAfterItem?: (item: AgentHistoryItem) => ReactNode;
  renderAtEnd?: ReactNode;
  unknownScope?: boolean;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>): ReactElement => (
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
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }): ReactElement => {
    const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
    if (isBlock) {
      return (
        <code className={`${className ?? ''} font-mono`} {...props}>
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
  }: React.ComponentPropsWithoutRef<'blockquote'>): ReactElement => (
    <blockquote className="border-l-2 border-primary pl-4 text-text-secondary" {...props}>
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>): ReactElement => (
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

function AssistantHistory({
  item,
}: {
  item: Extract<AgentHistoryItem, { kind: 'assistant' }>;
}): ReactElement {
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
}): ReactElement {
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
      return 'var(--running)';
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
  detailsRef: RefObject<HTMLDetailsElement | null>;
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
  onLoadFullOutput,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  onLoadFullOutput: ConsoleAgentHistoryListProps['onLoadFullOutput'];
}): ReactElement {
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const displayedOutput = fullOutput === undefined ? item.output : fullOutput;
  const displayedOutputState = fullOutput === undefined ? item.outputState : 'full';
  const disclosure = useToolDisclosure(item.outcome);
  const row = toolRowView(item, displayedOutputState);
  const elided = elideHeadline(item.presentation.headline, item.presentation.headlineKind);
  const chipToken = FAMILY_CHIP_TOKEN[item.presentation.family];
  const chipStyle: CSSProperties = {
    color: `var(${chipToken})`,
    borderColor: `color-mix(in oklch, var(${chipToken}) 40%, transparent)`,
    backgroundColor: 'var(--surface-elevated)',
  };

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void onLoadFullOutput(item)
      .then((output): void => {
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
      style={{
        border: 'var(--rv-tool-card-border, 1px solid var(--border))',
        overflowWrap: 'anywhere',
      }}
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
          {row.badges.map(badge => (
            <span
              key={badge.text}
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

function RoomPlaceholder({ children }: { children: string }): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-text-secondary">
      {children}
    </div>
  );
}

export function ConsoleAgentHistoryList({
  items,
  showToolCalls,
  showSystem,
  onLoadFullOutput,
  renderAfterItem,
  renderAtEnd,
  unknownScope = false,
}: ConsoleAgentHistoryListProps): ReactElement {
  if (items.length === 0) {
    const emptyHistory =
      renderAtEnd === undefined || renderAtEnd === null || renderAtEnd === false ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">{renderAtEnd}</div>
      );
    if (!unknownScope) return emptyHistory;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p>
        {emptyHistory}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3" style={{ overflowWrap: 'anywhere' }}>
      {unknownScope ? <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
      {items.map(item => {
        const after = renderAfterItem?.(item);
        if (item.kind === 'tool' && !showToolCalls) {
          return after === undefined || after === null ? null : <div key={item.id}>{after}</div>;
        }
        if (item.kind === 'lifecycle' && !showSystem) {
          return after === undefined || after === null ? null : <div key={item.id}>{after}</div>;
        }
        if (item.kind === 'assistant') {
          return (
            <div key={item.id}>
              <AssistantHistory item={item} />
              {after}
            </div>
          );
        }
        if (item.kind === 'tool') {
          return (
            <div key={item.id}>
              <ToolHistory item={item} onLoadFullOutput={onLoadFullOutput} />
              {after}
            </div>
          );
        }
        return (
          <div key={item.id}>
            <LifecycleHistory item={item} />
            {after}
          </div>
        );
      })}
      {renderAtEnd}
    </div>
  );
}
