import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageBubble } from './MessageBubble';
import { ArtifactViewerModal } from '@/components/workflows/ArtifactViewerModal';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useWorkflowStore } from '@/stores/workflow-store';
import { getWorkflowRun } from '@/lib/api';
import { StatusIcon } from '@/components/workflows/StatusIcon';
import { ArtifactSummary } from '@/components/workflows/ArtifactSummary';
import { formatDurationMs, ensureUtc } from '@/lib/format';
import type { ChatMessage, WorkflowArtifact, ArtifactType } from '@/lib/types';
import { buildRunPath } from '@/lib/runs/run-url';

// Matches artifact paths (forward- and back-slash safe); groups: [1] runId, [2] filename
const ARTIFACT_PATH_RE = /artifacts[/\\]runs[/\\]([a-fA-F0-9-]+)[/\\](.+)/;

function extractArtifactInfo(text: string): { runId: string; filename: string } | null {
  const match = ARTIFACT_PATH_RE.exec(text);
  if (!match) return null;
  const filename = match[2].replace(/\\/g, '/');
  if (filename.split('/').some(s => s === '..')) return null;
  return { runId: match[1], filename };
}

function makeResultMarkdownComponents(
  onArtifactClick: (runId: string, filename: string) => void
): Components {
  return {
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
    code: ({
      children,
      className,
      ...props
    }: React.ComponentPropsWithoutRef<'code'> & { className?: string }): React.ReactElement => {
      const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      if (typeof children === 'string') {
        const artifact = extractArtifactInfo(children);
        if (artifact) {
          const { runId, filename } = artifact;
          const displayName = filename.split('/').pop() ?? filename;
          const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
          const artifactHref = `/api/artifacts/${encodeURIComponent(runId)}/${encodedFilename}`;
          return (
            <a
              href={artifactHref}
              onClick={
                filename.endsWith('.md')
                  ? (e: React.MouseEvent): void => {
                      e.preventDefault();
                      onArtifactClick(runId, filename);
                    }
                  : undefined
              }
              target={filename.endsWith('.md') ? undefined : '_blank'}
              rel={filename.endsWith('.md') ? undefined : 'noopener noreferrer'}
              className="!text-accent-bright hover:!text-primary font-mono font-medium underline decoration-accent-bright/40 hover:decoration-accent-bright"
            >
              {displayName}
            </a>
          );
        }
      }
      return (
        <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[0.9em]" {...props}>
          {children}
        </code>
      );
    },
  };
}

function WorkflowResultCard({
  workflowName,
  runId,
  content,
}: {
  workflowName: string;
  runId: string;
  content: string;
}): React.ReactElement {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [artifactViewer, setArtifactViewer] = useState<{
    runId: string;
    filename: string;
  } | null>(null);

  // setArtifactViewer is a stable React state setter — empty dep array is intentional
  const mdComponents = useMemo(
    () =>
      makeResultMarkdownComponents((aRunId, filename) => {
        setArtifactViewer({ runId: aRunId, filename });
      }),
    []
  );

  // Zustand live state (populated if user had the page open during execution)
  const liveState = useWorkflowStore(state => state.workflows.get(runId));

  // One-time API fetch: staleTime: Infinity because a terminal run record is immutable —
  // status, timestamps, and events do not change once completed/failed/cancelled.
  // Distinct key: WorkflowExecution caches a *transformed* shape under ['workflowRun', runId];
  // sharing that key would hand this component the wrong shape (no `.run`) from the cache.
  const { data: runData, isError } = useQuery({
    queryKey: ['workflowRunDetail', runId],
    queryFn: () => getWorkflowRun(runId),
    staleTime: Infinity,
  });

  // Merge: prefer live state when available. Guard `.run` (not just `runData`): a
  // peripheral result card must degrade gracefully, never crash the whole message list.
  const status = liveState?.status ?? runData?.run?.status ?? 'completed';
  const dagNodes = liveState?.dagNodes ?? [];
  const storeArtifacts = liveState?.artifacts ?? [];
  const startedAt =
    liveState?.startedAt ??
    (runData?.run?.started_at ? new Date(ensureUtc(runData.run.started_at)).getTime() : null);
  const completedAt =
    liveState?.completedAt ??
    (runData?.run?.completed_at ? new Date(ensureUtc(runData.run.completed_at)).getTime() : null);
  const duration = startedAt != null && completedAt != null ? completedAt - startedAt : null;

  // Node counts: prefer live dagNodes (exact), fall back to events (approximation —
  // totalCount is nodes that reached a terminal state, not the workflow's full node count).
  let completedCount: number;
  let totalCount: number;
  if (dagNodes.length > 0) {
    completedCount = dagNodes.filter(n => n.status === 'completed').length;
    // Only count terminal nodes (same semantics as events fallback path)
    totalCount = dagNodes.filter(
      n => n.status === 'completed' || n.status === 'failed' || n.status === 'skipped'
    ).length;
  } else {
    const events = runData?.events ?? [];
    const terminalEvents = events.filter(
      e =>
        e.event_type === 'node_completed' ||
        e.event_type === 'node_failed' ||
        e.event_type === 'node_skipped'
    );
    completedCount = events.filter(e => e.event_type === 'node_completed').length;
    totalCount = terminalEvents.length;
  }

  // Artifacts: prefer live store, fall back to events
  const eventArtifacts: WorkflowArtifact[] = (runData?.events ?? [])
    .filter(e => e.event_type === 'workflow_artifact')
    .map(e => {
      const d = e.data;
      return {
        type: (typeof d.artifactType === 'string'
          ? d.artifactType
          : 'file_created') as ArtifactType,
        label: typeof d.label === 'string' ? d.label : '',
        url: typeof d.url === 'string' ? d.url : undefined,
        path: typeof d.path === 'string' ? d.path : undefined,
      };
    });
  const artifacts = storeArtifacts.length > 0 ? storeArtifacts : eventArtifacts;

  // If API fetch failed and no live state, show degraded card with just content + link
  const fetchFailed = isError && !liveState;

  // Status-aware header title
  let headerTitle: string;
  if (status === 'failed') {
    headerTitle = 'Workflow failed';
  } else if (status === 'cancelled') {
    headerTitle = 'Workflow cancelled';
  } else {
    headerTitle = 'Workflow complete';
  }

  // Expand/collapse for text content
  const lines = content.split('\n');
  const isTruncatable = content.length > 500 || lines.length > 8;
  const previewText = lines.slice(0, 8).join('\n').slice(0, 500);
  const preview = isTruncatable
    ? previewText + (previewText.length < content.length ? '...' : '')
    : content;
  const displayContent = expanded || !isTruncatable ? content : preview;

  return (
    <>
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-elevated">
          <span className="shrink-0">
            <StatusIcon status={fetchFailed ? 'completed' : status} />
          </span>
          <span className="text-xs font-medium text-text-primary truncate flex-1">
            {headerTitle}: {workflowName}
          </span>
          {!fetchFailed && totalCount > 0 && (
            <span className="shrink-0 text-[10px] text-text-secondary">
              {completedCount}/{totalCount} nodes
            </span>
          )}
          {!fetchFailed && duration != null && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-secondary shrink-0">
              {formatDurationMs(duration)}
            </span>
          )}
          <button
            onClick={(): void => {
              navigate(buildRunPath(runId));
            }}
            className="text-[10px] text-primary hover:text-accent-bright transition-colors shrink-0"
          >
            View full logs &rarr;
          </button>
        </div>
        <div className="px-3 py-2">
          {!fetchFailed && artifacts.length > 0 && (
            <div className="mb-2">
              <ArtifactSummary artifacts={artifacts} runId={runId} />
            </div>
          )}
          <div className="chat-markdown text-xs text-text-secondary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {displayContent}
            </ReactMarkdown>
          </div>
          {isTruncatable && (
            <button
              onClick={(): void => {
                setExpanded(!expanded);
              }}
              className="mt-1 text-[10px] text-primary hover:text-accent-bright transition-colors"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
      {artifactViewer && (
        <ArtifactViewerModal
          open={true}
          onOpenChange={(): void => {
            setArtifactViewer(null);
          }}
          runId={artifactViewer.runId}
          filename={artifactViewer.filename}
        />
      )}
    </>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** When this value changes, force-scroll to bottom regardless of user scroll position. */
  scrollTrigger?: number;
  /** Scroll to the first message at or after this timestamp. */
  scrollToTimestamp?: number | null;
  /** Increment to re-trigger scroll even if scrollToTimestamp didn't change (e.g. clicking same node). */
  scrollToTrigger?: number;
  /** When true, show welcoming empty state instead of generic placeholder. */
  isNewChat?: boolean;
  /** Project name to display as context in the welcoming view. */
  projectName?: string;
  /** Provider or model label shown in each agent message byline. */
  assistantLabel?: string;
}

function MessageListRaw({
  messages,
  isStreaming,
  scrollTrigger,
  scrollToTimestamp,
  scrollToTrigger,
  isNewChat,
  projectName,
  assistantLabel,
}: MessageListProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, scrollToBottom } = useAutoScroll(
    containerRef,
    [messages, isStreaming],
    scrollTrigger
  );

  // Scroll to a specific message by timestamp (e.g., when user clicks a DAG node).
  // Only fires on user-initiated clicks (scrollToTrigger > 0), not on mount/auto-select.
  useEffect(() => {
    if (scrollToTimestamp == null || !scrollToTrigger || !containerRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const elements = containerRef.current.querySelectorAll<HTMLElement>('[data-timestamp]');
      let target: HTMLElement | null = null;
      for (const el of elements) {
        const ts = Number(el.getAttribute('data-timestamp'));
        if (ts >= scrollToTimestamp) {
          target = el;
          break;
        }
      }
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return (): void => {
      cancelAnimationFrame(raf);
    };
  }, [scrollToTimestamp, scrollToTrigger]);

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-6">
        <div className="max-w-[52ch] py-8">
          <h2 className="text-xl font-extrabold text-text-primary">
            {isNewChat
              ? `Ask about ${projectName ?? 'your project'}, or start a workflow.`
              : 'Send a message to start chatting.'}
          </h2>
          <p className="mt-2 text-sm leading-[1.55] text-text-secondary">
            Archon answers from the project and can start runs. Runs show up in the Runs tab and
            report back here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={containerRef} className="h-full overflow-y-auto">
        <div className="flex flex-col px-6 pt-2 pb-6">
          {messages.map(msg =>
            msg.role === 'system' ? (
              <div
                key={msg.id}
                data-timestamp={String(msg.timestamp)}
                className="flex items-center gap-2 border-b border-border py-2 text-xs font-bold tracking-[0.06em] text-text-secondary uppercase"
              >
                <span>{msg.content}</span>
              </div>
            ) : (
              <div key={msg.id} data-timestamp={String(msg.timestamp)}>
                {msg.workflowResult ? (
                  <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-border py-3">
                    <span className="text-xs font-extrabold text-accent">Archon</span>
                    <WorkflowResultCard
                      workflowName={msg.workflowResult.workflowName}
                      runId={msg.workflowResult.runId}
                      content={msg.content}
                    />
                  </div>
                ) : (
                  <MessageBubble message={msg} assistantLabel={assistantLabel} />
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Jump to bottom button */}
      {!isAtBottom && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            onClick={scrollToBottom}
            size="sm"
            variant="secondary"
            className="rounded-full border border-border bg-surface-elevated"
          >
            <ArrowDown className="mr-1 h-3 w-3" />
            Jump to bottom
          </Button>
        </div>
      )}
    </div>
  );
}

const messageList = memo(MessageListRaw);
export { messageList as MessageList };
