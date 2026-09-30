import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pollProviderOAuth, startProviderOAuth } from '@/lib/settings/api';
import { settingsKeys } from '@/lib/settings/query-keys';
import { normalizeOAuthCode } from '@/lib/settings/oauth-code';
import { mergeOAuthSignals } from '@/lib/settings/oauth-flow';
import type { ProviderOAuthStart } from '@/lib/settings/types';
import { useCancelledRef } from '@/lib/settings/use-cancelled-ref';
import { Btn, TextInput } from './primitives';

type Phase = 'starting' | 'manual' | 'device' | 'error';

/** Matches the server bridge's session TTL. */
const SESSION_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

/**
 * Drives one subscription (OAuth) login for `provider` through the held-session
 * bridge, in both modes: `device` (show a user code and URL, poll) and `manual`
 * (show a URL and a paste-code input; the single poll loop submits the pasted code
 * and also catches a local-callback resolution with no paste). On `connected` it
 * refreshes the connection matrix and calls `onDone`. Codes and tokens are never
 * logged.
 */
export function SubscriptionLoginFlow({
  provider,
  displayName,
  onDone,
}: {
  provider: string;
  displayName?: string;
  onDone: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('starting');
  const [start, setStart] = useState<ProviderOAuthStart | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // The unmount guard is mount-scoped; the effect below adds a per-run `superseded`
  // flag so a provider change stops the old poll loop.
  const cancelledRef = useCancelledRef();
  const pendingCodeRef = useRef<string | undefined>(undefined);
  // Keep the callbacks in refs so the start/poll effect depends only on `provider`.
  // A fresh inline `onDone` per parent render would otherwise restart the login
  // and drop an in-flight session or pasted code.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    let superseded = false;
    const stale = (): boolean => superseded || cancelledRef.current;
    let started = false;

    const pollLoop = async (sessionId: string): Promise<void> => {
      const deadline = Date.now() + SESSION_TTL_MS;
      for (;;) {
        if (stale()) return;
        if (Date.now() > deadline) {
          setPhase('error');
          setMessage('Login timed out. Close and try again.');
          return;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (stale()) return;
        try {
          const submit = pendingCodeRef.current;
          pendingCodeRef.current = undefined;
          const res = await pollProviderOAuth(provider, sessionId, submit);
          if (stale()) return;
          // The authorize URL or device code can arrive via poll rather than start
          // when a start superseded a prior session; merge late signals or the
          // manual panel stays linkless while polling "pending".
          setStart(prev => (prev ? mergeOAuthSignals(prev, res) : prev));
          const polledMode = res.mode;
          if (polledMode) setPhase(p => (p === 'error' ? p : polledMode));
          if (res.status === 'connected') {
            void queryClientRef.current.invalidateQueries({
              queryKey: settingsKeys.providerConnections,
            });
            onDoneRef.current();
            return;
          }
          if (res.status === 'error') {
            setPhase('error');
            setMessage(res.detail ?? 'Login failed.');
            return;
          }
        } catch (e: unknown) {
          if (stale()) return;
          setPhase('error');
          setMessage(e instanceof Error ? e.message : 'Login poll failed.');
          return;
        }
      }
    };

    void (async (): Promise<void> => {
      try {
        const s = await startProviderOAuth(provider);
        if (stale() || started) return;
        started = true;
        setStart(s);
        setPhase(s.mode === 'device' ? 'device' : 'manual');
        void pollLoop(s.sessionId);
      } catch (e: unknown) {
        if (stale()) return;
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'Failed to start login.');
      }
    })();

    return (): void => {
      superseded = true;
    };
  }, [provider, cancelledRef]);

  const submitCode = (): void => {
    if (code.trim() === '') return;
    pendingCodeRef.current = normalizeOAuthCode(code);
    setCode('');
    setMessage('Submitting...');
  };

  const linkClass = 'text-text-primary underline underline-offset-2';

  return (
    <div className="col-span-full grid gap-3 rounded-xl border border-border border-l-[3px] border-l-accent bg-surface p-4 text-sm text-text-secondary">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-text-primary">
          {displayName ?? provider} subscription login
        </span>
        <Btn variant="ghost" onClick={onDone}>
          Cancel
        </Btn>
      </div>

      {phase === 'starting' ? <span className="text-text-tertiary">Starting...</span> : null}

      {phase === 'device' && start?.userCode && start.verificationUri ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>
            Open{' '}
            <a
              href={start.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {start.verificationUri}
            </a>{' '}
            and enter
          </span>
          <span className="font-mono text-xl font-medium tracking-[0.08em] text-text-primary">
            {start.userCode}
          </span>
          <span className="text-xs text-text-tertiary">Waiting for approval</span>
        </div>
      ) : null}

      {phase === 'manual' && !start?.url ? (
        <span className="text-text-tertiary">
          Waiting for the authorization link. This can take a few seconds when a previous attempt
          was just cancelled.
        </span>
      ) : null}

      {phase === 'manual' && start?.url ? (
        <div className="grid gap-3">
          <span>
            1. Open{' '}
            <a href={start.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
              this authorization link
            </a>{' '}
            and approve.
          </span>
          <span className="text-text-tertiary">
            2. If it shows a code, or a failed <code className="font-mono">localhost</code>{' '}
            redirect, paste the code or the whole redirect URL below. On the same machine as the
            server it may connect on its own.
          </span>
          <form
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
            onSubmit={e => {
              e.preventDefault();
              submitCode();
            }}
          >
            <TextInput
              type="password"
              value={code}
              onChange={e => {
                setCode(e.target.value);
              }}
              placeholder="Paste code or localhost callback URL"
              aria-label="Authorization code"
              autoComplete="off"
              className="font-mono"
            />
            <Btn type="submit" disabled={code.trim() === ''}>
              Submit
            </Btn>
          </form>
        </div>
      ) : null}

      {message !== null ? (
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          className={phase === 'error' ? 'text-xs text-error' : 'text-xs text-text-tertiary'}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
