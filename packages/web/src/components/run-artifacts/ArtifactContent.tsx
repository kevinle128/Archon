import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { isMarkdownPath } from '@/lib/run-artifacts/api';

// Hoisted so react-markdown does not see new plugin references on every render.
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
        className="rounded bg-surface-inset px-1.5 py-0.5 font-mono text-sm text-text-primary"
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
    <blockquote className="border-l-2 border-border pl-4 text-text-secondary" {...props}>
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<'a'>): React.ReactElement => (
    <a
      className="text-accent underline decoration-accent/40 hover:decoration-accent"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

interface ArtifactContentProps {
  path: string;
  content: string;
}

/** Markdown files render as rich text; every other file is monospace plain text. */
export function ArtifactContent({ path, content }: ArtifactContentProps): React.ReactElement {
  if (isMarkdownPath(path)) {
    return (
      <div className="chat-markdown max-w-none text-sm text-text-primary">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-text-primary">
      {content}
    </pre>
  );
}
