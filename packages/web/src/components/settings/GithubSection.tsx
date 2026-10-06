import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disconnectGithub,
  getGithubConnection,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
} from '@/lib/api';
import { interpretPollStatus } from '@/lib/settings/github-flow';
import { hasStatus } from '@/lib/settings/http';
import { settingsKeys } from '@/lib/settings/query-keys';
import { useCancelledRef } from '@/lib/settings/use-cancelled-ref';
import {
  Btn,
  HelpText,
  InlineError,
  LoadingLine,
  ROW_CLASS,
  SettingsSection,
  StatusPill,
} from './primitives';

type Phase = 'idle' | 'pending' | 'error';

/**
 * Connect or disconnect the current web user's GitHub identity through the device
 * flow: start, then poll at the server-supplied interval until connected, expired
 * or denied. The section hides on a 401 (no web identity). A mount-scoped guard
 * stops the poll loop and every state write after unmount.
 */
export function GithubSection(): ReactElement | null {
  const queryClient = useQueryClient();
  const { data: status, error } = useQuery({
    queryKey: settingsKeys.githubConnection,
    queryFn: getGithubConnection,
    retry: false,
  });

  const [phase, setPhase] = useState<Phase>('idle');
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const cancelledRef = useCancelledRef();

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: settingsKeys.githubConnection });

  const connect = async (): Promise<void> => {
    setPhase('pending');
    setMessage(null);
    try {
      const start = await startGithubDeviceFlow();
      if (cancelledRef.current) return;
      setUserCode(start.user_code);
      setVerificationUri(start.verification_uri);
      const deadline = Date.now() + start.expires_in * 1000;
      let interval = Math.max(1, start.interval);
      for (;;) {
        if (cancelledRef.current) return;
        if (Date.now() > deadline) throw new Error('Device code expired. Try again.');
        await new Promise(r => setTimeout(r, interval * 1000));
        if (cancelledRef.current) return;
        const res = await pollGithubDeviceFlow(start.device_code);
        const step = interpretPollStatus(res, interval);
        if (step.kind === 'connected') {
          // Stay in 'pending' until the refetch flips `connected`, so the
          // not-connected view never flashes for one render.
          setUserCode(null);
          setVerificationUri(null);
          await refresh();
          if (!cancelledRef.current) setPhase('idle');
          return;
        }
        if (step.kind === 'retry') {
          interval = step.nextInterval;
          continue;
        }
        throw new Error(step.message);
      }
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      setPhase('error');
      setUserCode(null);
      setVerificationUri(null);
      setMessage(e instanceof Error ? e.message : 'GitHub connect failed.');
    }
  };

  const disconnect = async (): Promise<void> => {
    setDisconnecting(true);
    setMessage(null);
    setPhase('idle');
    try {
      await disconnectGithub();
      if (cancelledRef.current) return;
      await refresh();
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      setPhase('error');
      setMessage(e instanceof Error ? e.message : 'Disconnect failed.');
    } finally {
      if (!cancelledRef.current) setDisconnecting(false);
    }
  };

  // 401 means no web identity (solo PAT, or logged out on a web-auth install):
  // there is no per-user GitHub identity to manage, so the section is omitted.
  if (hasStatus(error, 401)) return null;

  const wrap = (children: ReactElement, aside?: ReactElement): ReactElement => (
    <SettingsSection
      id="set-github"
      title="GitHub connection"
      description="Your GitHub identity for commits, pull requests and workflows that declare requires: [github]."
      aside={aside}
    >
      {children}
    </SettingsSection>
  );

  if (error) {
    return wrap(
      <InlineError>
        {error instanceof Error ? error.message : 'Failed to load GitHub status.'}
      </InlineError>
    );
  }
  if (status === undefined) return wrap(<LoadingLine />);

  return wrap(
    <>
      {status.connected ? (
        <div className={`${ROW_CLASS} border-t border-border`}>
          <div className="grid gap-1">
            <div className="text-sm font-medium text-text-primary">@{status.githubLogin}</div>
            <div className="font-mono text-xs text-text-tertiary">device flow</div>
          </div>
          <Btn variant="danger" disabled={disconnecting} onClick={() => void disconnect()}>
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Btn>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Btn disabled={phase === 'pending'} onClick={() => void connect()}>
            {phase === 'pending' ? 'Connecting...' : 'Connect GitHub'}
          </Btn>
          <HelpText>
            Connect starts the device flow: open the GitHub device page and enter the code shown
            here.
          </HelpText>
        </div>
      )}

      {phase === 'pending' && userCode && verificationUri ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border border-l-[3px] border-l-accent bg-surface p-4 text-sm text-text-secondary">
          <span>
            Open{' '}
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-primary underline underline-offset-2"
            >
              {verificationUri}
            </a>{' '}
            and enter
          </span>
          <span className="font-mono text-xl font-medium tracking-[0.08em] text-text-primary">
            {userCode}
          </span>
          <span className="text-xs text-text-tertiary">Waiting for approval</span>
        </div>
      ) : null}

      {phase === 'error' && message ? <InlineError>{message}</InlineError> : null}
    </>,
    status.connected ? <StatusPill tone="done">Connected</StatusPill> : undefined
  );
}
