/**
 * Console-owned agent history renderer. Uses AgentHistoryItem only as data and
 * never imports Legacy React components.
 */
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { AgentHistoryItem } from '@/lib/agent-history';
import type { OccurrenceGrouping } from '@/lib/occurrence-groups';
import {
  toolBodyPresentation,
  toolRawPayloadJson,
  toolRowPresentation,
  type TaskSubtaskCard,
  type ToolBody,
  type ToolFamily,
  type ToolOutcome,
  type ToolPresentationInput,
  type ToolRowBadge,
  type ToolRowBadgeTone,
  type ToolRowPresentation,
} from '@/lib/tool-presentation';

export const UNKNOWN_SCOPE_NOTICE =
  'Execution scope was not recorded; this history may include other executions of the same node.';

export interface ConsoleHistoryFilters {
  showToolCalls: boolean;
  showSystem: boolean;
}

/**
 * Whether the item's own row renders under the Console visibility toggles.
 * Extension content (an Ask card anchored to a hidden tool row) still renders
 * even when the row itself is hidden — callers account for it separately.
 */
export function historyItemRowVisible(
  item: AgentHistoryItem,
  filters: ConsoleHistoryFilters
): boolean {
  if (item.kind === 'tool') return filters.showToolCalls;
  if (item.kind === 'lifecycle') return filters.showSystem;
  return true;
}

export interface ConsoleAgentHistoryListProps {
  items: readonly AgentHistoryItem[];
  showToolCalls: boolean;
  showSystem: boolean;
  onLoadFullOutput: (item: Extract<AgentHistoryItem, { kind: 'tool' }>) => Promise<unknown>;
  renderAfterItem?: (item: AgentHistoryItem) => ReactNode;
  renderAtEnd?: ReactNode;
  unknownScope?: boolean;
  /**
   * Occurrence grouping filtered by the caller down to displayable groups.
   * When it reports showHeaders the body renders one h3 section heading per
   * group; otherwise the flat item render is unchanged.
   */
  occurrenceGrouping?: OccurrenceGrouping;
  /** useId-owned namespace for occurrence heading DOM ids (navigator targets). */
  headingIdPrefix?: string;
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

/**
 * Task-dispatch context renders at 11.5px mono inside the tool body: block
 * margins collapse, images never mount, and links keep the safe external
 * target/rel treatment (react-markdown's defaultUrlTransform blanks unsafe
 * schemes).
 */
const TASK_CONTEXT_COMPONENTS: Components = {
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>): ReactElement => (
    <p className="m-0" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>): ReactElement => (
    <h1 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>): ReactElement => (
    <h2 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>): ReactElement => (
    <h3 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: React.ComponentPropsWithoutRef<'h4'>): ReactElement => (
    <h4 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: React.ComponentPropsWithoutRef<'h5'>): ReactElement => (
    <h5 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: React.ComponentPropsWithoutRef<'h6'>): ReactElement => (
    <h6 className="m-0 text-[11.5px] font-semibold" {...props}>
      {children}
    </h6>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>): ReactElement => (
    <ul className="m-0 list-disc pl-5" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>): ReactElement => (
    <ol className="m-0 list-decimal pl-5" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.ComponentPropsWithoutRef<'li'>): ReactElement => (
    <li className="m-0" {...props}>
      {children}
    </li>
  ),
  img: (): ReactElement => <></>,
  a: MARKDOWN_COMPONENTS.a,
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
    const tone = presentation.family === 'todo' ? 'text-text-secondary' : 'text-text-primary';
    return (
      <span className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${tone}`}>
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

// --- Expanded tool body ---
// Lazy: ToolBodySwitch is only mounted while the row is open and Raw is
// closed, so `toolBodyPresentation` never runs for collapsed or Raw rows.
// Duplicate of the Legacy renderer's JSX — the data contract is shared, the
// components are not.

const TOOL_BODY_BOX =
  'tool-family-body min-w-0 whitespace-pre-wrap rounded-[6px] border border-border bg-surface-inset px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-text-primary';

/** Visible text of a markdown node; element children contribute nothing. */
function markdownTextOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(markdownTextOf).join('');
  return '';
}

/**
 * Stored tool output is untrusted content, so its markdown renders inert:
 * rehype-raw stays off (raw HTML survives only as escaped text), links become
 * their label plus a parenthesized destination — never navigable — and images
 * show alt text plus an omitted marker, so nothing in a body can navigate,
 * fetch, or run markup. rehype-highlight keeps its default `detect: false`:
 * only explicit `language-*` fences highlight.
 */
const TOOL_BODY_MARKDOWN_COMPONENTS: Components = {
  a: ({ children, href }): ReactElement => {
    const label = markdownTextOf(children);
    const dest = href ?? '';
    const bare = dest === label || dest.replace(/^https?:\/\//, '') === label;
    return (
      <span>
        {children}
        {dest !== '' && !bare ? <span className="text-text-secondary"> ({dest})</span> : null}
      </span>
    );
  },
  img: ({ alt }): ReactElement => (
    <span>
      {alt !== undefined && alt !== '' ? alt : 'image'}
      <span className="text-text-secondary"> [image omitted]</span>
    </span>
  ),
  pre: ({ children }): ReactElement => (
    <pre className="m-0 whitespace-pre-wrap font-mono">{children}</pre>
  ),
  code: ({ children, className }): ReactElement =>
    className !== undefined &&
    (className.startsWith('language-') || className.startsWith('hljs')) ? (
      <code className={`${className} font-mono`}>{children}</code>
    ) : (
      <code className="rounded bg-surface px-1 py-px font-mono">{children}</code>
    ),
  blockquote: ({ children }): ReactElement => (
    <blockquote className="border-l-2 border-border pl-2 text-text-secondary">
      {children}
    </blockquote>
  ),
};

function ToolBodyMarkdown({ markdown }: { markdown: string }): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={TOOL_BODY_MARKDOWN_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  );
}

/** Exact remaining counts report `+n more`; an unknowable tail reports omission. */
function OmittedTail({
  omitted,
  truncated,
}: {
  omitted: number | null;
  truncated: boolean;
}): ReactElement | null {
  if (omitted !== null && omitted > 0) {
    return <div className="text-text-secondary">+{omitted} more</div>;
  }
  if (truncated) return <div className="text-text-secondary">more results omitted</div>;
  return null;
}

/** Longest run of backticks in `source` plus one, floored at three — a fence the source can never close early. */
function codeFence(source: string): string {
  let longest = 0;
  let run = 0;
  for (const char of source) {
    run = char === '`' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

const CODE_LANGUAGE_PATTERN = /^[A-Za-z0-9_+#.-]+$/;

function ToolBodySwitch({
  input,
  presentation,
}: {
  input: ToolPresentationInput;
  presentation: ToolRowPresentation;
}): ReactElement | null {
  // Keyed on the field values so an unrelated re-render (loading flag, badge
  // refresh) never re-normalizes; a new output value recomputes exactly once.
  const body: ToolBody | null = useMemo(
    () => toolBodyPresentation(input, presentation.family),
    [input.name, input.input, input.output, presentation.family]
  );
  if (body === null) return null;

  switch (body.kind) {
    case 'terminal':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          <span className="text-node-bash">$</span> {body.command}
          {'\n'}
          {body.unreadable ? (
            <span className="text-text-secondary">output unreadable — open Raw</span>
          ) : body.output === null ? (
            <span className="text-text-secondary">
              {presentation.statusLabel === 'running' ? 'running — no output yet' : 'no output'}
            </span>
          ) : (
            body.output
          )}
          {presentation.statusLabel === 'failed' ? (
            <span
              className="font-bold"
              style={{ color: 'color-mix(in oklch, var(--error) 75%, var(--text-primary))' }}
            >
              {'\n'}FAILED
            </span>
          ) : null}
        </div>
      );
    case 'file':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          <span className="text-node-command">{body.path}</span>
          {'\n'}
          {body.unreadable ? (
            <span className="text-text-secondary">output unreadable — open Raw</span>
          ) : body.preview === null ? (
            <span className="text-text-secondary">no preview</span>
          ) : (
            body.preview
          )}
        </div>
      );
    case 'matches':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          <div>
            <span className="text-text-primary">{body.pattern}</span>
            {body.scope !== null ? (
              <span className="text-text-secondary"> in {body.scope}</span>
            ) : null}
          </div>
          {body.items.map(item => (
            <div
              key={item.path !== null ? `${item.path}:${item.line ?? ''}:${item.text}` : item.text}
            >
              {item.path !== null ? <span className="text-node-command">{item.path}</span> : null}
              {item.path !== null && item.line !== null ? (
                <span className="text-text-secondary">:{item.line}</span>
              ) : null}
              {item.path !== null ? ' ' : null}
              {item.text}
            </div>
          ))}
          {body.items.length === 0 ? <div className="text-text-secondary">no matches</div> : null}
          <OmittedTail omitted={body.omitted} truncated={body.truncated} />
        </div>
      );
    case 'paths':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          {body.items.map(path => (
            <div key={path} className="text-node-command">
              {path}
            </div>
          ))}
          {body.items.length === 0 ? <div className="text-text-secondary">no matches</div> : null}
          <OmittedTail omitted={body.omitted} truncated={body.truncated} />
        </div>
      );
    case 'code': {
      const language =
        body.language !== null && CODE_LANGUAGE_PATTERN.test(body.language) ? body.language : '';
      const fence = codeFence(body.source);
      return (
        <>
          <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
            <ToolBodyMarkdown markdown={`${fence}${language}\n${body.source}\n${fence}`} />
            {body.truncated ? <div className="text-text-secondary">source truncated</div> : null}
          </div>
          {body.result !== null ? (
            <div className={`${TOOL_BODY_BOX} mt-1.5`} style={{ overflowWrap: 'anywhere' }}>
              {body.result}
            </div>
          ) : null}
        </>
      );
    }
    case 'web':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          <span className="text-node-command">{body.url}</span>
          {body.title !== null ? <div className="font-bold">{body.title}</div> : null}
          {body.markdown !== null ? (
            <div className="chat-markdown mt-1">
              <ToolBodyMarkdown markdown={body.markdown} />
            </div>
          ) : null}
          <OmittedTail omitted={body.omitted} truncated={body.truncated} />
        </div>
      );
    case 'generic':
      return (
        <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
          {body.unreadable ? (
            <div className="text-text-secondary">output unreadable — open Raw</div>
          ) : null}
          {body.fields.map(field => (
            <div key={field.key} className="flex gap-2.5 leading-[1.7]">
              <span className="w-[11ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary">
                {field.key}
              </span>
              <span className="min-w-0 flex-1 text-text-primary">{field.value}</span>
            </div>
          ))}
          {body.markdown !== null ? (
            <div className="chat-markdown mt-1">
              <ToolBodyMarkdown markdown={body.markdown} />
            </div>
          ) : null}
          {body.fields.length === 0 && body.markdown === null && !body.unreadable ? (
            <div className="text-text-secondary">no details</div>
          ) : null}
        </div>
      );
    default:
      return <TaskBody body={body} />;
  }
}

/**
 * One normalized subtask as a native disclosure: agent · name — excerpt on a
 * single line, full prompt inside. The chevron binds to the card's own `open`
 * attribute via group/subtask — the outer row's state never rotates it.
 */
function SubtaskCard({
  subtask,
  index,
}: {
  subtask: TaskSubtaskCard;
  index: number;
}): ReactElement {
  return (
    <details
      data-subtask-index={index}
      className="group/subtask mt-[5px] rounded-[6px] border border-border bg-surface-elevated px-[9px] py-[6px]"
    >
      <summary className="flex min-h-[24px] cursor-pointer list-none items-baseline gap-2 overflow-hidden whitespace-nowrap rounded-[4px] font-mono text-[11.5px] leading-[1.5] focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="w-[9px] flex-none text-center text-[10px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none group-open/subtask:rotate-90"
        >
          ▶
        </span>
        {subtask.agent !== null ? (
          <span className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="font-semibold text-node-approval">{subtask.agent}</span>
            <span className="text-text-secondary"> · </span>
          </span>
        ) : null}
        <span className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-bold text-text-primary">
          {subtask.name}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis text-text-secondary">
          — {subtask.excerpt}
        </span>
      </summary>
      <pre className="m-0 mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-[6px] border border-border bg-surface-inset px-[10px] py-2 font-mono text-[11.5px] leading-[1.5] text-text-primary">
        {subtask.prompt}
      </pre>
    </details>
  );
}

/** Batch context markdown followed by one card per dispatched subtask. */
function TaskBody({ body }: { body: Extract<ToolBody, { kind: 'task' }> }): ReactElement {
  return (
    <>
      {body.context !== '' ? (
        <div
          data-task-context
          className="mb-0.5 font-mono text-[11.5px] leading-[1.5] text-text-secondary"
        >
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={TASK_CONTEXT_COMPONENTS}
          >
            {body.context}
          </ReactMarkdown>
        </div>
      ) : null}
      {body.subtasks.map((subtask, index) => (
        <SubtaskCard key={index} subtask={subtask} index={index} />
      ))}
    </>
  );
}

/** Bounded key/value rows for a malformed task payload — no cards, no dump. */
function GenericBody({ body }: { body: Extract<ToolBody, { kind: 'generic' }> }): ReactElement {
  if (body.fields.length === 0) return <></>;
  return (
    <div className="mb-1 font-mono text-[11.5px] leading-[1.7]">
      {body.fields.map((field, index) => (
        <div key={index} className="flex gap-2.5">
          <span className="w-[11ch] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary">
            {field.key}
          </span>
          <span className="min-w-0 break-words text-text-primary">{field.value}</span>
        </div>
      ))}
    </div>
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
    void onLoadFullOutput(item)
      .then((output): void => {
        if (output === undefined) {
          setLoadError('Full output is not available for this call');
          setLoading(false);
          return;
        }
        setFullOutput(output);
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
      {open ? (
        <div className="mb-2 ml-[29px] mt-0.5 border-l-2 border-border pl-2.5">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10.5px] text-text-secondary">
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {presentation.bodyBarText}
            </span>
            <button
              type="button"
              aria-expanded={rawOpen}
              aria-controls={rawOpen ? rawPanelId : undefined}
              className={`flex min-h-[24px] flex-none items-center rounded-[4px] border px-[7px] font-mono text-[10.5px] focus-visible:outline-2! focus-visible:outline-accent-bright! ${
                rawOpen
                  ? 'border-border-bright text-text-primary'
                  : 'border-border text-text-secondary hover:border-border-bright hover:text-text-primary'
              }`}
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
          ) : presentation.body?.kind === 'task' ? (
            <TaskBody body={presentation.body} />
          ) : presentation.body?.kind === 'generic' ? (
            <GenericBody body={presentation.body} />
          ) : (
            <ToolBodySwitch
              input={{
                name: item.name,
                input: item.input,
                output: hasFullOutput ? fullOutput : item.output,
              }}
              presentation={presentation}
            />
          )}
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
  occurrenceGrouping,
  headingIdPrefix,
}: ConsoleAgentHistoryListProps): ReactElement {
  const generatedHeadingPrefix = useId();
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

  const headingPrefix = headingIdPrefix ?? generatedHeadingPrefix;
  const filters: ConsoleHistoryFilters = { showToolCalls, showSystem };
  const grouping = occurrenceGrouping?.showHeaders ? occurrenceGrouping : null;

  const renderItem = (item: AgentHistoryItem): ReactElement | null => {
    const after = renderAfterItem?.(item);
    if (!historyItemRowVisible(item, filters)) {
      return after === undefined || after === null ? null : (
        <div key={item.id} className="my-1.5">
          {after}
        </div>
      );
    }
    if (item.kind === 'assistant') {
      return (
        <div key={item.id} className="my-1.5">
          <AssistantHistory item={item} />
          {after === undefined || after === null ? null : <div className="mt-1.5">{after}</div>}
        </div>
      );
    }
    if (item.kind === 'tool') {
      return (
        <div key={item.id}>
          <ToolHistory item={item} onLoadFullOutput={onLoadFullOutput} />
          {after === undefined || after === null ? null : <div className="mt-1.5">{after}</div>}
        </div>
      );
    }
    return (
      <div key={item.id} className="my-1.5">
        <LifecycleHistory item={item} />
        {after === undefined || after === null ? null : <div className="mt-1.5">{after}</div>}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5" style={{ overflowWrap: 'anywhere' }}>
      {unknownScope ? <p className="mb-1.5 text-xs text-warning">{UNKNOWN_SCOPE_NOTICE}</p> : null}
      {grouping === null ? (
        items.map(renderItem)
      ) : (
        <>
          {grouping.prefixItems.map(renderItem)}
          {grouping.groups.map(group => (
            <Fragment key={group.key}>
              <h3
                id={`${headingPrefix}occ-${group.key}`}
                tabIndex={-1}
                className="mb-[5px] mt-[10px] flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-secondary"
              >
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {group.label}
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </h3>
              {group.items.map(renderItem)}
            </Fragment>
          ))}
        </>
      )}
      {renderAtEnd === undefined || renderAtEnd === null || renderAtEnd === false ? null : (
        <div className="mt-1.5">{renderAtEnd}</div>
      )}
    </div>
  );
}
