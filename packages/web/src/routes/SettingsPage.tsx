import { createElement, useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { useProject } from '@/contexts/ProjectContext';
import { getConfig, getGithubConnection } from '@/lib/api';
import { hasStatus } from '@/lib/settings/http';
import { useProviderKeysQuery } from '@/lib/settings/hooks';
import { settingsKeys } from '@/lib/settings/query-keys';
import { AccountFooter } from '@/components/settings/AccountFooter';
import { AliasesSection } from '@/components/settings/AliasesSection';
import { AssistantSection } from '@/components/settings/AssistantSection';
import { GithubSection } from '@/components/settings/GithubSection';
import { ModelTiersSection } from '@/components/settings/ModelTiersSection';
import { ProjectsSection } from '@/components/settings/ProjectsSection';
import { ProvidersSection } from '@/components/settings/ProvidersSection';
import { SettingsNav, type SettingsNavItem } from '@/components/settings/SettingsNav';
import { SystemSection } from '@/components/settings/SystemSection';
import { UsageSection } from '@/components/settings/UsageSection';

const SECTIONS: Readonly<Record<string, () => ReactElement | null>> = {
  providers: ProvidersSection,
  assistant: AssistantSection,
  tiers: ModelTiersSection,
  aliases: AliasesSection,
  projects: ProjectsSection,
  github: GithubSection,
  usage: UsageSection,
  system: SystemSection,
};

/** Settings: a section list on the left and the chosen section on the right. */
export function SettingsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { codebases } = useProject();

  // The providers and GitHub sections need a web identity and render nothing on a
  // 401. These reads share their cache keys with the sections, so this adds no
  // extra requests and keeps the section list free of dead rows.
  const { data: providerKeys, error: providersError } = useProviderKeysQuery();
  const { data: github, error: githubError } = useQuery({
    queryKey: settingsKeys.githubConnection,
    queryFn: getGithubConnection,
    retry: false,
  });
  const { data: config } = useQuery({ queryKey: settingsKeys.config, queryFn: getConfig });
  const hideProviders = hasStatus(providersError, 401);
  const hideGithub = hasStatus(githubError, 401);

  const items = useMemo((): SettingsNavItem[] => {
    const notReady = providerKeys?.agents.filter(agent => !agent.ready).length ?? 0;
    const aliasCount = Object.keys(config?.config.aliases ?? {}).length;
    const all: (SettingsNavItem | null)[] = [
      hideProviders
        ? null
        : {
            id: 'providers',
            label: 'AI providers',
            hint: notReady > 0 ? `${String(notReady)} not set` : undefined,
            hintAttention: notReady > 0,
          },
      { id: 'assistant', label: 'Assistant defaults' },
      { id: 'tiers', label: 'Model tiers' },
      { id: 'aliases', label: 'Aliases', hint: String(aliasCount) },
      { id: 'projects', label: 'Projects', hint: String(codebases?.length ?? 0) },
      hideGithub
        ? null
        : { id: 'github', label: 'GitHub', hint: github?.connected === true ? 'On' : 'Off' },
      { id: 'usage', label: 'Usage and cost' },
      { id: 'system', label: 'System' },
    ];
    return all.filter((item): item is SettingsNavItem => item !== null);
  }, [codebases, config, github, hideGithub, hideProviders, providerKeys]);

  const requested = searchParams.get('section');
  const active = items.some(item => item.id === requested)
    ? (requested ?? '')
    : (items[0]?.id ?? '');
  const renderSection = SECTIONS[active];

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(200px,240px)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-auto border-line-strong max-md:border-b-2 md:border-r-2">
        <h1 className="px-4 py-3 text-xl font-extrabold">Settings</h1>
        <SettingsNav
          items={items}
          active={active}
          onSelect={(id): void => {
            setSearchParams({ section: id }, { replace: true });
          }}
        />
        <div className="flex-1 max-md:hidden" />
        <div className="max-md:hidden">
          <AccountFooter />
        </div>
      </aside>
      <main className="min-h-0 overflow-auto">
        <div className="max-w-[880px] px-8 pt-6 pb-8 max-md:px-4">
          {renderSection !== undefined ? createElement(renderSection) : null}
        </div>
      </main>
    </div>
  );
}
