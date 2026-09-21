import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';

import { E2E_STARTER_WEB_USER, E2E_TEAMMATE_WEB_USER, HITL_ASK_NODE } from './archon-runtime';

export type IdentityKind = 'starter' | 'teammate' | 'none';

/**
 * Open a run's detail page (`/console/p/:projectId/r/:runId`).
 *
 * The route needs the run's project (codebase) id. That id is data the run
 * itself produced, so we read it back from the REAL run-detail API rather than
 * threading it through the CLI envelope or mocking it — same principle the whole
 * suite follows: the app's own API/DB stay real, only the AI provider is faked.
 */
export async function openRunDetail(
  page: Page,
  runId: string,
  nodeId?: string
): Promise<{ projectId: string }> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const detail = (await res.json()) as { run?: { codebase_id?: string | null } };
  const projectId = detail.run?.codebase_id;
  expect(projectId, `run ${runId} has a project (codebase) id`).toBeTruthy();
  const nodeQuery = nodeId ? `?node=${encodeURIComponent(nodeId)}` : '';
  await page.goto(`/console/p/${projectId ?? ''}/r/${runId}${nodeQuery}`);
  return { projectId: projectId ?? '' };
}

export async function openLegacyRunDetail(page: Page, runId: string): Promise<void> {
  await page.goto(`/legacy/workflows/runs/${encodeURIComponent(runId)}`);
}

export async function openNodeRoom(page: Page, nodeId: string): Promise<void> {
  const divider = page.locator(`#node-transition-${nodeId}`);
  await expect(divider).toBeVisible();
  await divider.getByRole('button', { name: new RegExp(nodeId) }).click();
}

/** One node-transcript row as returned by the messages list route. */
export type NodeMessageRow = {
  id: string;
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at?: string;
  operator_display_name?: string | null;
  metadata?: {
    origin?: 'operator';
    operator_user_id?: string | null;
    message_id?: string;
    execution?: {
      occurrence_id?: string;
      attempt_id?: string;
      retry_epoch?: number;
      loop_ancestry?: { node_id: string; iteration: number }[];
      route_activation_seq?: number;
    };
  } | null;
};

export async function listNodeMessages(
  page: Page,
  runId: string,
  nodeId: string
): Promise<NodeMessageRow[]> {
  const res = await page.request.get(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/messages`
  );
  expect(res.ok(), `node messages for ${nodeId} responded ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { messages?: NodeMessageRow[] };
  return body.messages ?? [];
}

export interface NodeMessageRequest {
  afterSeq: string | null;
  limit: string | null;
  occurrenceId: string | null;
  attemptId: string | null;
}

export function observeNodeMessagePages(
  page: Page,
  runId: string,
  nodeId: string
): { records: NodeMessageRequest[]; dispose: () => void } {
  const records: NodeMessageRequest[] = [];
  const pathname =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages';
  const listener = (request: Request): void => {
    const url = new URL(request.url());
    if (url.pathname !== pathname) return;
    records.push({
      afterSeq: url.searchParams.get('afterSeq'),
      limit: url.searchParams.get('limit'),
      occurrenceId: url.searchParams.get('occurrenceId'),
      attemptId: url.searchParams.get('attemptId'),
    });
  };
  page.on('request', listener);
  return {
    records,
    dispose: (): void => {
      page.off('request', listener);
    },
  };
}

export async function getRunDetail(
  page: Page,
  runId: string
): Promise<{
  status?: string;
  user_id?: string | null;
  viewer_is_starter?: boolean;
  parent_platform_id?: string;
  pending_interactions: {
    tool_use_id: string;
    status: string;
    node_id: string;
    answer?: unknown;
  }[];
  nodeExecutions: {
    node_id: string;
    status?: string;
    error?: string | null;
    retry_epoch?: number;
    started_at?: string | null;
    ended_at?: string | null;
    occurrence_id?: string;
    attempt_id?: string;
    loop_ancestry?: { node_id: string; iteration: number }[];
  }[];
  events: {
    event_type: string;
    step_name: string | null;
    data: Record<string, unknown>;
  }[];
}> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    viewer_is_starter?: boolean;
    run?: {
      status?: string;
      user_id?: string | null;
      parent_platform_id?: string;
    };
    pending_interactions?: {
      tool_use_id: string;
      status: string;
      node_id: string;
      answer?: unknown;
    }[];
    nodeExecutions?: {
      node_id: string;
      status?: string;
      error?: string | null;
      retry_epoch?: number;
      started_at?: string | null;
      ended_at?: string | null;
      occurrence_id?: string;
      attempt_id?: string;
      loop_ancestry?: { node_id: string; iteration: number }[];
    }[];
    events?: {
      event_type: string;
      step_name: string | null;
      data: Record<string, unknown>;
    }[];
  };
  return {
    status: body.run?.status,
    user_id: body.run?.user_id,
    viewer_is_starter: body.viewer_is_starter,
    parent_platform_id: body.run?.parent_platform_id,
    pending_interactions: body.pending_interactions ?? [],
    nodeExecutions: body.nodeExecutions ?? [],
    events: body.events ?? [],
  };
}

export async function createIdentityContext(
  browser: Browser,
  baseURL: string,
  kind: IdentityKind
): Promise<BrowserContext> {
  if (kind === 'none') {
    return browser.newContext({ baseURL });
  }
  const header = kind === 'starter' ? E2E_STARTER_WEB_USER : E2E_TEAMMATE_WEB_USER;
  return browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-Archon-User': header },
  });
}

export async function submitAskYes(
  page: Page,
  card: Locator,
  runId: string,
  requestId: string
): Promise<void> {
  const yes = card.getByRole('radio', { name: 'yes', exact: true });
  await expect(yes).toBeEnabled();
  await yes.check();
  const pathname = `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`;
  const responsePromise = page.waitForResponse(
    res => new URL(res.url()).pathname === pathname && res.request().method() === 'POST'
  );
  // Register the response listener before the user action, including fast local responses.
  const [response] = await Promise.all([
    responsePromise,
    card.getByRole('button', { name: 'Submit', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(card.getByText(/Answered/).first()).toBeVisible();
  const detail = await getRunDetail(page, runId);
  const answered = detail.pending_interactions.find(row => row.tool_use_id === requestId);
  expect(answered?.status).toBe('answered');
  expect(answered?.answer).toEqual({ answers: [{ questionId: 'proceed', value: 'yes' }] });
}

export async function postConversationMessage(
  page: Page,
  conversationId: string,
  message: string
): Promise<number> {
  const res = await page.request.post(
    `/api/conversations/${encodeURIComponent(conversationId)}/message`,
    { data: { message } }
  );
  return res.status();
}

export async function answerAskViaApi(
  page: Page,
  runId: string,
  requestId: string
): Promise<number> {
  const res = await page.request.post(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      data: { answers: [{ questionId: 'proceed', value: 'yes' }] },
    }
  );
  return res.status();
}

export { HITL_ASK_NODE };
