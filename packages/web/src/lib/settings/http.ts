/**
 * Minimal JSON request helper for settings endpoints that `@/lib/api` does not
 * wrap. Same contract as the shared client: same-origin credentials, JSON body
 * header only when a body is sent, and a thrown error carrying the HTTP status.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly path: string;
  /** Server error body, capped at 200 chars (may be cut mid-JSON). */
  readonly bodySnippet: string;
  constructor(status: number, path: string, bodySnippet: string) {
    super(`API error ${status.toString()} (${path}): ${bodySnippet}`);
    this.name = 'HttpError';
    this.status = status;
    this.path = path;
    this.bodySnippet = bodySnippet;
  }
}

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined;
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const truncated = body.length > 200 ? `${body.slice(0, 200)}...` : body;
    const path = new URL(url, window.location.origin).pathname;
    throw new HttpError(res.status, path, truncated);
  }
  return res.json() as Promise<T>;
}

/** True when `error` is an HTTP error with the given status (works for both clients). */
export function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === status
  );
}
