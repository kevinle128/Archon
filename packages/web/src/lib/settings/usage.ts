/**
 * Installation usage/cost report skill.
 *
 * GET /api/usage — direct-run ledger aggregates only (no child rollups, no SSE).
 * Request/response types come from generated OpenAPI operation + schemas;
 * never import @archon/core or workflows.
 */
import { requestJson } from './http';
import type { components, paths } from '@/lib/api.generated';

// ---------------------------------------------------------------------------
// Generated operation / schema anchors
// ---------------------------------------------------------------------------

/** GET /api/usage operation (generated). */
type UsageGetOperation = paths['/api/usage']['get'];

/** Query-string contract for GET /api/usage. */
type GeneratedUsageQuery = NonNullable<UsageGetOperation['parameters']['query']>;

/**
 * 200 response body for GET /api/usage — exactly the non-null UsageReport object.
 * Do not wrap in NonNullable: drift that reintroduces null must fail type-check.
 */
type GeneratedUsageResponse = UsageGetOperation['responses'][200]['content']['application/json'];

/** Nullable direct-run usage on GET workflow run detail (`NullableUsageReport`). */
type GeneratedRunDetailUsage = components['schemas']['WorkflowRunDetail']['usage'];

/** Named non-null UsageReport OpenAPI component (GET /api/usage). */
type GeneratedUsageReportSchema = components['schemas']['UsageReport'];

/** Own nullable wrapper identity used only by run-detail. */
type GeneratedNullableUsageReportSchema = components['schemas']['NullableUsageReport'];

// ---------------------------------------------------------------------------
// Public aliases — derived only from generated contracts (no parallel unions)
// ---------------------------------------------------------------------------

/** GET /api/usage query filters (camelCase). */
export type UsageQuery = GeneratedUsageQuery;

/** Kind filter values accepted by GET /api/usage. */
export type UsageKindFilter = NonNullable<UsageQuery['kind']>;

/** Group-by dimensions accepted by GET /api/usage. */
export type UsageGroupBy = NonNullable<UsageQuery['groupBy']>;

/**
 * Non-null usage report body (ledger aggregates).
 * Derived from the GET /api/usage operation response — not NonNullable(schema).
 */
export type UsageReport = GeneratedUsageResponse;
export type UsageReportGroup = UsageReport['groups'][number];
export type UsageMetrics = UsageReport['totals'];

/** Run-detail usage alias — remains nullable (query failure → null). */
export type RunDetailUsage = GeneratedRunDetailUsage;

// ---------------------------------------------------------------------------
// Compile-time drift guards — fail type-check if OpenAPI and aliases diverge
// ---------------------------------------------------------------------------

// ExactMatch must return `false` (not `never`) on mismatch: `never extends true`
// is true in TypeScript, so a never-based assert would silently accept drift.
type ExactMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

type UsageQueryTiedToOpenApi = AssertTrue<ExactMatch<UsageQuery, GeneratedUsageQuery>>;
type UsageKindTiedToOpenApi = AssertTrue<
  ExactMatch<UsageKindFilter, NonNullable<GeneratedUsageQuery['kind']>>
>;
type UsageGroupByTiedToOpenApi = AssertTrue<
  ExactMatch<UsageGroupBy, NonNullable<GeneratedUsageQuery['groupBy']>>
>;
type UsageGroupByMatchesReport = AssertTrue<ExactMatch<UsageGroupBy, UsageReport['groupBy']>>;
/** GET /api/usage 200 is exactly the non-null report object. */
type UsageReportResponseTiedToOpenApi = AssertTrue<ExactMatch<UsageReport, GeneratedUsageResponse>>;
/** Named UsageReport component is non-null (not contaminated by run-detail). */
type UsageReportSchemaIsNonNull = AssertTrue<ExactMatch<GeneratedUsageReportSchema, UsageReport>>;
/** Run-detail usage is exactly the object or null via its own wrapper identity. */
type RunDetailUsageTiedToOpenApi = AssertTrue<
  ExactMatch<RunDetailUsage, GeneratedNullableUsageReportSchema>
>;
type RunDetailUsageIsNullableReport = AssertTrue<ExactMatch<RunDetailUsage, UsageReport | null>>;
/** Nullable wrapper identity is distinct from the non-null UsageReport component. */
type NullableWrapperDistinctFromUsageReport = AssertTrue<
  ExactMatch<ExactMatch<GeneratedNullableUsageReportSchema, GeneratedUsageReportSchema>, false>
>;

/** Touch asserts so `noUnusedLocals` cannot drop them silently. */
export type UsageOpenApiContractChecks = [
  UsageQueryTiedToOpenApi,
  UsageKindTiedToOpenApi,
  UsageGroupByTiedToOpenApi,
  UsageGroupByMatchesReport,
  UsageReportResponseTiedToOpenApi,
  UsageReportSchemaIsNonNull,
  RunDetailUsageTiedToOpenApi,
  RunDetailUsageIsNullableReport,
  NullableWrapperDistinctFromUsageReport,
];

// ---------------------------------------------------------------------------
// Runtime helpers (behavior unchanged)
// ---------------------------------------------------------------------------

/**
 * Cache-key fragment for every filter/group value the Cost page can set.
 * Empty/undefined values collapse to stable sentinels so keys never collide.
 */
export function usageCacheKey(query: UsageQuery): string {
  const parts = [
    query.from ?? '',
    query.to ?? '',
    query.codebaseId ?? '',
    query.agentProvider ?? '',
    query.provider ?? '',
    query.model ?? '',
    query.kind ?? '',
    query.runId ?? '',
    query.nodeId ?? '',
    query.groupBy ?? 'provider',
  ];
  return `usage:${parts.map(encodeURIComponent).join('|')}`;
}

/** Build GET /api/usage query string from camelCase filters. */
export function buildUsageSearchParams(query: UsageQuery): URLSearchParams {
  const qs = new URLSearchParams();
  if (query.from !== undefined && query.from !== '') qs.set('from', query.from);
  if (query.to !== undefined && query.to !== '') qs.set('to', query.to);
  if (query.codebaseId !== undefined && query.codebaseId !== '') {
    qs.set('codebaseId', query.codebaseId);
  }
  if (query.agentProvider !== undefined && query.agentProvider !== '') {
    qs.set('agentProvider', query.agentProvider);
  }
  if (query.provider !== undefined && query.provider !== '') qs.set('provider', query.provider);
  if (query.model !== undefined && query.model !== '') qs.set('model', query.model);
  if (query.kind !== undefined) qs.set('kind', query.kind);
  if (query.runId !== undefined && query.runId !== '') qs.set('runId', query.runId);
  if (query.nodeId !== undefined && query.nodeId !== '') qs.set('nodeId', query.nodeId);
  if (query.groupBy !== undefined) qs.set('groupBy', query.groupBy);
  return qs;
}

export async function getUsageReport(query: UsageQuery = {}): Promise<GeneratedUsageResponse> {
  const qs = buildUsageSearchParams(query);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  // Return type is the generated operation 200 body (non-null UsageReport).
  // Do not widen/narrow with a hand-written generic that erases nullability drift.
  return requestJson<GeneratedUsageResponse>(`/api/usage${suffix}`);
}

/** UTC calendar-day `YYYY-MM-DD` for an instant. */
export function utcDateOnly(d: Date = new Date()): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First calendar day of the UTC month containing `d`. */
export function utcMonthStart(d: Date = new Date()): string {
  return utcDateOnly(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/**
 * Inclusive UTC calendar-day range → API half-open `[from, to)`.
 * `through` is the last included day; exclusive `to` is midnight after that day.
 *
 * Rejects nonexistent calendar days (e.g. 2026-02-29, 2026-02-30) by proving a
 * UTC component round-trip — never normalize via Date rollover into March.
 */
export function inclusiveUtcRangeToApi(
  fromDay: string,
  throughDay: string
): { from: string; to: string } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(throughDay)) {
    return { error: 'Dates must be YYYY-MM-DD (UTC calendar days).' };
  }
  const fromParts = parseUtcDateOnlyParts(fromDay);
  const throughParts = parseUtcDateOnlyParts(throughDay);
  if (!fromParts || !throughParts) {
    return { error: 'Invalid UTC calendar day.' };
  }
  const fromMs = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
  const throughMs = Date.UTC(throughParts.year, throughParts.month - 1, throughParts.day);
  if (throughMs < fromMs) {
    return { error: 'Through must be on or after From.' };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  // Inclusive span in days; reject when exclusive range would exceed 366 days.
  const inclusiveDays = Math.floor((throughMs - fromMs) / dayMs) + 1;
  if (inclusiveDays > 366) {
    return { error: 'Range cannot exceed 366 days.' };
  }
  const toMs = throughMs + dayMs;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

/**
 * Parse `YYYY-MM-DD` and prove the UTC calendar components round-trip.
 * Returns null for malformed or nonexistent dates (Date would roll over).
 */
function parseUtcDateOnlyParts(day: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayNum = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(dayNum) ||
    month < 1 ||
    month > 12 ||
    dayNum < 1 ||
    dayNum > 31
  ) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, dayNum);
  const probe = new Date(ms);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== dayNum
  ) {
    return null;
  }
  return { year, month, day: dayNum };
}
