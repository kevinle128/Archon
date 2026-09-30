import { useMemo, useRef, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGithubConnection } from '@/lib/api';
import { hasStatus } from '@/lib/settings/http';
import { useProviderKeysQuery } from '@/lib/settings/hooks';
import { settingsKeys } from '@/lib/settings/query-keys';
import { AliasesSection } from '@/components/settings/AliasesSection';
import { AssistantSection } from '@/components/settings/AssistantSection';
import { GithubSection } from '@/components/settings/GithubSection';
import { ModelTiersSection } from '@/components/settings/ModelTiersSection';
import { ProjectsSection } from '@/components/settings/ProjectsSection';
import { ProvidersSection } from '@/components/settings/ProvidersSection';
import { SettingsNav, type SettingsNavItem } from '@/components/settings/SettingsNav';
import { SystemSection } from '@/components/settings/SystemSection';
import { UsageSection } from '@/components/settings/UsageSection';

const NAV: readonly SettingsNavItem[] = [
  { id: 'set-projects', label: 'Projects' },
  { id: 'set-assistant', label: 'Assistant defaults' },
  { id: 'set-providers', label: 'AI providers' },
  { id: 'set-github', label: 'GitHub' },
  { id: 'set-tiers', label: 'Model tiers' },
  { id: 'set-aliases', label: 'Aliases' },
  { id: 'set-usage', label: 'Usage and cost' },
  { id: 'set-system', label: 'System' },
];

export function SettingsPage(): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // The providers and GitHub sections need a web identity and render nothing on a
  // 401. These reads share their cache keys with the sections, so this adds no
  // extra requests and keeps the section index free of dead links.
  const { error: providersError } = useProviderKeysQuery();
  const { error: githubError } = useQuery({
    queryKey: settingsKeys.githubConnection,
    queryFn: getGithubConnection,
    retry: false,
  });
  const hideProviders = hasStatus(providersError, 401);
  const hideGithub = hasStatus(githubError, 401);

  const items = useMemo(
    () =>
      NAV.filter(
        item =>
          !(item.id === 'set-providers' && hideProviders) &&
          !(item.id === 'set-github' && hideGithub)
      ),
    [hideProviders, hideGithub]
  );

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <SettingsNav items={items} scrollRef={scrollRef} />
      <div ref={scrollRef} className="min-h-0 overflow-y-auto">
        <div className="max-w-[840px] px-6 pb-16 pt-10 md:px-12">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-text-primary">
            Settings
          </h1>
          <div className="mt-4">
            <ProjectsSection />
            <AssistantSection />
            <ProvidersSection />
            <GithubSection />
            <ModelTiersSection />
            <AliasesSection />
            <UsageSection />
            <SystemSection />
          </div>
        </div>
      </div>
    </div>
  );
}
