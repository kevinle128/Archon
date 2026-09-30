import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Moon, Sun } from 'lucide-react';
import { getUpdateCheck, getAuthStatus } from '@/lib/api';
import { useSession, signOut } from '@/lib/auth-client';
import { useTheme } from '@/lib/theme';

const iconButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary';

/** Identity, version, update notice, sign out (web auth only) and the theme toggle. */
export function SidebarFooter(): React.ReactElement {
  const navigate = useNavigate();
  const { resolved, toggle } = useTheme();

  // Web-auth identity (only shown when auth is enabled).
  const { data: authStatus } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  const { data: session } = useSession();

  const { data: updateCheck } = useQuery({
    queryKey: ['update-check'],
    queryFn: getUpdateCheck,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: false,
  });

  async function handleSignOut(): Promise<void> {
    await signOut();
    navigate('/login', { replace: true });
  }

  const user = authStatus?.enabled ? session?.user : undefined;
  const displayName = user ? user.name || user.email : null;
  const nextTheme = resolved === 'dark' ? 'light' : 'dark';

  return (
    <div className="flex items-center gap-2 border-t border-border pl-2 pt-2">
      {displayName && (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-text-primary"
          aria-hidden
        >
          {displayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="grid min-w-0 flex-1 leading-snug">
        {displayName && (
          <span className="truncate text-sm font-medium text-text-primary" title={user?.email}>
            {displayName}
          </span>
        )}
        <span className="truncate text-xs text-text-tertiary">
          Archon v{import.meta.env.VITE_APP_VERSION as string}
          {updateCheck?.updateAvailable && updateCheck.releaseUrl && (
            <a
              href={updateCheck.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 inline-flex items-center gap-1 text-accent hover:underline"
              title={`v${updateCheck.latestVersion} available`}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
              v{updateCheck.latestVersion}
            </a>
          )}
        </span>
      </div>
      {user && (
        <button
          type="button"
          onClick={() => void handleSignOut()}
          title="Sign out"
          aria-label="Sign out"
          className={iconButtonClass}
        >
          <LogOut className="h-5 w-5" strokeWidth={1.5} />
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        title={`Switch to ${nextTheme} theme`}
        aria-label={`Switch to ${nextTheme} theme`}
        className={iconButtonClass}
      >
        {resolved === 'dark' ? (
          <Sun className="h-5 w-5" strokeWidth={1.5} />
        ) : (
          <Moon className="h-5 w-5" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}
