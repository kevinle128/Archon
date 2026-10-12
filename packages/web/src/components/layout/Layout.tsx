import { Outlet } from 'react-router';

import { TopBar } from '@/components/shell/TopBar';
import { useShellShortcuts } from '@/components/shell/use-shell-shortcuts';

/** App shell: the top bar over one full-height screen. */
export function Layout(): React.ReactElement {
  useShellShortcuts();
  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-background">
      <TopBar />
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
