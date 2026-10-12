import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, MoreHorizontal } from 'lucide-react';
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
    'flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] text-text-primary hover:bg-selection';

  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-text-secondary">
          <span className="truncate">{projectName ?? 'No project'}</span>
          {provider ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{provider}</span>
            </>
          ) : null}
          {platform ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{capitalize(platform)}</span>
            </>
          ) : null}
          {connected !== undefined ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={connected ? 'text-status-done' : 'text-text-tertiary'}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </>
          ) : null}
        </div>
        <h2 className="mt-0.5 truncate text-[22px] leading-[1.2] font-extrabold text-text-primary">
          {title}
        </h2>
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
            className="flex h-8 w-8 cursor-pointer items-center justify-center border border-line-strong bg-card text-text-secondary hover:text-text-primary"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.5} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 w-64 border border-line-strong bg-card py-1"
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
