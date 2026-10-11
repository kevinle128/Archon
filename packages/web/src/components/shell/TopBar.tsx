import { Link, NavLink, useNavigate } from 'react-router';

import { PixelLogo } from '@/components/brand/PixelLogo';
import { useProject } from '@/contexts/ProjectContext';
import { useRunCounts } from '@/lib/runs/queries';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { NeedsYouButton } from './NeedsYouButton';
import { ProjectFilter } from './ProjectFilter';
import { ThemeToggle } from './ThemeToggle';

/**
 * Main navigation. "Workflows" uses `end` so it is not active on the builder,
 * which keeps its `/workflows/builder` URL.
 */
export const NAV_ITEMS = [
  { to: '/runs', label: 'Runs', end: false },
  { to: '/workflows', label: 'Workflows', end: true },
  { to: '/chat', label: 'Chat', end: false },
  { to: '/workflows/builder', label: 'Builder', end: false },
  { to: '/settings', label: 'Settings', end: false },
] as const;

/** Nav links of the top bar. The active link has the accent underline and `aria-current`. */
export function MainNav(): React.ReactElement {
  return (
    <nav
      aria-label="Main"
      className="order-last flex h-11 min-w-0 basis-full items-stretch overflow-x-auto border-t border-header-line [scrollbar-width:none] md:order-none md:h-auto md:flex-1 md:basis-auto md:border-t-0 [&::-webkit-scrollbar]:hidden"
    >
      {NAV_ITEMS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }: { isActive: boolean }): string =>
            cn(
              'flex flex-none items-center border-b-[3px] px-4 text-sm font-semibold no-underline',
              isActive
                ? 'border-header-accent text-header-fg'
                : 'border-transparent text-header-muted hover:text-header-fg'
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The 48px navy bar on every screen except Login. */
export function TopBar(): React.ReactElement {
  const navigate = useNavigate();
  const { selectedProjectId, setSelectedProjectId, codebases } = useProject();
  const { choice, setChoice } = useTheme();
  const projectCounts = useRunCounts(selectedProjectId);
  // The logo animates while any run is active in any project.
  const allCounts = useRunCounts(null);

  return (
    <header className="flex flex-none flex-wrap items-stretch border-b border-header-line bg-header-bg text-header-fg md:h-12 md:flex-nowrap">
      <Link
        to="/runs"
        aria-label="Archon home"
        className="flex h-12 flex-none items-center gap-2 border-r border-header-line px-4 text-header-fg no-underline"
      >
        <PixelLogo active={(allCounts?.running ?? 0) > 0} label="" size="sm" tone="header" />
        <span className="text-base font-extrabold max-sm:sr-only">Archon</span>
      </Link>
      <MainNav />
      <ProjectFilter
        codebases={codebases ?? []}
        value={selectedProjectId}
        onChange={setSelectedProjectId}
      />
      <NeedsYouButton
        count={projectCounts?.paused ?? 0}
        onClick={(): void => {
          void navigate('/runs?filter=needs');
        }}
      />
      <ThemeToggle choice={choice} onChange={setChoice} />
    </header>
  );
}
