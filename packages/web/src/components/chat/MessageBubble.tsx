import { memo, useMemo, useState } from 'react';
import { Copy, Check, Paperclip, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, FileAttachment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ArtifactViewerModal } from '@/components/workflows/ArtifactViewerModal';
import { ErrorCard } from './ErrorCard';
import { ToolCallCard } from './ToolCallCard';
import { WorkflowProgressCard } from './WorkflowProgressCard';

// Hoisted to module scope to prevent new references on every render
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS = [rehypeHighlight];

// Matches artifact paths (forward- and back-slash safe); groups: [1] runId, [2] filename
const ARTIFACT_PATH_RE = /artifacts[/\\]runs[/\\]([a-fA-F0-9-]+)[/\\](.+)/;

function extractArtifactInfo(text: string): { runId: string; filename: string } | null {
  const match = ARTIFACT_PATH_RE.exec(text);
  if (!match) return null;
  const filename = match[2].replace(/\\/g, '/');
  if (filename.split('/').some(s => s === '..')) return null;
  return {
    runId: match[1],
    filename,
  };
}

function makeMarkdownComponents(
  onArtifactClick: (runId: string, filename: string) => void
): Components {
  return {
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
      if (typeof children === 'string') {
        const artifact = extractArtifactInfo(children);
        if (artifact) {
          const { runId, filename } = artifact;
          const displayName = filename.split('/').pop() ?? filename;
          if (filename.endsWith('.md')) {
            return (
              <button
                type="button"
                className="cursor-pointer rounded bg-background px-1.5 py-0.5 font-mono text-sm text-accent-bright hover:text-primary transition-colors"
                onClick={() => {
                  onArtifactClick(runId, filename);
                }}
              >
                {displayName}
              </button>
            );
          }
          const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
          return (
            <a
              href={`/api/artifacts/${encodeURIComponent(runId)}/${encodedFilename}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-background px-1.5 py-0.5 font-mono text-sm text-accent-bright underline decoration-accent-bright/40 hover:decoration-accent-bright"
            >
              {displayName}
            </a>
          );
        }
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
    table: ({
      children,
      ...props
    }: React.ComponentPropsWithoutRef<'table'>): React.ReactElement => (
      <div className="overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    ),
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
}

/** Detect if a string is a complete JSON object/array */
function isJsonString(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

interface MessageBubbleProps {
  message: ChatMessage;
  /** Provider or model that answers, shown in the agent byline. */
  assistantLabel?: string;
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Three quiet dots that show only while the agent is streaming. Static under reduced motion. */
function TypingDots(): React.ReactElement {
  return (
    <span
      role="status"
      aria-label="Archon is typing"
      className="block text-[13px] text-text-secondary italic"
    >
      Archon is replying…
    </span>
  );
}

function MessageBubbleRaw({ message, assistantLabel }: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user';
  const isThinking = message.isStreaming && !message.content;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [artifactViewer, setArtifactViewer] = useState<{ runId: string; filename: string } | null>(
    null
  );
  // setArtifactViewer is a stable React state setter — empty dep array is intentional
  const markdownComponents = useMemo(
    () =>
      makeMarkdownComponents((runId, filename) => {
        setArtifactViewer({ runId, filename });
      }),
    []
  );

  const copyMessage = (): void => {
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setCopyError(false);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      })
      .catch(error => {
        console.debug('Clipboard write failed:', error);
        setCopyError(true);
        setTimeout(() => {
          setCopyError(false);
        }, 2000);
      });
  };

  return (
    <>
      <div
        className="group grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-border py-3"
        data-role={message.role}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn('text-xs font-extrabold', isUser ? 'text-text-primary' : 'text-accent')}
          >
            {isUser ? 'You' : 'Archon'}
          </span>
          {isThinking ? null : (
            <span className="text-[11px] text-text-tertiary">
              {formatMessageTime(message.timestamp)}
            </span>
          )}
          {!isUser && assistantLabel ? (
            <span className="truncate text-[11px] text-text-tertiary" title={assistantLabel}>
              {assistantLabel}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {isUser ? (
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[14.5px] leading-[1.6] font-semibold break-words whitespace-pre-wrap text-text-primary">
                {message.content}
              </p>
              <button
                onClick={copyMessage}
                className="mt-0.5 shrink-0 cursor-pointer text-text-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-text-primary focus-visible:opacity-100"
                title={copyError ? 'Failed to copy' : 'Copy message'}
                aria-label={copied ? 'Copied' : copyError ? 'Failed to copy' : 'Copy message'}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : copyError ? (
                  <X className="h-3.5 w-3.5 text-error" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ) : (
            <div className="chat-markdown max-w-none text-[14.5px] leading-[1.6] text-text-primary">
              {isThinking && <span className="sr-only">Thinking</span>}
              {message.content &&
                (isJsonString(message.content) ? (
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-text-secondary hover:text-text-primary">
                      <span className="bg-surface px-1.5 py-0.5 font-mono text-xs">
                        JSON output
                      </span>
                    </summary>
                    <pre className="mt-2 overflow-x-auto bg-code-bg p-3 text-xs text-code-fg">
                      {JSON.stringify(JSON.parse(message.content.trim()) as unknown, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
                ))}
              {message.isStreaming && <TypingDots />}
            </div>
          )}
          {isUser && message.files && message.files.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {message.files.map((file: FileAttachment) => (
                <div
                  key={file.id}
                  className="flex items-center gap-1 border border-line-strong bg-surface px-1.5 py-0.5 text-xs text-text-secondary"
                  title={file.name}
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                </div>
              ))}
            </div>
          )}
          {message.toolCalls?.map(tool => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
          {message.error && <ErrorCard error={message.error} />}
          {message.workflowDispatch && (
            <WorkflowProgressCard
              workflowName={message.workflowDispatch.workflowName}
              workerConversationId={message.workflowDispatch.workerConversationId}
            />
          )}
        </div>
      </div>
      {artifactViewer && (
        <ArtifactViewerModal
          open={true}
          onOpenChange={() => {
            setArtifactViewer(null);
          }}
          runId={artifactViewer.runId}
          filename={artifactViewer.filename}
        />
      )}
    </>
  );
}

// Memoize: only re-render when message content/state actually changes
const messageBubble = memo(MessageBubbleRaw, (prev, next) => {
  return (
    prev.message.content === next.message.content &&
    prev.message.isStreaming === next.message.isStreaming &&
    prev.message.toolCalls === next.message.toolCalls &&
    prev.message.error === next.message.error &&
    prev.message.workflowDispatch === next.message.workflowDispatch &&
    prev.message.workflowResult === next.message.workflowResult &&
    prev.message.files === next.message.files &&
    prev.assistantLabel === next.assistantLabel
  );
});

export { messageBubble as MessageBubble };
