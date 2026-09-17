/**
 * Console-owned agent history renderer. Uses AgentHistoryItem only as data and
 * never imports Legacy React components.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { AgentHistoryItem } from '@/lib/agent-history';
import { formatToolIo } from '@/lib/pair-tool-transcript';
import {
  toolRowPresentation,
  type ToolFamily,
  type ToolOutcome,
  type ToolRowBadge,
  type ToolRowBadgeTone,
  type ToolRowPresentation,
} from '@/lib/tool-presentation';

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
  running: 'text-[color:var(--running)]',
  interrupted: 'text-warning',
  unknown: 'text-text-secondary',
};

const BADGE_TONE: Record<ToolRowBadgeTone, { className?: string; style?: React.CSSProperties }> = {
  neutral: { className: 'text-text-secondary' },
  warning: { className: 'text-warning' },
  running: { className: 'text-[color:var(--running)]' },
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

function ToolHeadline({ presentation }: { presentation: ToolRowPresentation }): ReactElement {
  const split = presentation.headlineKind === 'path' ? splitHeadline(presentation.headline) : null;
  if (split === null) {
    return (
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
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

function ToolBadge({ badge }: { badge: ToolRowBadge }): ReactElement {
  const tone = BADGE_TONE[badge.tone];
  // State badges duplicate the hidden status word, and the placeholder only
  // holds badge alignment; both stay decorative for assistive technology.
  const decorative = badge.kind === 'state' || badge.kind === 'placeholder';
  const shrinkable = badge.kind === 'duration';
  const size = shrinkable ? 'min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis' : 'flex-none';
  const className = tone.className === undefined ? size : `${size} ${tone.className}`;
  return (
    <span aria-hidden={decorative ? true : undefined} className={className} style={tone.style}>
      {badge.text}
    </span>
  );
}

function ToolHistory({
  item,
  onLoadFullOutput,
}: {
  item: Extract<AgentHistoryItem, { kind: 'tool' }>;
  onLoadFullOutput: ConsoleAgentHistoryListProps['onLoadFullOutput'];
}): ReactElement {
  const [open, setOpen] = useState<boolean>(item.presentation.initialOpen);
  const [touched, setTouched] = useState<boolean>(false);
  const [fullOutput, setFullOutput] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedPresentation, setLoadedPresentation] = useState<ToolRowPresentation | null>(null);

  const presentation = loadedPresentation ?? item.presentation;

  // An untouched row that turns failed opens once; nothing ever auto-closes.
  useEffect(() => {
    if (!open && !touched && presentation.initialOpen) setOpen(true);
  }, [open, touched, presentation.initialOpen]);

  const loadFull = (): void => {
    setLoading(true);
    setLoadError(null);
    void onLoadFullOutput(item)
      .then((output): void => {
        setFullOutput(output);
        setLoadedPresentation(
          toolRowPresentation(
            { name: item.name, input: item.input, output },
            {
              outcome: item.outcome,
              exitCode: item.exitCode,
              durationMs: item.durationMs,
              outputState: 'full',
            }
          )
        );
        setLoading(false);
      })
      .catch((error: unknown): void => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load full output');
        setLoading(false);
      });
  };

  const onToggle = (event: React.SyntheticEvent<HTMLDetailsElement>): void => {
    // Nested Input/Output disclosures bubble toggle events; only the outer
    // row's own toggle counts.
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
  const chevronClass = open
    ? 'w-[9px] flex-none text-center text-[10px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none rotate-90'
    : 'w-[9px] flex-none text-center text-[10px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none';
  const chipClass =
    chip.className === undefined
      ? 'max-w-[24ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] border border-border bg-surface-elevated px-[7px] py-px text-[11px]'
      : `max-w-[24ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] border border-border bg-surface-elevated px-[7px] py-px text-[11px] ${chip.className}`;

  return (
    <details data-tool-id={item.toolUseId} open={open} onToggle={onToggle}>
      <summary className="flex min-h-[24px] cursor-pointer list-none items-baseline gap-2 overflow-hidden rounded-[6px] px-1.5 py-1 font-mono text-[12px] font-normal hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className={chevronClass}>
          ▶
        </span>{' '}
        <span className="sr-only">{presentation.statusLabel}</span>{' '}
        <span
          aria-hidden="true"
          className={`w-[12px] flex-none text-center text-[12px] font-bold leading-none ${GLYPH_TONE[presentation.statusLabel]}`}
        >
          {presentation.glyph}
        </span>{' '}
        <span className={chipClass} style={chip.style} title={chipTitle} aria-label={chipTitle}>
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
        <div className="mb-1.5 flex items-baseline gap-2 font-mono text-[10.5px] text-text-secondary">
          {[presentation.family, ...facts.map(badge => badge.text)].join(' · ')}
        </div>
        <details className="mt-1">
          <summary className="flex min-h-[24px] w-fit cursor-pointer items-center rounded-[4px] px-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright">
            Input
          </summary>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
            {formatToolIo(item.input)}
          </pre>
        </details>
        <details className="mt-1">
          <summary className="flex min-h-[24px] w-fit cursor-pointer items-center rounded-[4px] px-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-bright">
            Output
          </summary>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
            {formatToolIo(fullOutput === undefined ? item.output : fullOutput)}
          </pre>
        </details>
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-2.5">{renderAtEnd}</div>
      );
    if (!unknownScope) return emptyHistory;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-2.5">
        <p className="text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p>
        {emptyHistory}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5" style={{ overflowWrap: 'anywhere' }}>
      {unknownScope ? <p className="mb-1.5 text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
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
            <div key={item.id} className="my-1.5">
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
          <div key={item.id} className="my-1.5">
            <LifecycleHistory item={item} />
            {after}
          </div>
        );
      })}
      {renderAtEnd}
    </div>
  );
}
