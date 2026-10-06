import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import { PixelLogo } from '@/components/brand/PixelLogo';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

export function Layout(): React.ReactElement {
  // Below the md breakpoint the sidebar is an overlay opened from a slim top bar.
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-background md:flex-row max-md:flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-border bg-surface px-2 py-1 md:hidden">
        <button
          type="button"
          onClick={(): void => {
            setNavOpen(true);
          }}
          aria-label="Open navigation"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-elevated"
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <PixelLogo label="" />
        <span className="text-base font-semibold text-text-primary">Archon</span>
      </header>
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-scrim md:hidden"
          onClick={(): void => {
            setNavOpen(false);
          }}
        />
      )}
      <Sidebar
        className={cn(
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:transition-transform max-md:duration-200',
          navOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
        )}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
