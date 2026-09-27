import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { formatRelativeToBaseline, formatClock } from '../lib/format';
import { useStreamContext } from '../lib/stream-context';
import type { InlineToolCall } from '../primitives/message';
import {
  toolBodyPresentation,
  toolRawPayloadJson,
  toolRowPresentation,
  type ToolBody,
  type ToolOutcome,
  type ToolRowBadge,
} from '@/lib/tool-presentation';

interface ToolCallItemProps {
  call: InlineToolCall;
  /** Carried from the parent message since metadata tool calls don't track their own timestamp. */
  timestamp: string;
}

const GLYPH_CLASS: Record<ToolOutcome, string> = {
  succeeded: 'text-[color:var(--success)]',
  failed: 'text-error',
  running: 'text-[color:var(--running)]',
  interrupted: 'text-[color:var(--warning)]',
  unknown: 'text-text-tertiary',
};

const BADGE_TONE_CLASS: Record<ToolRowBadge['tone'], string> = {
  neutral: 'text-text-secondary',
  muted: 'text-text-tertiary',
  danger: 'text-error',
  warning: 'text-[color:var(--warning)]',
  running: 'text-[color:var(--running)]',
  success: 'text-[color:var(--success)]',
};

function Badges({ badges }: { badges: readonly ToolRowBadge[] }): ReactElement | null {
  if (badges.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[11px]">
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

/** Lean, JSON-free body for a family without a heavier renderer on this surface — same data, plainer markup. */
function ToolBodyView({ body }: { body: ToolBody }): ReactElement {
  switch (body.kind) {
    case 'terminal':
      return (
        <div>
          <div className="text-text-tertiary">$ {body.command}</div>
          {body.output !== null ? (
            <pre className="mt-1 whitespace-pre-wrap break-words">{body.output}</pre>
          ) : null}
        </div>
      );
    case 'file':
      return (
        <div>
          <div className="text-text-tertiary">{body.path}</div>
          {body.preview !== null ? (
            <pre className="mt-1 whitespace-pre-wrap break-words">{body.preview}</pre>
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
          <pre className="mt-1 whitespace-pre-wrap break-words">{body.source}</pre>
          {body.result !== null ? (
            <pre className="mt-1 whitespace-pre-wrap break-words text-text-secondary">
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
            <pre className="mt-1 whitespace-pre-wrap break-words">{body.markdown}</pre>
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
            <pre className="mt-1 whitespace-pre-wrap break-words">{body.markdown}</pre>
          ) : null}
          {body.unreadable ? (
            <div className="mt-1 text-text-tertiary">output unreadable</div>
          ) : null}
        </div>
      );
  }
}

/**
 * Tool-call row rendered as a collapsible disclosure, matching mockup `.ptool`
 * semantics: a status glyph, a family chip, a headline, and right-aligned
 * badges on the collapsed row. Successful calls collapse on first render;
 * failed calls open automatically. Raw JSON is reachable only through the
 * Raw toggle — never shown by default.
 *
 * System-filter (showSystem=false) hides `#node-transition-*` at the stream
 * level before this component is reached, so those entries never reach here.
 */
export function ToolCallItem({ call, timestamp }: ToolCallItemProps): ReactElement {
  const { runStartedAt } = useStreamContext();
  const displayed = formatRelativeToBaseline(timestamp, runStartedAt);
  const wallClock = formatClock(timestamp);
  const rawPanelId = useId();

  const presentation = useMemo(
    () =>
      toolRowPresentation(
        { name: call.name, input: call.input, output: call.output },
        {
          outcome: call.outcome,
          exitCode: call.exitCode ?? null,
          durationMs: call.durationMs ?? null,
        }
      ),
    [call.name, call.input, call.output, call.outcome, call.exitCode, call.durationMs]
  );
  const [open, setOpen] = useState(presentation.initialOpen);
  const [touched, setTouched] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  // A call polled in while still running later resolves to failed on the
  // same mounted row. An untouched row opens once when that happens; nothing
  // this effect does ever auto-closes a row the reader left open.
  useEffect(() => {
    if (!open && !touched && presentation.initialOpen) setOpen(true);
  }, [open, touched, presentation.initialOpen]);

  const body: ToolBody | null = useMemo(() => {
    if (!open || rawOpen) return null;
    if (presentation.body !== null) return presentation.body;
    return toolBodyPresentation(
      { name: call.name, input: call.input, output: call.output },
      presentation.family
    );
  }, [open, rawOpen, presentation.body, presentation.family, call.name, call.input, call.output]);

  return (
    <div
      className="mx-3 mb-2 mt-1 rounded border border-border bg-surface-inset"
      style={{ padding: 'var(--rv-tool-card-padding, 8px 10px)' }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={(): void => {
          setTouched(true);
          setOpen(value => !value);
        }}
        className="flex w-full items-center gap-3 text-left"
      >
        <time
          dateTime={timestamp}
          title={wallClock}
          className="w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-text-tertiary"
        >
          {displayed}
        </time>
        <span
          aria-hidden="true"
          className="w-2.5 shrink-0 text-center text-[10px] text-text-tertiary"
        >
          {open ? '▾' : '▸'}
        </span>
        <span className="sr-only">{presentation.statusLabel}</span>
        <span
          aria-hidden="true"
          className={`w-3 shrink-0 text-center font-bold ${GLYPH_CLASS[presentation.statusLabel]}`}
        >
          {presentation.glyph}
        </span>
        <span
          className="shrink-0 rounded-[5px] border px-[7px] py-[2px] font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
          style={{
            color: 'var(--brand-violet)',
            background: 'color-mix(in oklch, var(--brand-violet), transparent 86%)',
            borderColor: 'color-mix(in oklch, var(--brand-violet), transparent 70%)',
          }}
        >
          {presentation.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-bold text-text-primary">
          {presentation.headline}
        </span>
        <Badges badges={presentation.badges} />
      </button>

      {open ? (
        <div className="mt-2 border-l-2 border-border pl-2.5 font-mono text-[11px] leading-relaxed text-text-secondary">
          <div className="mb-1.5 flex items-center gap-2 text-[10.5px] text-text-tertiary">
            <span className="min-w-0 flex-1 truncate">{presentation.bodyBar.label}</span>
            {presentation.bodyBar.badges.length > 0 ? (
              <span className="shrink-0 whitespace-nowrap">{presentation.bodyBar.badges}</span>
            ) : null}
            <button
              type="button"
              aria-expanded={rawOpen}
              aria-controls={rawOpen ? rawPanelId : undefined}
              className={`shrink-0 rounded-[4px] border px-[7px] py-px text-[10.5px] ${
                rawOpen
                  ? 'border-border-bright text-text-primary'
                  : 'border-border text-text-secondary'
              }`}
              onClick={(): void => {
                setRawOpen(value => !value);
              }}
            >
              Raw{rawOpen ? ' ▾' : ''}
            </button>
          </div>
          {rawOpen ? (
            <pre id={rawPanelId} className="whitespace-pre-wrap break-words">
              {toolRawPayloadJson(presentation.rawPayload)}
            </pre>
          ) : body !== null ? (
            <ToolBodyView body={body} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
