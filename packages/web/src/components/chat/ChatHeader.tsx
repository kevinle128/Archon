import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Folder, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ideUri } from '@/lib/ide-uri';

interface ChatHeaderProps {
  title: string;
  projectName?: string;
  /** Provider that serves this conversation (for example "codex"). */
  provider?: string;
  /** Platform that started the conversation (for example "web"). */
  platform?: string;
  /** Working directory shown in the overflow menu. */
  path?: string;
  connected?: boolean;
  isDocker?: boolean;
  isWsl?: boolean;
  wslDistro?: string;
}

function Chip({
  children,
  mono,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1 rounded-full border border-border px-2 text-xs text-text-secondary',
        mono && 'font-mono',
        className
      )}
    >
      {children}
    </span>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

export function ChatHeader({
  title,
  projectName,
  provider,
  platform,
  path,
  connected,
  isDocker,
  isWsl,
  wslDistro,
}: ChatHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape so the menu never traps focus.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const copyPath = (): void => {
    if (!path) return;
    void navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      })
      .catch((error: unknown) => {
        console.debug('Clipboard write failed:', error);
      });
  };

  const openInIde = (): void => {
    if (!path) return;
    window.open(ideUri(path, { is_wsl: isWsl, wsl_distro: wslDistro }), '_blank');
    setMenuOpen(false);
  };

  const hasMenu = Boolean(path);
  const itemClass =
    'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-text-primary transition-colors duration-150 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-border py-1 pl-8 pr-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="truncate text-base font-semibold text-text-primary">{title}</h1>
        <div className="flex min-w-0 flex-wrap gap-2">
          {projectName && (
            <Chip>
              <Folder className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {projectName}
            </Chip>
          )}
          {provider && <Chip mono>{provider}</Chip>}
          {platform && <Chip>{capitalize(platform)}</Chip>}
          {connected !== undefined && (
            <Chip>
              <span
                aria-hidden="true"
                className={cn(
                  'h-2 w-2 rounded-full',
                  connected ? 'bg-success' : 'bg-text-tertiary'
                )}
              />
              {connected ? 'Connected' : 'Disconnected'}
            </Chip>
          )}
        </div>
      </div>
      {hasMenu && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Conversation actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(): void => {
              setMenuOpen(open => !open);
            }}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.5} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-surface-elevated p-1"
            >
              <button type="button" role="menuitem" onClick={copyPath} className={itemClass}>
                {copied ? (
                  <Check className="h-4 w-4 text-success" strokeWidth={1.5} />
                ) : (
                  <Copy className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
                )}
                <span className="min-w-0 flex-1 truncate" title={path}>
                  {copied ? 'Copied' : 'Copy working path'}
                </span>
              </button>
              {!isDocker && (
                <button type="button" role="menuitem" onClick={openInIde} className={itemClass}>
                  <ExternalLink className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
                  Open in IDE
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
