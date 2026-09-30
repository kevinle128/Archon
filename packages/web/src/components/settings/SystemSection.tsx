import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHealth, getUpdateCheck } from '@/lib/api';
import { useConfigQuery } from '@/lib/settings/hooks';
import { settingsKeys } from '@/lib/settings/query-keys';
import { HelpText, InlineError, LoadingLine, SettingsSection, StatusPill } from './primitives';

const PLATFORMS = ['Web', 'Slack', 'Telegram', 'Discord', 'GitHub', 'Gitea', 'GitLab'] as const;

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-surface p-4">
      <span className="text-xs text-text-secondary">{label}</span>
      <b className="break-words font-mono text-sm font-medium text-text-primary">{value}</b>
    </div>
  );
}

function UpdateLine(): ReactElement {
  const { data: update, error } = useQuery({
    queryKey: ['update-check'],
    queryFn: getUpdateCheck,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  if (error) return <HelpText>Update check unavailable.</HelpText>;
  if (update === undefined) return <HelpText>Checking for updates...</HelpText>;
  if (update.updateAvailable) {
    return (
      <a
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-accent underline underline-offset-2"
      >
        {update.latestVersion} available
      </a>
    );
  }
  return <HelpText>Up to date ({update.currentVersion}).</HelpText>;
}

/** Read-only system status: health, database, concurrency, version, adapters and updates. */
export function SystemSection(): ReactElement {
  const { data: health, error: healthError } = useQuery({
    queryKey: settingsKeys.health,
    queryFn: getHealth,
  });
  const { data: config } = useConfigQuery();
  const gitCommit = import.meta.env.VITE_GIT_COMMIT as string | undefined;

  const active = new Set(health?.activePlatforms ?? []);
  const healthy = health?.status === 'ok';

  return (
    <SettingsSection
      id="set-system"
      title="System"
      description="Health, concurrency and platform adapters."
      aside={
        health ? (
          <StatusPill tone={healthy ? 'done' : 'fail'}>
            {healthy ? 'Healthy' : health.status}
          </StatusPill>
        ) : undefined
      }
    >
      {healthError ? (
        <InlineError>
          {healthError instanceof Error ? healthError.message : 'Failed to load system health.'}{' '}
          Check that the server is running.
        </InlineError>
      ) : null}
      {!health && !healthError ? <LoadingLine /> : null}
      {health ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Database" value={config?.database ?? 'unknown'} />
            <Stat
              label="Concurrency"
              value={`${String(health.concurrency.active)}/${String(health.concurrency.maxConcurrent)}`}
            />
            <Stat label="Queued" value={String(health.concurrency.queuedTotal)} />
            <Stat label="Running workflows" value={String(health.runningWorkflows)} />
            <Stat label="Adapter" value={health.adapter} />
            <Stat label="Version" value={health.version ?? 'unknown'} />
            {gitCommit && gitCommit !== 'unknown' ? (
              <Stat label="Commit" value={gitCommit} />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(name => {
              const on = active.has(name);
              return (
                <StatusPill key={name} tone={on ? 'done' : 'pend'}>
                  {name} &middot; {on ? 'active' : 'not configured'}
                </StatusPill>
              );
            })}
          </div>
          <UpdateLine />
        </>
      ) : null}
    </SettingsSection>
  );
}
