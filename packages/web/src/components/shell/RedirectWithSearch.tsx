import { Navigate, useLocation } from 'react-router';

/** Redirects to `to` and keeps the current query string, so filter links stay valid. */
export function RedirectWithSearch({ to }: { to: string }): React.ReactElement {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}
