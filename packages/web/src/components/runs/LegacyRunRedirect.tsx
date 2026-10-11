import { Navigate, useLocation, useParams } from 'react-router';

import { legacyRunTarget } from '@/lib/runs/run-url';

/**
 * Old run links `/workflows/runs/:runId?node=<id>` open the Runs workspace. Slack and
 * Telegram approval messages carry this link format, so the redirect is permanent.
 */
export function LegacyRunRedirect(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const { search } = useLocation();
  if (runId === undefined) return <Navigate to="/runs" replace />;
  return <Navigate to={legacyRunTarget(runId, search)} replace />;
}
