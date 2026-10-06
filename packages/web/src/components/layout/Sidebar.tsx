import { useState, useRef, useMemo } from 'react';
import { NavLink, Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, MessageSquare, Plus, Settings, Workflow } from 'lucide-react';
import { PixelLogo } from '@/components/brand/PixelLogo';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchBar } from '@/components/sidebar/SearchBar';
import { SidebarProjects } from '@/components/sidebar/SidebarProjects';
import { SidebarFooter } from '@/components/sidebar/SidebarFooter';
import { NeedsYouSection } from '@/components/sidebar/NeedsYouSection';
import { ProjectDetail } from '@/components/sidebar/ProjectDetail';
import { AllConversationsView } from '@/components/sidebar/AllConversationsView';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useProject } from '@/contexts/ProjectContext';
import { listDashboardRuns } from '@/lib/api';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/chat', end: false, icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/workflows', end: false, icon: Workflow, label: 'Workflows' },
  { to: '/settings', end: false, icon: Settings, label: 'Settings' },
] as const;

/** How many paused runs the "Needs you" list loads. The badge shows the server total. */
const NEEDS_YOU_LIMIT = 20;

export function Sidebar({ className }: { className?: string }): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { selectedProjectId, codebases } = useProject();
  const selectedProject = codebases?.find(cb => cb.id === selectedProjectId) ?? null;

  // One request feeds both the "Needs you" list and the running badge: `counts`
  // is a server-side aggregate over every status, independent of the filter.
  const { data: dashboardRuns } = useQuery({
    queryKey: ['dashboardRuns', { status: 'paused', forSidebar: true }],
    queryFn: () => listDashboardRuns({ status: 'paused', limit: NEEDS_YOU_LIMIT }),
    refetchInterval: 10_000,
  });
  const runningCount = dashboardRuns?.counts.running ?? 0;
  const pausedCount = dashboardRuns?.counts.paused ?? 0;

  const shortcuts = useMemo(
    () => ({
      '/': (): void => searchInputRef.current?.focus(),
      Escape: (): void => {
        setSearchQuery('');
        searchInputRef.current?.blur();
      },
    }),
    []
  );
  useKeyboardShortcuts(shortcuts);

  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'flex h-full w-[248px] shrink-0 flex-col gap-2 border-r border-border bg-surface px-3 pb-2 pt-3',
        className
      )}
    >
      <Link
        to="/chat"
        aria-label="Archon home"
        className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-text-primary"
      >
        <PixelLogo active={runningCount > 0} label="" />
        <span className="text-base font-semibold">Archon</span>
      </Link>

      <button
        type="button"
        onClick={(): void => {
          void navigate('/chat');
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-text-primary transition-colors duration-150 hover:bg-surface-elevated"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        New chat
      </button>

      <nav aria-label="Main" className="grid gap-0.5">
        {tabs.map(({ to, end, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }: { isActive: boolean }): string =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
              )
            }
          >
            <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            {label}
            {to === '/dashboard' && runningCount > 0 && (
              <span
                className="ml-auto font-mono text-xs font-medium"
                title="Running workflows"
                aria-label={`${String(runningCount)} workflows running`}
              >
                {runningCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1">
        {/* Radix wraps the viewport content in a table-layout div that grows with its widest
            child; forcing block layout keeps long titles truncating inside the sidebar. */}
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-0.5 pb-2">
            <NeedsYouSection runs={dashboardRuns?.runs ?? []} total={pausedCount} />
            <div className="pt-2">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search..."
                inputRef={searchInputRef}
              />
            </div>
            <SidebarProjects searchQuery={searchQuery} />
            {selectedProjectId ? (
              <ProjectDetail
                codebaseId={selectedProjectId}
                projectName={selectedProject?.name ?? ''}
                repositoryUrl={selectedProject?.repository_url}
                searchQuery={searchQuery}
              />
            ) : (
              <AllConversationsView searchQuery={searchQuery} />
            )}
          </div>
        </ScrollArea>
      </div>

      <SidebarFooter />
    </aside>
  );
}
