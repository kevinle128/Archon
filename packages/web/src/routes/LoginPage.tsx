import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PixelLogo } from '@/components/brand/PixelLogo';
import { ProgressStrip } from '@/components/ui/progress-strip';
import { getAuthStatus } from '@/lib/api';
import { signIn, signUp, useSession } from '@/lib/auth-client';
import { loginFormError, type LoginMode } from '@/lib/auth/login-form';

/** The motif strip: a run part way through, as the product shows it. */
const MOTIF_STATUSES = ['completed', 'completed', 'completed', 'running', 'pending', 'pending'];

const FIELD_CLASS =
  'h-10 w-full border border-line-strong bg-card px-3 text-sm text-text-primary placeholder:text-text-tertiary';

/**
 * Email/password login + signup for opt-in web auth. Signup may be gated by an
 * invite allowlist (the server returns a 403 the form surfaces). Rendered only
 * when auth is enabled; SessionGate routes here when there is no session.
 */
export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { data: status } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 5 * 60 * 1000,
  });

  const [mode, setMode] = useState<LoginMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (or auth disabled) → bounce to the app. Declarative
  // redirect (not an imperative navigate() in render) so we short-circuit before
  // rendering the form and don't fire a side effect during React's render phase.
  if (session?.user || status?.enabled === false) {
    return <Navigate to="/runs" replace />;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const problem = loginFormError(mode, email, password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result =
        mode === 'login'
          ? await signIn.email({ email: email.trim(), password })
          : await signUp.email({
              email: email.trim(),
              password,
              name: name.trim() || email.split('@')[0],
            });
      if (result.error) {
        setError(result.error.message ?? 'Authentication failed. Please try again.');
        return;
      }
      void navigate('/runs', { replace: true });
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Self-serve signup is off when the server reports `disabled` (no allowlist +
  // no open-signup flag). Hide the signup affordance entirely so we don't invite
  // a registration the server will only 403. Defaults to allowed while status is
  // still loading (it resolves quickly and the gate only renders when auth is on).
  const signupAllowed = status?.signup !== 'disabled';
  const isSignup = mode === 'signup';

  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] bg-background">
      <section className="flex flex-col justify-between gap-8 bg-header-bg p-8 text-header-fg">
        <div className="flex items-center gap-3">
          <PixelLogo label="" size="lg" tone="header" />
          <span className="text-[22px] font-extrabold">Archon</span>
        </div>
        <div className="flex flex-col gap-6">
          <p className="max-w-[18ch] text-[44px] leading-[1.05] font-extrabold">
            Run coding agents as workflows you can watch.
          </p>
          <ProgressStrip statuses={MOTIF_STATUSES} className="max-w-[320px]" />
        </div>
      </section>

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[28px] leading-[1.15] font-extrabold text-text-primary">
            {isSignup ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {isSignup
              ? status?.signup === 'allowlist'
                ? 'Signup is invite-only. Use an allowlisted email.'
                : 'Create an account to continue.'
              : 'Sign in to your Archon workspace.'}
          </p>
          <div className="mt-4 h-0.5 bg-foreground" />

          <form
            noValidate
            onSubmit={(e): void => {
              void handleSubmit(e);
            }}
            className="mt-5 flex flex-col gap-3"
          >
            {isSignup && (
              <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
                Name
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={e => {
                    setName(e.target.value);
                  }}
                  placeholder="Ada Lovelace"
                  className={FIELD_CLASS}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                }}
                placeholder="you@example.com"
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
              Password
              <input
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                }}
                placeholder="••••••••"
                className={FIELD_CLASS}
              />
            </label>

            {error !== null ? (
              <p role="alert" className="text-[13px] font-semibold text-error">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-11 w-full cursor-pointer items-center justify-between bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              <span>{submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {signupAllowed && (
            <button
              type="button"
              onClick={() => {
                setMode(isSignup ? 'login' : 'signup');
                setError(null);
              }}
              className="mt-4 cursor-pointer text-sm font-semibold text-accent hover:underline"
            >
              {isSignup ? 'Already have an account? Sign in' : 'No account yet? Sign up'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
