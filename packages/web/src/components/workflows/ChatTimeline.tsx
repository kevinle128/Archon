import { createElement } from 'react';
import {
  Box,
  Bot,
  ChevronRight,
  Eye,
  FileText,
  GitBranch,
  RefreshCw,
  Terminal,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { formatStarted } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { ChatTimelineEntry, ChatTimelineNodeStatus } from './build-chat-timeline';
import type { NodeBodyKind } from './resolve-room-kind';

export interface ChatTimelineProps {
  entries: readonly ChatTimelineEntry[];
  selectedEntryId: string | null;
  onSelectNodeStatus: (entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>) => void;
  loading: boolean;
  error: string | null;
  renderAsk?: (entry: Extract<ChatTimelineEntry, { kind: 'ask' }>) => React.ReactNode;
  renderGate?: (entry: Extract<ChatTimelineEntry, { kind: 'gate' }>) => React.ReactNode;
}

const TYPE_ICONS: Record<NodeBodyKind, LucideIcon> = {
  command: Zap,
  prompt: FileText,
  loop: RefreshCw,
  bash: Terminal,
  script: Terminal,
  approval: Eye,
  plannotator_gate: Eye,
  workflow: Workflow,
  route_loop: GitBranch,
  loop_group: Box,
  unknown: Bot,
};

const STATUS_COLORS: Record<ChatTimelineNodeStatus, string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};

export function ChatTimeline(props: ChatTimelineProps): React.ReactElement {
  const { entries, selectedEntryId, onSelectNodeStatus, loading, error, renderAsk, renderGate } =
    props;
  const empty = entries.length === 0;

  return (
    <div aria-label="Run chat timeline" className="flex h-full min-h-0 flex-col overflow-auto p-3">
      {loading && empty ? 'Loading conversation turns…' : null}
      {error !== null ? <p className="text-error">{error}</p> : null}
      {!loading && error === null && empty
        ? 'No conversation turns or node-status entries yet.'
        : null}
      {entries.map(entry => {
        if (entry.kind === 'user') {
          return (
            <div
              key={`message:${entry.id}`}
              className="ml-auto max-w-[80%] rounded-lg bg-accent/20 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap"
            >
              {entry.content}
            </div>
          );
        }
        if (entry.kind === 'ask') {
          return (
            <div key={`ask:${entry.id}`} className="space-y-2">
              {entry.scopeLimitation !== null ? (
                <p className="text-xs text-warning">{entry.scopeLimitation}</p>
              ) : null}
              {renderAsk?.(entry)}
            </div>
          );
        }
        if (entry.kind === 'gate') {
          return (
            <div key={`gate:${entry.id}`} className="space-y-2">
              {entry.scopeLimitation !== null ? (
                <p className="text-xs text-warning">{entry.scopeLimitation}</p>
              ) : null}
              {renderGate?.(entry) ?? (
                <p className="text-sm text-text-secondary">Waiting for approval</p>
              )}
            </div>
          );
        }

        const selected = entry.id === selectedEntryId;
        return (
          <button
            key={`event:${entry.id}`}
            type="button"
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
              selected ? 'bg-accent/10' : 'hover:bg-surface-hover'
            )}
            onClick={(): void => {
              onSelectNodeStatus(entry);
            }}
          >
            {createElement(TYPE_ICONS[entry.nodeType], {
              'aria-hidden': true,
              className: 'h-3.5 w-3.5 shrink-0 text-text-tertiary',
            })}
            <span className="truncate text-text-primary">{entry.label}</span>
            <span className="text-text-secondary">{entry.detail}</span>
            <span
              className={cn(
                'shrink-0 rounded-none px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[entry.status]
              )}
            >
              {entry.status}
            </span>
            <span className="shrink-0 text-xs text-text-tertiary">
              {formatStarted(entry.createdAt)}
            </span>
            <ChevronRight className="h-3 w-3 text-text-tertiary" />
          </button>
        );
      })}
    </div>
  );
}
