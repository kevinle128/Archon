/**
 * Tests for workflow commands
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock, jest } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';
import {
  makeTestComposedWorkflow,
  makeTestWorkflow,
  makeTestWorkflowWithSource,
} from '@archon/workflows/test-utils';
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import {
  workflowListCommand,
  workflowRunCommand,
  workflowStatusCommand,
  workflowGetCommand,
  workflowRunsCommand,
  workflowResumeCommand,
  workflowAbandonCommand,
  workflowApproveCommand,
  workflowReviewOpenCommand,
  workflowRejectCommand,
  workflowCleanupCommand,
  workflowResetSessionsCommand,
  buildDetachedRunCmd,
  mapWorkflowRunToContractState,
  classifyRunError,
  maybePrintTierNotice,
  resolveContainerBackendConfig,
  hasUnresolvedWriteback,
  buildNodeSummaries,
} from './workflow';
import type { WorkflowRunOptions } from './workflow';

const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(() => mockLogger),
};

// Mock @archon/paths (createLogger moved here from @archon/core)
mock.module('@archon/paths', () => ({
  captureApprovalResolved: () => undefined,
  createLogger: mock(() => mockLogger),
  getArchonHome: mock(() => '/home/test/.archon'),
  BUNDLED_IS_BINARY: false,
}));

// Mock node:fs — existsSync returns true so resume JSON tests don't fail on
// non-existent working_path directories (R1-F29). Other functions pass through
// to the real implementations where needed.
const actualFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...actualFs,
  existsSync: mock(() => true),
  statSync: mock(() => ({ isDirectory: () => true })),
}));

// Mock @archon/isolation (getIsolationProvider moved here from @archon/core)
mock.module('@archon/isolation', () => ({
  configureIsolation: mock(() => undefined),
  getIsolationProvider: mock(() => ({
    create: mock(() =>
      Promise.resolve({
        provider: 'worktree',
        id: '/test/path',
        workingPath: '/test/path',
        branchName: 'test-branch',
        status: 'active',
        createdAt: new Date(),
        metadata: { adopted: false },
      })
    ),
    healthCheck: mock(() => Promise.resolve(true)),
  })),
}));

// Mock the @archon/core modules
mock.module('@archon/core', () => ({
  registerRepository: mock(() =>
    Promise.resolve({
      codebaseId: 'cb-auto',
      name: 'test/repo',
      repositoryUrl: null,
      defaultCwd: '/test/path',
      commandCount: 0,
      alreadyExisted: false,
    })
  ),
  registerFolder: mock(() =>
    Promise.resolve({
      codebaseId: 'cb-folder',
      name: 'platform',
      repositoryUrl: null,
      defaultCwd: '/test/path',
      defaultBranch: null,
      commandCount: 0,
      alreadyExisted: false,
    })
  ),
  loadConfig: mock(() => Promise.resolve({ defaults: {} })),
  generateAndSetTitle: mock(() => Promise.resolve()),
  loadRepoConfig: mock(() => Promise.resolve(null)),
  createWorkflowStore: mock(() => ({
    createWorkflowEvent: mock(() => Promise.resolve()),
  })),
  // requires: [github] gate. Default to a solo-install posture (disabled) so the
  // gate is a no-op for every existing test; the gate-specific tests below flip
  // isPerUserGitHubEnabled on per-invocation.
  isPerUserGitHubEnabled: mock(() => false),
  getDecryptedAccessToken: mock(() => Promise.resolve(null)),
}));

mock.module('@archon/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mock(() => Promise.resolve({ id: 'user-cli-1' })),
}));

mock.module('@archon/workflows/workflow-discovery', () => ({
  discoverWorkflowsWithConfig: mock(() => Promise.resolve({ workflows: [], errors: [] })),
}));
mock.module('@archon/workflows/executor', () => ({
  executeWorkflow: mock(() => Promise.resolve({ success: true, workflowRunId: 'test-run-id' })),
  hydrateResumableRun: mock(() => Promise.resolve(null)),
}));
mock.module('@archon/workflows/dry-run', () => ({
  loadDryRunStubs: mock(() => Promise.resolve({ node: 'stubbed output' })),
  dryRunWorkflow: mock(() =>
    Promise.resolve({
      workflow: 'plan',
      outcome: 'completed',
      trace: [
        {
          nodeId: 'node',
          nodeType: 'command',
          state: 'stubbed',
          resolvedText: 'command:test-command',
          output: 'stubbed output',
        },
      ],
      missingStubs: [],
      unusedStubs: [],
      summary: 'stubbed output',
    })
  ),
  formatDryRunTrace: mock(() => 'DRY RUN TRACE'),
}));

// Capture the subscription handler so tests can trigger events
let capturedSubscribeHandler: ((event: WorkflowEmitterEvent) => void) | null = null;
const mockUnsubscribe = mock(() => undefined);

mock.module('@archon/workflows/event-emitter', () => ({
  getWorkflowEventEmitter: mock(() => ({
    subscribeForConversation: mock(
      (_convId: string, handler: (event: WorkflowEmitterEvent) => void) => {
        capturedSubscribeHandler = handler;
        return mockUnsubscribe;
      }
    ),
  })),
}));

mock.module('@archon/git', () => ({
  fileAt: mock(async () => ({
    path: 'x.ts',
    bytes: new Uint8Array(),
    binary: false,
    contentHash: '0'.repeat(64),
  })),
  fileDiff: mock(async () => ({
    path: 'x.ts',
    status: 'M' as const,
    scope: 'now' as const,
    ref: 'live' as const,
    hunks: [],
    cursor: '' as const,
    truncated: false as const,
    binary: false,
  })),
  findRepoRoot: mock(() => Promise.resolve(null)),
  syncWorkspace: mock(() => Promise.resolve({})),
  getRemoteUrl: mock(() => Promise.resolve(null)),
  checkout: mock(() => Promise.resolve()),
  toRepoPath: mock((path: string) => path),
  toWorktreePath: mock((path: string) => path),
  toBranchName: mock((branch: string) => branch),
  getDefaultBranch: mock(() => Promise.resolve('dev')),
  isAncestorOf: mock(() => Promise.resolve(true)),
  execFileAsync: mock(() => Promise.resolve({ stdout: '.git\n', stderr: '' })),
  changedFiles: mock(async () => ({ files: [], revision: '0'.repeat(64) })),
  isGitWorkTree: mock(async () => false),
  log: mock(async () => ({ commits: [], revision: '0'.repeat(64), truncated: false })),
}));

mock.module('@archon/core/db/conversations', () => ({
  getOrCreateConversation: mock(() =>
    Promise.resolve({ id: 'conv-123', platform_type: 'cli', platform_conversation_id: 'cli-123' })
  ),
  getConversationById: mock(() => Promise.resolve(null)),
  updateConversation: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/codebases', () => ({
  findCodebaseByDefaultCwd: mock(() => Promise.resolve(null)),
  findCodebaseByPathPrefix: mock(() => Promise.resolve(null)),
  getCodebase: mock(() =>
    Promise.resolve({
      id: 'cb-default',
      name: 'test/repo',
      repository_url: null,
      default_cwd: '/tmp/repo',
      commands: {},
    })
  ),
}));

mock.module('@archon/core/db/isolation-environments', () => ({
  findActiveByWorkflow: mock(() => Promise.resolve(null)),
  create: mock(() => Promise.resolve({ id: 'iso-123' })),
  // Reached only by the --resume path. mock.module() MERGES over the real
  // module, so omitting this would leave the REAL implementation in place and
  // open a live SQLite handle rather than failing loudly (#2240).
  listByCodebase: mock(() => Promise.resolve([])),
}));

// resumeWorkflow lists pending Ask rows. Omitting this mock leaves the real
// SQLite helper in place ("unable to open database file").
mock.module('@archon/core/db/workflow-pending-interactions', () => ({
  listPendingInteractions: mock(() => Promise.resolve([])),
  resolvePendingInteraction: mock(() =>
    Promise.resolve({
      interaction: {
        id: 'pending-1',
        workflow_run_id: 'run-1',
        node_id: 'ask',
        tool_use_id: 'tool-1',
        kind: 'ask',
        status: 'answered',
      },
      resumed: false,
      remaining_pending: 0,
    })
  ),
  confirmPendingPermission: mock(() =>
    Promise.resolve({
      interaction: {
        id: 'pending-permission',
        workflow_run_id: 'run-permission',
        node_id: 'permission-node',
        tool_use_id: 'tool-permission',
        kind: 'permission' as const,
        status: 'answered' as const,
        envelope: {},
        answer: { intent: 'allow-once' },
        provider_session_id: 'session-permission',
        created_at: new Date('2026-09-07T00:00:00.000Z'),
        resolved_at: new Date('2026-09-07T00:00:01.000Z'),
        resolved_by: 'user-permission',
      },
      resumed: false,
      remaining_pending: 1,
    })
  ),
}));

mock.module('@archon/core/db/messages', () => ({
  addMessage: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/workflows', () => ({
  getActiveWorkflowRun: mock(() => Promise.resolve(null)),
  getWorkflowRunStatus: mock(() => Promise.resolve(null)),
  failWorkflowRun: mock(() => Promise.resolve()),
  cancelWorkflowRun: mock(() => Promise.resolve({ cancelled: true })),
  cancelRecoveryWorkflowRun: mock(() => Promise.resolve({ cancelled: true })),
  findChildRuns: mock(() => Promise.resolve([])),
  findResumableRun: mock(() => Promise.resolve(null)),
  resumeWorkflowRun: mock(() => Promise.resolve(null)),
  getWorkflowRun: mock(() => Promise.resolve(null)),
  findWorkflowRunsByIdPrefix: mock(() => Promise.resolve([])),
  updateWorkflowRun: mock(() => Promise.resolve()),
  // CAS gate resolvers (#2113) — approve/reject stamp the resolution here;
  // resolveAndCancelApprovalGate atomically resolves+cancels terminal rejects.
  resolveApprovalGate: mock(() => Promise.resolve({ resolved: true })),
  resolveAndCancelApprovalGate: mock(() => Promise.resolve({ resolved: true })),
  transitionPlannotatorGate: mock(() =>
    Promise.resolve({ outcome: 'updated' as const, approval: {} })
  ),
  listWorkflowRuns: mock(() => Promise.resolve([])),
  listDashboardRuns: mock(() =>
    Promise.resolve({
      runs: [],
      total: 0,
      counts: { all: 0, running: 0, completed: 0, failed: 0, cancelled: 0, pending: 0, paused: 0 },
    })
  ),
  deleteOldWorkflowRuns: mock(() => Promise.resolve({ count: 0 })),
}));

mock.module('@archon/core/db/workflow-events', () => ({
  listWorkflowEvents: mock(() => Promise.resolve([])),
  createWorkflowEvent: mock(() => Promise.resolve()),
}));

mock.module('@archon/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mock(() => Promise.resolve({ id: 'user-123' })),
}));

// Reset-sessions runs the real resetWorkflowNodeSessions operation over this mocked
// DB layer (same pattern as the other workflow commands in this file). Safe from
// mock.module pollution: workflow.test.ts is its own isolated `bun test` invocation.
const mockDeleteNodeSessions = mock(() => Promise.resolve({ deleted: 0 }));
mock.module('@archon/core/db/workflow-node-sessions', () => ({
  deleteWorkflowNodeSessions: mockDeleteNodeSessions,
  getWorkflowNodeSession: mock(() => Promise.resolve(null)),
  upsertWorkflowNodeSession: mock(() => Promise.resolve()),
}));

const mockChildProcessSpawn = mock(() => ({
  pid: 99999,
  on: mock(() => undefined),
  unref: mock(() => undefined),
}));
mock.module('node:child_process', () => ({
  spawn: mockChildProcessSpawn,
}));
/**
 * Capture machine-readable (`--json`) payloads.
 *
 * They are emitted through `writeJsonLine()` (src/utils/stdout.ts) — i.e.
 * `process.stdout.write` with a completion callback — rather than `console.log`,
 * so a piped consumer can never receive a truncated document (#2384).
 *
 * This helper only CAPTURES what a command emitted. That the bytes actually
 * survive a real pipe is proven end-to-end in src/utils/stdout.test.ts, which
 * spawns the CLI through a genuine shell pipeline — deliberately not here,
 * because a test that mocks `process.stdout.write` cannot observe the truncation
 * this fix is about.
 */
function spyOnJsonStdout(): ReturnType<typeof spyOn> {
  return spyOn(process.stdout, 'write').mockImplementation((...args: unknown[]) => {
    const callback = args.find(arg => typeof arg === 'function');
    if (typeof callback === 'function') (callback as () => void)();
    return true;
  });
}

/** The first `--json` document a command wrote, trailing newline stripped. */
function firstJsonPayload(spy: ReturnType<typeof spyOn>): string {
  return ((spy.mock.calls[0]?.[0] as string) ?? '').trimEnd();
}

describe('workflowListCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('should display message when no workflows found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Discovering workflows'));
    expect(consoleSpy).toHaveBeenCalledWith('\nNo workflows found.');
  });

  it('should list workflows with names and descriptions', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance workflow' }),
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Create implementation plan',
          provider: 'claude',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 workflow(s)'));
    expect(consoleSpy).toHaveBeenCalledWith('  assist');
    expect(consoleSpy).toHaveBeenCalledWith('    General assistance workflow');
    expect(consoleSpy).toHaveBeenCalledWith('  plan');
    expect(consoleSpy).toHaveBeenCalledWith('    Create implementation plan');
    expect(consoleSpy).toHaveBeenCalledWith('    Provider: claude');
  });

  it('should output JSON when json flag is true', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance workflow' }),
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Create implementation plan',
          provider: 'claude',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = firstJsonPayload(stdoutSpy);
    const parsed = JSON.parse(output) as { workflows: unknown[]; errors: unknown[] };
    expect(parsed.workflows).toHaveLength(2);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflows[0]).toEqual({
      name: 'assist',
      description: 'General assistance workflow',
    });
    expect(parsed.workflows[1]).toEqual({
      name: 'plan',
      description: 'Create implementation plan',
      provider: 'claude',
    });
  });

  it('should include errors in JSON output', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [{ filename: 'bad.yaml', error: 'Invalid YAML', errorType: 'parse_error' }],
    });

    await workflowListCommand('/test/path', true);

    const output = firstJsonPayload(stdoutSpy);
    const parsed = JSON.parse(output) as {
      workflows: unknown[];
      errors: Array<{ filename: string; error: string; errorType: string }>;
    };
    expect(parsed.workflows).toHaveLength(0);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toEqual({
      filename: 'bad.yaml',
      error: 'Invalid YAML',
      errorType: 'parse_error',
    });
  });

  it('should not print header text in JSON mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    // Exactly one JSON document written, and no "Discovering workflows" header
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = firstJsonPayload(stdoutSpy);
    expect(output).not.toContain('Discovering workflows');
    // Output must be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should include effort and webSearchMode in JSON output when present', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'plan',
          description: 'Planning workflow',
          provider: 'codex',
          model: 'gpt-6-sol',
          // #2556: `effort:` is the one spelling. The deprecated field is
          // translated into it at load, so it can never reach this surface.
          effort: 'xhigh',
          webSearchMode: 'live',
        }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    const output = firstJsonPayload(stdoutSpy);
    const parsed = JSON.parse(output) as {
      workflows: Array<Record<string, string>>;
      errors: unknown[];
    };
    expect(parsed.workflows[0]).toEqual({
      name: 'plan',
      description: 'Planning workflow',
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'xhigh',
      webSearchMode: 'live',
    });
  });

  it('should produce text output when json flag is false', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'General assistance' }),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', false);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Discovering workflows'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 workflow(s)'));
  });

  it('calls discoverWorkflowsWithConfig with (cwd, loadConfig) — home scope is internal', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await workflowListCommand('/test/path');

    // After the globalSearchPath refactor, discovery reads ~/.archon/workflows/
    // on every call with no option — every caller inherits home-scope for free.
    expect(discoverWorkflowsWithConfig).toHaveBeenCalledWith('/test/path', expect.any(Function));
  });

  it('should throw error when discoverWorkflows fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Permission denied')
    );

    await expect(workflowListCommand('/test/path')).rejects.toThrow(
      'Error loading workflows: Permission denied'
    );
  });

  // #2213 — a key the engine drops has to reach the author on the surface they
  // use, not only in `archon validate workflows` (which nothing requires them
  // to run).
  it('prints parse warnings inline with the workflow that raised them', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'clean' }, 'project'),
        makeTestWorkflowWithSource({ name: 'gated' }, 'project', [
          "Node 'plan': unknown key 'interactive' will be ignored.",
        ]),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path');

    expect(consoleSpy).toHaveBeenCalledWith(
      "    Warning: Node 'plan': unknown key 'interactive' will be ignored."
    );
  });

  it('carries parse warnings in --json output', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'clean' }, 'project'),
        makeTestWorkflowWithSource({ name: 'gated' }, 'project', ["dropped 'interactive'"]),
      ],
      errors: [],
    });

    await workflowListCommand('/test/path', true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      workflows: { name: string; parseWarnings?: string[] }[];
    };
    // Absent (not an empty array) on a clean workflow, so the field's presence
    // alone is the signal.
    expect(parsed.workflows[0].parseWarnings).toBeUndefined();
    expect(parsed.workflows[1].parseWarnings).toEqual(["dropped 'interactive'"]);
  });
});

describe('workflowRunCommand — dry-run', () => {
  let stdoutSpy: ReturnType<typeof spyOn>;
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    stdoutSpy = spyOnJsonStdout();
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const dryRun = await import('@archon/workflows/dry-run');
    (executeWorkflow as ReturnType<typeof mock>).mockClear();
    (dryRun.loadDryRunStubs as ReturnType<typeof mock>).mockClear();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();
    (dryRun.formatDryRunTrace as ReturnType<typeof mock>).mockClear();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockResolvedValue({
      workflow: 'plan',
      outcome: 'completed',
      trace: [],
      missingStubs: [],
      unusedStubs: [],
      summary: 'done',
    });
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'plan' }, 'project')],
      errors: [],
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('runs the simulator before real-run setup and writes one JSON document', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const dryRun = await import('@archon/workflows/dry-run');

    await workflowRunCommand('/test/path', 'plan', 'hello', {
      dryRun: true,
      stubsPath: 'fixtures.yaml',
      execCode: true,
      pauseAtGates: true,
      json: true,
    });

    expect(dryRun.loadDryRunStubs).toHaveBeenCalledWith(join('/test/path', 'fixtures.yaml'));
    expect(dryRun.dryRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'hello',
        cwd: '/test/path',
        execCode: true,
        pauseAtGates: true,
      })
    );
    expect(executeWorkflow).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(firstJsonPayload(stdoutSpy))).toMatchObject({
      workflow: 'plan',
      outcome: 'completed',
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('writes the human trace through guaranteed stdout delivery', async () => {
    const dryRun = await import('@archon/workflows/dry-run');

    await workflowRunCommand('/test/path', 'plan', '', { dryRun: true });

    expect(dryRun.formatDryRunTrace).toHaveBeenCalled();
    expect(firstJsonPayload(stdoutSpy)).toBe('DRY RUN TRACE');
  });

  it('fails the dry run when the config is unreadable instead of reporting against defaults', async () => {
    // `loadConfig` returns defaults when there is no config file, so a throw means a
    // MALFORMED one. Swallowing it would print a clean-looking trace claiming every node
    // resolves to the default assistant — a plausible report of a run that cannot happen.
    const core = await import('@archon/core');
    const dryRun = await import('@archon/workflows/dry-run');
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();
    (core.loadConfig as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('bad yaml at .archon/config.yaml:7')
    );

    await expect(workflowRunCommand('/test/path', 'plan', 'go', { dryRun: true })).rejects.toThrow(
      /bad yaml/
    );

    expect(dryRun.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it('rejects dry-run-only and incompatible lifecycle flags', async () => {
    await expect(
      workflowRunCommand('/test/path', 'plan', '', { stubsPath: 'fixtures.yaml' })
    ).rejects.toThrow('--stubs requires --dry-run');

    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'plan' }, 'project')],
      errors: [],
    });
    await expect(
      workflowRunCommand('/test/path', 'plan', '', { dryRun: true, detach: true })
    ).rejects.toThrow('--dry-run cannot be combined with --detach');
  });

  it('emits one failure JSON document and returns a nonzero exit code', async () => {
    const dryRun = await import('@archon/workflows/dry-run');
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflow: 'plan',
      outcome: 'failed',
      trace: [],
      missingStubs: ['node'],
      unusedStubs: [],
    });

    expect(await workflowRunCommand('/test/path', 'plan', '', { dryRun: true, json: true })).toBe(
      78
    );
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(firstJsonPayload(stdoutSpy))).toMatchObject({ outcome: 'failed' });
  });
});

describe('workflowRunCommand — requires: [github] gate', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let priorArchonUserId: string | undefined;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    // Deterministic CLI identity (resolveCliUserId reads ARCHON_USER_ID).
    priorArchonUserId = process.env.ARCHON_USER_ID;
    process.env.ARCHON_USER_ID = 'cli-tester';

    const { executeWorkflow } = await import('@archon/workflows/executor');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const usersDb = await import('@archon/core/db/users');
    (executeWorkflow as ReturnType<typeof mock>).mockClear();
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockClear();
    (getDecryptedAccessToken as ReturnType<typeof mock>).mockClear();
    (usersDb.findOrCreateUserByPlatformIdentity as ReturnType<typeof mock>).mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (priorArchonUserId === undefined) delete process.env.ARCHON_USER_ID;
    else process.env.ARCHON_USER_ID = priorArchonUserId;
  });

  it('blocks a requires:[github] workflow before any cost when enabled and not connected', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'ship', requires: ['github'] }, 'project')],
      errors: [],
    });
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);
    (getDecryptedAccessToken as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(
      workflowRunCommand('/repo/root', 'ship', 'go', { noWorktree: true })
    ).rejects.toThrow(/connected github identity/i);

    // Hard-blocked before any worktree/AI cost — executeWorkflow never ran.
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('blocks a parent whose requirement came only from a COMPOSED block', async () => {
    // The parent declares no `requires:` of its own — the requirement unions upward from
    // the block during expansion (#1764). Without that union this refusal never happens
    // and the run fails mid-block instead, inside a file the parent cannot inspect.
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const composed = makeTestComposedWorkflow(
      [
        makeTestWorkflow({
          name: 'gh-block',
          requires: ['github'],
          nodes: [{ id: 'work', prompt: 'work' }],
        }),
        makeTestWorkflow({ name: 'composes-gh', nodes: [{ id: 'sub', include: 'gh-block' }] }),
      ],
      'composes-gh'
    );
    // The union is what the gate reads — assert it before relying on it.
    expect(composed.requires).toEqual(['github']);

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [{ workflow: composed, source: 'project' }],
      errors: [],
    });
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);
    (getDecryptedAccessToken as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(
      workflowRunCommand('/repo/root', 'composes-gh', 'go', { noWorktree: true })
    ).rejects.toThrow(/connected github identity/i);
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('allows the run when the acting CLI user has a connected GitHub identity', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'ship', requires: ['github'] }, 'project')],
      errors: [],
    });
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);
    (getDecryptedAccessToken as ReturnType<typeof mock>).mockResolvedValueOnce('gho_token');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-ok',
    });

    await workflowRunCommand('/repo/root', 'ship', 'go', { noWorktree: true });

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on solo installs (per-user GitHub disabled) even when github is required', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'ship', requires: ['github'] }, 'project')],
      errors: [],
    });
    // Default mock returns false; be explicit for readability.
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(false);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-ok',
    });

    await workflowRunCommand('/repo/root', 'ship', 'go', { noWorktree: true });

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    // Gate short-circuited on the env check — no token lookup happened.
    expect(getDecryptedAccessToken).not.toHaveBeenCalled();
  });

  it('does not resolve GitHub connection for a workflow without requires', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });
    // Even with per-user GitHub enabled, a workflow with no `requires` skips the lookup.
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-ok',
    });

    await workflowRunCommand('/repo/root', 'assist', 'go', { noWorktree: true });

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    expect(getDecryptedAccessToken).not.toHaveBeenCalled();
  });

  it('fails closed when the acting CLI user identity cannot be resolved', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled, getDecryptedAccessToken } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'ship', requires: ['github'] }, 'project')],
      errors: [],
    });
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);

    // No resolvable CLI identity → resolveCliUserId() returns null → treated as
    // "not connected" (fail closed). Clear every identity source for this test.
    const savedUser = process.env.USER;
    const savedUsername = process.env.USERNAME;
    delete process.env.ARCHON_USER_ID;
    delete process.env.USER;
    delete process.env.USERNAME;
    try {
      await expect(
        workflowRunCommand('/repo/root', 'ship', 'go', { noWorktree: true })
      ).rejects.toThrow(/connected github identity/i);
    } finally {
      if (savedUser !== undefined) process.env.USER = savedUser;
      if (savedUsername !== undefined) process.env.USERNAME = savedUsername;
    }

    // Never resolved a token, and never reached execution.
    expect(getDecryptedAccessToken).not.toHaveBeenCalled();
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('fails closed when the identity/token lookup throws', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { isPerUserGitHubEnabled } = await import('@archon/core');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const usersDb = await import('@archon/core/db/users');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'ship', requires: ['github'] }, 'project')],
      errors: [],
    });
    (isPerUserGitHubEnabled as ReturnType<typeof mock>).mockReturnValueOnce(true);
    (usersDb.findOrCreateUserByPlatformIdentity as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('db unavailable')
    );

    // Lookup failure is swallowed inside the gate and defaults to "not connected".
    await expect(
      workflowRunCommand('/repo/root', 'ship', 'go', { noWorktree: true })
    ).rejects.toThrow(/connected github identity/i);

    expect(executeWorkflow).not.toHaveBeenCalled();
  });
});

describe('workflowRunCommand — --input declared inputs (#2554)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  /** Stub discovery with one workflow declaring a required + a defaulted input. */
  async function stubInputWorkflow(): Promise<void> {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource(
          {
            name: 'review-block',
            inputs: { diff: { required: true }, style: { default: 'strict' } },
          },
          'project'
        ),
      ],
      errors: [],
    });
  }

  it('runs a required-input workflow when --input supplies the value', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    await stubInputWorkflow();
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-ok',
    });

    await workflowRunCommand('/repo/root', 'review-block', 'go', {
      noWorktree: true,
      inputs: ['diff=D1'],
    });

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    // Only the supplied value is threaded through; `style` stays a derived default.
    const opts = (executeWorkflow as ReturnType<typeof mock>).mock.calls[0][7] as {
      inputs?: Record<string, string>;
    };
    expect(opts.inputs).toEqual({ diff: 'D1' });
  });

  it('still refuses a required-input workflow when nothing is supplied, before any cost', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    await stubInputWorkflow();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', { noWorktree: true })
    ).rejects.toThrow(/requires input 'diff'/);

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('rejects an undeclared --input name before any cost', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    await stubInputWorkflow();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', {
        noWorktree: true,
        inputs: ['diff=D1', 'stlye=terse'],
      })
    ).rejects.toThrow(/does not declare input 'stlye'/);

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a malformed --input assignment before any cost', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    await stubInputWorkflow();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', {
        noWorktree: true,
        inputs: ['diff'],
      })
    ).rejects.toThrow(/expected 'name=value'/);

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it('passes gate-resolved inputs to dryRunWorkflow (#2610)', async () => {
    // Only the SUPPLIED entries travel: the simulator derives declared defaults
    // itself, mirroring the executor's `defaultRunInputs` merge at run start.
    const dryRun = await import('@archon/workflows/dry-run');
    await stubInputWorkflow();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/repo/root', 'review-block', 'go', {
      dryRun: true,
      inputs: ['diff=D1'],
    });

    expect(dryRun.dryRunWorkflow).toHaveBeenCalledTimes(1);
    const opts = (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mock.calls[0][0] as {
      inputs?: Record<string, string>;
    };
    expect(opts.inputs).toEqual({ diff: 'D1' });
  });

  it('fails a dry run of a required-input workflow at the gate, like a real run', async () => {
    const dryRun = await import('@archon/workflows/dry-run');
    await stubInputWorkflow();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', { dryRun: true })
    ).rejects.toThrow(/requires input 'diff'/);

    expect(dryRun.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it('reports the incompatible flag, not an input error, for --dry-run --resume --input', async () => {
    // The incompatible-flags check must stay ahead of the input gate: with --input no
    // longer in that list, only ordering keeps the triple reporting the flag conflict.
    const dryRun = await import('@archon/workflows/dry-run');
    await stubInputWorkflow();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', {
        dryRun: true,
        resume: true,
        inputs: ['diff=D1'],
      })
    ).rejects.toThrow(/--dry-run cannot be combined with --resume/);

    expect(dryRun.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it('rejects an undeclared --input name on a dry run at the gate', async () => {
    const dryRun = await import('@archon/workflows/dry-run');
    await stubInputWorkflow();
    (dryRun.dryRunWorkflow as ReturnType<typeof mock>).mockClear();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', {
        dryRun: true,
        inputs: ['diff=D1', 'stlye=terse'],
      })
    ).rejects.toThrow(/does not declare input 'stlye'/);

    expect(dryRun.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it('does not re-gate a --resume of a required-input workflow', async () => {
    // The gate is deliberately skipped on resume: the run row already carries inputs
    // validated at creation, and a resume supplies nothing. A refactor that hoists
    // `resolveTopLevelInputs` out of the `if (!options.resume)` guard would make every
    // CLI resume of a required-input workflow throw instead — this is what catches it.
    // (The `--input` + `--resume` test below cannot: it fails on the mutual-exclusion
    // check before ever reaching the gate.)
    const { executeWorkflow, hydrateResumableRun } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDb = await import('@archon/core/db/workflows');
    await stubInputWorkflow();

    (hydrateResumableRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      preCreatedRun: { id: 'run-prior', workflow_name: 'review-block' },
      priorCompletedNodes: new Map([['node-a', 'done']]),
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-resume',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-resume',
      default_cwd: '/repo/root',
      default_branch: 'develop',
    });
    // working_path null keeps the resume on the caller cwd, skipping the existsSync probe.
    (workflowDb.findResumableRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-prior',
      working_path: null,
      workflow_name: 'review-block',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-prior',
    });

    // No --input, and the workflow declares a required one: this must NOT throw.
    await workflowRunCommand('/repo/root', 'review-block', 'go', { resume: true });

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    // The resume branch carries the row's own inputs; it never re-stamps from a flag.
    const opts = (executeWorkflow as ReturnType<typeof mock>).mock.calls[0][7] as {
      inputs?: Record<string, string>;
    };
    expect(opts.inputs).toBeUndefined();
  });

  it('rejects --input combined with --resume rather than silently ignoring it', async () => {
    const { executeWorkflow } = await import('@archon/workflows/executor');
    // Flag validation runs after name resolution (as every other flag check does),
    // so discovery still has to resolve for the conflict to be reached.
    await stubInputWorkflow();

    await expect(
      workflowRunCommand('/repo/root', 'review-block', 'go', {
        resume: true,
        inputs: ['diff=D1'],
      })
    ).rejects.toThrow(/--resume and --input are mutually exclusive/);

    expect(executeWorkflow).not.toHaveBeenCalled();
  });
});

describe('workflowRunCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    // Clear workflow discovery mock to prevent leaks from previous tests
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockClear();
    const git = await import('@archon/git');
    (git.findRepoRoot as ReturnType<typeof mock>).mockClear();
    (git.findRepoRoot as ReturnType<typeof mock>).mockResolvedValue(null);
    (git.syncWorkspace as ReturnType<typeof mock>).mockClear();
    (git.syncWorkspace as ReturnType<typeof mock>).mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw error when no workflows found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'No workflows found in .archon/workflows/'
    );
  });

  it('syncs an isolated Git workspace before discovering its workflow', async () => {
    const git = await import('@archon/git');
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const calls: string[] = [];
    (git.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce('/repo/source');
    (git.syncWorkspace as ReturnType<typeof mock>).mockImplementationOnce(() => {
      calls.push('sync');
      return Promise.resolve({});
    });
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockImplementationOnce(() => {
      calls.push('discover');
      return Promise.resolve({ workflows: [], errors: [] });
    });

    await expect(workflowRunCommand('/repo/source', 'assist', 'hello')).rejects.toThrow(
      'No workflows found in .archon/workflows/'
    );

    expect(calls).toEqual(['sync', 'discover']);
    expect(git.syncWorkspace).toHaveBeenCalledWith('/repo/source');
  });

  it('continues CLI discovery when the pre-discovery sync fails', async () => {
    const git = await import('@archon/git');
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (git.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce('/repo/source');
    (git.syncWorkspace as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('network unavailable')
    );
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await expect(workflowRunCommand('/repo/source', 'assist', 'hello')).rejects.toThrow(
      'No workflows found in .archon/workflows/'
    );

    expect(discoverWorkflowsWithConfig).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/source' }),
      'cli.workflow_discovery_sync_failed'
    );
  });

  it('does not synchronize explicit live workflow runs', async () => {
    const git = await import('@archon/git');
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await expect(
      workflowRunCommand('/repo/source', 'assist', 'hello', { noWorktree: true })
    ).rejects.toThrow('No workflows found in .archon/workflows/');

    expect(git.findRepoRoot).not.toHaveBeenCalled();
    expect(git.syncWorkspace).not.toHaveBeenCalled();
  });

  it('does not synchronize folder workflow runs', async () => {
    const git = await import('@archon/git');
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [],
      errors: [],
    });

    await expect(
      workflowRunCommand('/folder/project', 'assist', 'hello', { folder: true })
    ).rejects.toThrow('No workflows found in .archon/workflows/');

    expect(git.findRepoRoot).not.toHaveBeenCalled();
    expect(git.syncWorkspace).not.toHaveBeenCalled();
  });

  it('logs effective discovery root and source breakdown for every run', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist' }, 'bundled'),
        makeTestWorkflowWithSource({ name: 'home-helper' }, 'global'),
        makeTestWorkflowWithSource({ name: 'project-flow' }, 'project'),
      ],
      errors: [],
    });

    await workflowRunCommand('/repo/root', 'assist', 'hello', { noWorktree: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Discovery: root=/repo/root workflows=3 bundled=1 global=1 project=1'
    );
  });

  it('uses discoveryCwd in the discovery diagnostic when supplied', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    await workflowRunCommand('/tmp/worktree', 'assist', 'hello', {
      noWorktree: true,
      discoveryCwd: '/repo/source',
    });

    expect(discoverWorkflowsWithConfig).toHaveBeenCalledWith('/repo/source', expect.any(Function));
    expect(consoleSpy).toHaveBeenCalledWith(
      'Discovery: root=/repo/source workflows=1 bundled=0 global=0 project=1'
    );
  });

  it('does not print discovery diagnostic in json mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    try {
      await workflowRunCommand('/repo/root', 'assist', 'hello', {
        json: true,
        noWorktree: true,
      });
    } catch {
      // Downstream failure is acceptable; this test only verifies diagnostic suppression.
    }

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Discovery: root='));
  });

  // #2213 — `--json` silences Pino entirely (cli.ts sets the level to 'silent'),
  // so stderr is the only channel left. Note this asserts only the CHANNEL
  // (console.warn, not console.log); the JSON payload itself goes through
  // `writeJsonLine` on the `--detach` branch, covered in the detach describe.
  it('warns on stderr about keys the engine drops, even in json mode', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [
          makeTestWorkflowWithSource({ name: 'assist' }, 'project', [
            "Node 'plan': unknown key 'interactive' will be ignored.",
          ]),
        ],
        errors: [],
      });

      try {
        await workflowRunCommand('/repo/root', 'assist', 'hello', {
          json: true,
          noWorktree: true,
        });
      } catch {
        // Downstream failure is acceptable; this test only checks the warning.
      }

      expect(warnSpy).toHaveBeenCalledWith("Warning: 'assist' declares keys the engine ignores:");
      expect(warnSpy).toHaveBeenCalledWith(
        "  - Node 'plan': unknown key 'interactive' will be ignored."
      );
      // Never on stdout — a --json caller must still get a parseable payload.
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('unknown key'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stays silent when the resolved workflow has no parse warnings', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [
          makeTestWorkflowWithSource({ name: 'assist' }, 'project'),
          // A DIFFERENT workflow's warnings must not leak into this run.
          makeTestWorkflowWithSource({ name: 'other' }, 'project', ["dropped 'interactive'"]),
        ],
        errors: [],
      });

      await workflowRunCommand('/repo/root', 'assist', 'hello', { noWorktree: true });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('the engine ignores'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not print discovery diagnostic in quiet mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist' }, 'project')],
      errors: [],
    });

    try {
      await workflowRunCommand('/repo/root', 'assist', 'hello', {
        quiet: true,
        noWorktree: true,
      });
    } catch {
      // Downstream failure is acceptable; this test only verifies diagnostic suppression.
    }

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Discovery: root='));
  });

  it('should throw error when workflow not found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'plan', description: 'Plan' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'nonexistent', 'hello')).rejects.toThrow(
      "Workflow 'nonexistent' not found"
    );
  });

  it('should include available workflows in error when workflow not found', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'plan', description: 'Plan' }),
      ],
      errors: [],
    });

    try {
      await workflowRunCommand('/test/path', 'nonexistent', 'hello');
    } catch (error) {
      const err = error as Error;
      expect(err.message).toContain('Available workflows:');
      expect(err.message).toContain('- assist');
      expect(err.message).toContain('- plan');
    }
  });

  it('should resolve workflow by suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'archon-plan', description: 'Plan' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // Should resolve successfully — "assist" suffix-matches "archon-assist"
    await workflowRunCommand('/test/path', 'assist', 'hello');

    // Verify suffix matching tier was used
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'assist', matched: 'archon-assist' }),
      'workflow.resolve_suffix_match'
    );
  });

  it('should resolve workflow by substring match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-smart-pr-review', description: 'Smart review' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Help' }),
      ],
      errors: [],
    });

    // "smart" substring-matches only "archon-smart-pr-review"
    // Will fail downstream at executeWorkflow mock, but must NOT throw "not found"
    const error = await workflowRunCommand('/test/path', 'smart', 'hello').catch(
      (e: unknown) => e as Error
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('not found');
    expect((error as Error).message).not.toContain('Did you mean');
  });

  it('should prefer case-insensitive exact match over suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Long' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // "ASSIST" case-insensitive matches "assist" at tier 2, should not reach suffix tier
    await workflowRunCommand('/test/path', 'ASSIST', 'hello');

    // Verify case-insensitive match was used, not suffix match
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'ASSIST', matched: 'assist' }),
      'workflow.resolve_case_insensitive_match'
    );
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      'workflow.resolve_suffix_match'
    );
  });

  it('should throw ambiguous error for multiple suffix matches', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'archon-review', description: 'Review' }),
        makeTestWorkflowWithSource({ name: 'custom-review', description: 'Custom review' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'review', 'hello')).rejects.toThrow(
      "Ambiguous workflow 'review'. Did you mean:"
    );
  });

  it('should throw ambiguous error for multiple substring matches', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'archon-comprehensive-pr-review',
          description: 'Full review',
        }),
        makeTestWorkflowWithSource({ name: 'archon-smart-pr-review', description: 'Smart review' }),
      ],
      errors: [],
    });

    await expect(workflowRunCommand('/test/path', 'pr-review', 'hello')).rejects.toThrow(
      "Ambiguous workflow 'pr-review'. Did you mean:"
    );
  });

  it('should prefer exact match over suffix match', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Short name' }),
        makeTestWorkflowWithSource({ name: 'archon-assist', description: 'Long name' }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });

    // "assist" exact-matches "assist", should NOT go to suffix matching
    await workflowRunCommand('/test/path', 'assist', 'hello');

    // Should not have logged suffix/substring match — exact match takes priority
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'assist' }),
      'workflow_run_suffix_match'
    );
  });

  it('should throw error when database access fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Connection refused')
    );

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'Failed to access database: Connection refused'
    );
  });

  it('should throw when codebase lookup fails (isolation is default)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );

    await expect(workflowRunCommand('/test/path', 'assist', 'hello')).rejects.toThrow(
      'Cannot create worktree: database lookup failed'
    );
  });

  it('should continue when codebase lookup fails with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // With --no-worktree, DB failure is non-fatal — user explicitly opted out of isolation
    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/test/path' }),
      'cli.codebase_lookup_failed'
    );
  });

  it('should throw error when workflow execution fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      error: 'Step failed: assist',
    });

    // Use --no-worktree since no codebase is available (isolation would error)
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).rejects.toThrow('Workflow failed: Step failed: assist');
  });

  it('should call generateAndSetTitle with workflow name and user message', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const core = await import('@archon/core');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
      ai_assistant_type: 'claude',
    });
    // Return a codebase so isolation can proceed (default behavior requires isolation)
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });
    (core.generateAndSetTitle as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello world');

    expect(core.generateAndSetTitle).toHaveBeenCalledWith(
      'conv-123',
      'hello world',
      'claude',
      '/test/path',
      'assist',
      {}
    );
  });

  it('uses the workflow provider for title generation', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const core = await import('@archon/core');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'figma-mcp-smoke',
          description: 'Smoke test Figma MCP',
          provider: 'codex',
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
      ai_assistant_type: 'claude',
    });
    (core.loadConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      assistant: 'claude',
      assistants: { codex: { model: 'gpt-5.4' } },
      defaults: {},
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });
    (core.generateAndSetTitle as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'figma-mcp-smoke', 'check figma', { noWorktree: true });

    expect(core.generateAndSetTitle).toHaveBeenCalledWith(
      'conv-123',
      'check figma',
      'codex',
      '/test/path',
      'figma-mcp-smoke',
      { model: 'gpt-5.4' }
    );
  });

  it('passes fromBranch into isolation task request', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', {
      branchName: 'test-adapters',
      fromBranch: 'feature/extract-adapters',
    });

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;

    expect(provider?.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'task',
        identifier: 'test-adapters',
        fromBranch: 'feature/extract-adapters',
      })
    );
  });

  it('throws when --branch is used with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Validation throws before codebase lookup — no need to mock findCodebaseByDefaultCwd
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', {
        branchName: 'test-branch',
        noWorktree: true,
      })
    ).rejects.toThrow('--branch and --no-worktree are mutually exclusive');
  });

  it('throws when --from is used with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Validation throws before codebase lookup — no need to mock findCodebaseByDefaultCwd
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', {
        fromBranch: 'dev',
        noWorktree: true,
      })
    ).rejects.toThrow('--from/--from-branch has no effect with --no-worktree');
  });

  // ── Folder projects ──────────────────────────────────────────────────────
  it('registers a folder project and runs in place with --folder', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const core = await import('@archon/core');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    // No codebase found → auto-register as folder (registerFolder mock returns cb-folder)
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'platform',
      default_cwd: '/test/path',
      kind: 'folder',
    });
    const executeSpy = executeWorkflow as ReturnType<typeof mock>;
    const registerSpy = core.registerFolder as ReturnType<typeof mock>;
    const execBefore = executeSpy.mock.calls.length;
    const registerBefore = registerSpy.mock.calls.length;
    executeSpy.mockResolvedValueOnce({ success: true, workflowRunId: 'run-folder' });

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    let printed = '';
    try {
      await workflowRunCommand('/test/path', 'assist', 'do it', { folder: true });
      printed = consoleSpy.mock.calls.map(c => String(c[0])).join('\n');
    } finally {
      consoleSpy.mockRestore();
    }

    // registerFolder was invoked for the non-git cwd
    expect(registerSpy.mock.calls.length).toBe(registerBefore + 1);
    // The run executed in place
    expect(executeSpy.mock.calls.length).toBe(execBefore + 1);
    // The in-place notice was printed
    expect(printed).toContain('running in place');
  });

  it('rejects --branch against a registered folder project', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    // Registered folder project resolved by the main lookup (Once — never leak
    // the folder kind into sibling tests via a persistent mock).
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'platform',
      default_cwd: '/test/path',
      kind: 'folder',
    });

    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'feature-x' })
    ).rejects.toThrow('Worktree options require a git-repo project');
  });

  it('rejects --base against a registered folder project', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'platform',
      default_cwd: '/test/path',
      kind: 'folder',
    });

    // A folder project creates no worktree, so --base cannot drive a cut-from —
    // but it WOULD still reach $BASE_BRANCH. Half-applied is worse than rejected.
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { baseBranch: 'epic/foo' })
    ).rejects.toThrow('Worktree options require a git-repo project');
  });

  it('rejects --folder --branch synchronously (flag-based, before any DB/registration)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    const registerSpy = core.registerFolder as ReturnType<typeof mock>;
    const registerBefore = registerSpy.mock.calls.length;

    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { folder: true, branchName: 'x' })
    ).rejects.toThrow('Worktree options require a git-repo project');
    // The flag-based guard fires before any registration work.
    expect(registerSpy.mock.calls.length).toBe(registerBefore);
  });

  it('rejects a worktree-pinned workflow against a registered folder project', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'assist',
          description: 'Help',
          worktree: { enabled: true },
        }),
      ],
      errors: [],
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'platform',
      default_cwd: '/test/path',
      kind: 'folder',
    });

    await expect(workflowRunCommand('/test/path', 'assist', 'hello', {})).rejects.toThrow(
      'requires a worktree'
    );
  });

  it('creates worktree with auto-generated branch when no --branch given', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');
    const isolationDb = await import('@archon/core/db/isolation-environments');

    // Snapshot call counts before this test (process-global mocks)
    const findActiveCallsBefore = (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mock
      .calls.length;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // No branchName, no noWorktree — should auto-isolate
    await workflowRunCommand('/test/path', 'assist', 'hello', {});

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;

    // provider.create should have been called with an auto-generated identifier
    expect(provider?.create).toHaveBeenCalled();
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      identifier: string;
      workflowType: string;
    };
    expect(lastCreateCall.workflowType).toBe('task');
    expect(lastCreateCall.identifier).toMatch(/^assist-\d+$/);

    // findActiveByWorkflow should NOT have been called during this test (no explicit --branch)
    const findActiveCallsAfter = (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mock
      .calls.length;
    expect(findActiveCallsAfter).toBe(findActiveCallsBefore);
  });

  it('skips isolation when --no-worktree flag is set', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    // Snapshot provider.create call count before this test
    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const providerBefore = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsBefore = providerBefore?.create.mock.calls.length ?? 0;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // provider.create should NOT have been called during this test
    const providerAfter = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsAfter = providerAfter?.create.mock.calls.length ?? 0;
    expect(createCallsAfter).toBe(createCallsBefore);
  });

  // -------------------------------------------------------------------------
  // Stale workspace source-symlink → truthful CLI error
  // -------------------------------------------------------------------------

  it('surfaces auto-registration failures instead of claiming the repo is invalid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>)
      .mockResolvedValueOnce('/test/path')
      .mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error(
        'Source symlink at /home/test/.archon/workspaces/acme/widget/source already points to ' +
          '/home/test/.archon/workspaces/widget, expected /test/path'
      )
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {}).catch(
      err => err as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot create worktree: repository registration failed.');
    expect(error.message).toContain(
      'Remove the stale workspace entry at /home/test/.archon/workspaces/acme/widget and retry'
    );
    expect(error.message).not.toContain('not in a git repository');
  });

  it('surfaces auto-registration failures on --resume instead of claiming the repo is invalid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>)
      .mockResolvedValueOnce('/test/path')
      .mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error(
        'Source symlink at /home/test/.archon/workspaces/acme/widget/source already points to ' +
          '/home/test/.archon/workspaces/widget, expected /test/path'
      )
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {
      resume: true,
    }).catch(err => err as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot resume: repository registration failed.');
    expect(error.message).toContain(
      'Remove the stale workspace entry at /home/test/.archon/workspaces/acme/widget and retry'
    );
    expect(error.message).not.toContain('Not in a git repository');
  });

  it('falls back to generic workspace hint when registration error has an unrecognized shape', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (gitModule.findRepoRoot as ReturnType<typeof mock>)
      .mockResolvedValueOnce('/test/path')
      .mockResolvedValueOnce('/test/path');
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("EACCES: permission denied, mkdir '/home/test/.archon/workspaces/acme'")
    );

    const error = await workflowRunCommand('/test/path', 'assist', 'hello', {}).catch(
      err => err as Error
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Cannot create worktree: repository registration failed.');
    expect(error.message).toContain('EACCES: permission denied');
    // Path-separator-agnostic check: on Windows path.join normalizes to `\`,
    // on POSIX to `/`. Assert the hint prefix + the final segment separately.
    expect(error.message).toContain('Check your Archon workspace registration under');
    expect(error.message).toMatch(/workspaces\b/);
    expect(error.message).not.toContain('Remove the stale workspace entry');
  });

  // -------------------------------------------------------------------------
  // Workflow-level `worktree.enabled` policy
  // -------------------------------------------------------------------------

  it('skips isolation when workflow YAML pins worktree.enabled: false', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const providerBefore = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsBefore = providerBefore?.create.mock.calls.length ?? 0;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // No flags — policy alone should disable isolation
    await workflowRunCommand('/test/path', 'triage', 'go', {});

    const providerAfter = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const createCallsAfter = providerAfter?.create.mock.calls.length ?? 0;
    expect(createCallsAfter).toBe(createCallsBefore);
  });

  it('throws when workflow pins worktree.enabled: false but caller passes --branch', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'triage', 'go', { branchName: 'feat-x' })
    ).rejects.toThrow(/worktree\.enabled: false/);
  });

  it('throws when workflow pins worktree.enabled: false but caller passes --from', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'triage', 'go', { fromBranch: 'dev' })
    ).rejects.toThrow(/worktree\.enabled: false/);
  });

  it('throws when workflow pins worktree.enabled: false but caller passes --base', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    // A live-checkout run cuts no worktree, so --base can only half-apply:
    // it would still move $BASE_BRANCH. Reject it like --from rather than
    // silently retargeting the PR of a run that has no worktree.
    await expect(
      workflowRunCommand('/test/path', 'triage', 'go', { baseBranch: 'epic/foo' })
    ).rejects.toThrow(/worktree\.enabled: false/);
  });

  it('accepts worktree.enabled: false + --no-worktree as redundant (no error)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // Should not throw — redundant, not contradictory
    await workflowRunCommand('/test/path', 'triage', 'go', { noWorktree: true });
  });

  it('throws when workflow pins worktree.enabled: true but caller passes --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'build',
          description: 'Requires a worktree',
          worktree: { enabled: true },
        }),
      ],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'build', 'go', { noWorktree: true })
    ).rejects.toThrow(/worktree\.enabled: true/);
  });

  it('throws when isolation cannot be created due to missing codebase', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    // No codebase found
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    // Not in a git repo
    (gitModule.findRepoRoot as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowRunCommand('/test/path', 'assist', 'hello', {})).rejects.toThrow(
      'Cannot create worktree: not in a git repository'
    );
  });

  it('emits warning when reused worktree has mismatched base branch', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-old',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    (gitModule.isAncestorOf as ReturnType<typeof mock>).mockResolvedValueOnce(false);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'my-feature' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("not based on 'dev'"));
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('warns that --base did not change the cut-from when reusing a worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-old',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    // Base is valid, so the mismatch warning stays silent and this test asserts
    // only the reuse notice.
    (gitModule.isAncestorOf as ReturnType<typeof mock>).mockResolvedValueOnce(true);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', {
        branchName: 'my-feature',
        baseBranch: 'epic/foo',
      });
      // Unlike --from (which is fully ignored on reuse), --base is PARTIALLY
      // applied: the cut-from is already fixed, but $BASE_BRANCH still moves.
      // The wording has to say so, or it trades one silent surprise for another.
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('--base epic/foo did not change the cut-from')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('it still applies to the PR target')
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('validates a reused worktree against --base rather than repo config', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');
    const gitModule = await import('@archon/git');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-old',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    (gitModule.isAncestorOf as ReturnType<typeof mock>).mockResolvedValueOnce(false);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', {
        branchName: 'my-feature',
        baseBranch: 'epic/foo',
      });
      // Repo config says 'dev'; the dispatch said 'epic/foo'. Checking ancestry
      // against 'dev' would report a mismatch nobody asked about.
      expect(gitModule.isAncestorOf as ReturnType<typeof mock>).toHaveBeenCalledWith(
        '/worktrees/feat',
        'origin/epic/foo'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("not based on 'epic/foo'")
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not emit base branch warning when reused worktree is valid', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-valid',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    // isAncestorOf returns true by default — no warning expected
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'my-feature' });
      const baseBranchWarnCalls = consoleWarnSpy.mock.calls.filter(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('not based on')
      );
      expect(baseBranchWarnCalls).toHaveLength(0);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('uses codebase default_branch for reuse validation instead of git auto-detection', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolationDb = await import('@archon/core/db/isolation-environments');
    const gitModule = await import('@archon/git');

    const getDefaultBranchCallsBefore = (gitModule.getDefaultBranch as ReturnType<typeof mock>).mock
      .calls.length;

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: 'develop',
    });
    (isolationDb.findActiveByWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'env-1',
      working_path: '/worktrees/feat',
      branch_name: 'feature-old',
      workflow_type: 'task',
      workflow_id: 'my-feature',
    });
    (gitModule.isAncestorOf as ReturnType<typeof mock>).mockResolvedValueOnce(false);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { branchName: 'my-feature' });
      // Warning names the codebase default branch, not the auto-detected 'dev'
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("not based on 'develop'")
      );
      // The stored default branch short-circuits git auto-detection entirely
      const getDefaultBranchCallsAfter = (gitModule.getDefaultBranch as ReturnType<typeof mock>)
        .mock.calls.length;
      expect(getDefaultBranchCallsAfter).toBe(getDefaultBranchCallsBefore);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('threads codebase default_branch into provider.create and executeWorkflow opts', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: 'develop',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // No branchName, no noWorktree — auto-isolates via provider.create
    await workflowRunCommand('/test/path', 'assist', 'hello', {});

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      baseBranch?: string;
    };
    expect(lastCreateCall.baseBranch).toBe('develop');

    // executeWorkflow opts (trailing arg) carry the same fallback for $BASE_BRANCH
    const executeSpy = executeWorkflow as ReturnType<typeof mock>;
    const lastExecuteArgs = executeSpy.mock.calls.at(-1) as unknown[];
    const opts = lastExecuteArgs[lastExecuteArgs.length - 1] as { baseBranch?: string };
    expect(opts.baseBranch).toBe('develop');
  });

  it('rejects --base combined with --no-worktree', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    await expect(
      workflowRunCommand('/test/path', 'assist', 'go', { noWorktree: true, baseBranch: 'epic/foo' })
    ).rejects.toThrow(/--base has no effect with --no-worktree/i);
  });

  it('threads --base override into provider.create (baseOverride) and executeWorkflow opts (PR target)', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: 'develop',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    // --base epic/foo dispatched via the baseBranch option (from the CLI flag)
    await workflowRunCommand('/test/path', 'assist', 'hello', { baseBranch: 'epic/foo' });

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      baseBranch?: string;
      baseOverride?: string;
    };
    // Flag flows as the override (wins over config + codebase default in the
    // provider); codebase default stays in the request as the fallback.
    expect(lastCreateCall.baseOverride).toBe('epic/foo');
    expect(lastCreateCall.baseBranch).toBe('develop');

    // PR target / $BASE_BRANCH: the flag rides its own `baseOverride` channel so
    // it outranks `worktree.baseBranch` inside executeWorkflow. `baseBranch`
    // keeps carrying the codebase default as the fallback — the same split the
    // provider request uses above. Asserting the flag in `baseBranch` here would
    // pass while $BASE_BRANCH still resolved to repo config (see the
    // 'prefers baseOverride over repo config baseBranch' test in
    // packages/workflows/src/executor.test.ts, which covers the resolution).
    const executeSpy = executeWorkflow as ReturnType<typeof mock>;
    const lastExecuteArgs = executeSpy.mock.calls.at(-1) as unknown[];
    const opts = lastExecuteArgs[lastExecuteArgs.length - 1] as {
      baseBranch?: string;
      baseOverride?: string;
    };
    expect(opts.baseOverride).toBe('epic/foo');
    expect(opts.baseBranch).toBe('develop');
  });

  it('warns that --base did not change the cut-from when resuming a run', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow, hydrateResumableRun } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDb = await import('@archon/core/db/workflows');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    // A null hydration aborts the resume before executeWorkflow, so the run must
    // carry prior state for this path to reach the dispatch.
    (hydrateResumableRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      preCreatedRun: { id: 'run-prior', workflow_name: 'assist' },
      priorCompletedNodes: new Map([['node-a', 'done']]),
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: 'develop',
    });
    // working_path null keeps the resume on the caller cwd, skipping the
    // existsSync probe (fs is deliberately not mocked in this suite).
    (workflowDb.findResumableRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-prior',
      working_path: null,
      workflow_name: 'assist',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', {
        resume: true,
        baseBranch: 'epic/foo',
      });
      // --resume adopts the prior run's worktree, so its cut-from is as fixed as
      // it is on --branch reuse -- but flagBase still reaches executeWorkflow as
      // baseOverride and moves $BASE_BRANCH. Same half-applied shape, same
      // warning.
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('--base epic/foo did not change the cut-from')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('it still applies to the PR target')
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('lets --from win the cut-from while --base still drives the PR target', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: 'develop',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', {
      fromBranch: 'origin/release/2.0',
      baseBranch: 'dev',
    });

    // INTENTIONAL, not an oversight: --base sets both halves of "base" by
    // default, and --from is the lever that decouples them. Combining them is
    // how you express "branch from release/2.0, but open the PR against dev" —
    // the one case a single flag cannot say. Making one flag win outright would
    // delete that capability, so this pairing is deliberately left unguarded.
    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      fromBranch?: string;
      baseOverride?: string;
    };
    expect(lastCreateCall.fromBranch).toBe('origin/release/2.0');
    expect(lastCreateCall.baseOverride).toBe('dev');

    const executeSpy = executeWorkflow as ReturnType<typeof mock>;
    const lastExecuteArgs = executeSpy.mock.calls.at(-1) as unknown[];
    const opts = lastExecuteArgs[lastExecuteArgs.length - 1] as { baseOverride?: string };
    expect(opts.baseOverride).toBe('dev');
  });

  it('threads codebase name into provider.create so single-segment checkout paths resolve', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    // Single-segment checkout path — the stored owner/repo name must reach the
    // provider so worktrees use the registered identity instead of the
    // _local/<basename> path fallback (#2022, #2227).
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      name: 'owner/repo',
      default_cwd: '/workspace',
      default_branch: 'main',
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/workspace', 'assist', 'hello', {});

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      codebaseName?: string;
    };
    expect(lastCreateCall.codebaseName).toBe('owner/repo');
  });

  it('omits baseBranch when the codebase has no stored default_branch', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const isolation = await import('@archon/isolation');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-123',
      default_cwd: '/test/path',
      default_branch: null,
    });
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-123',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', {});

    const getIsolationProviderMock = isolation.getIsolationProvider as ReturnType<typeof mock>;
    const provider = getIsolationProviderMock.mock.results.at(-1)?.value as
      | { create: ReturnType<typeof mock> }
      | undefined;
    const lastCreateCall = provider?.create.mock.calls.at(-1)?.[0] as {
      baseBranch?: string;
    };
    expect(lastCreateCall.baseBranch).toBeUndefined();

    const executeSpy = executeWorkflow as ReturnType<typeof mock>;
    const lastExecuteArgs = executeSpy.mock.calls.at(-1) as unknown[];
    const opts = lastExecuteArgs[lastExecuteArgs.length - 1] as { baseBranch?: string };
    expect(opts.baseBranch).toBeUndefined();
  });

  it('sends dispatch message before executeWorkflow with correct metadata', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    // Track call order for assistant messages only (user message is added first via addMessage directly)
    const callOrder: string[] = [];
    (messagesDb.addMessage as ReturnType<typeof mock>).mockImplementation(
      async (_dbId: unknown, role: unknown, content: unknown) => {
        if (role === 'assistant') {
          callOrder.push(`addMessage:${String(content)}`);
        }
      }
    );
    (executeWorkflow as ReturnType<typeof mock>).mockImplementation(async () => {
      callOrder.push('executeWorkflow');
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // Dispatch assistant message fires before executeWorkflow
    expect(callOrder[0]).toContain('Dispatching workflow');
    expect(callOrder[1]).toBe('executeWorkflow');

    // Correct metadata shape
    expect(messagesDb.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      'Dispatching workflow: **assist**',
      expect.objectContaining({
        category: 'workflow_dispatch_status',
        workflowDispatch: expect.objectContaining({
          workflowName: 'assist',
          workerConversationId: expect.stringMatching(/^cli-/),
        }),
      })
    );
  });

  it('sends result card when executeWorkflow returns a summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-42',
      summary: 'All steps completed. Branch pushed.',
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    expect(messagesDb.addMessage).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      'All steps completed. Branch pushed.',
      expect.objectContaining({
        category: 'workflow_result',
        workflowResult: { workflowName: 'assist', runId: 'run-42' },
      })
    );
  });

  it('does not send result card when executeWorkflow has no summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
      // no summary field
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

    // Only dispatch addMessage call, no result card
    const resultCalls = (messagesDb.addMessage as ReturnType<typeof mock>).mock.calls.filter(
      (args: unknown[]) => {
        const meta = args[3] as Record<string, unknown> | undefined;
        return meta?.category === 'workflow_result';
      }
    );
    expect(resultCalls).toHaveLength(0);
  });

  it('does not throw and logs warn when result message DB persist fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
      summary: 'Done.',
    });
    // addMessage is called three times: user message persist, dispatch, result
    // CLIAdapter internally catches DB errors — it logs 'cli_message_persist_failed' and does not throw.
    // Verify workflowRunCommand does not throw even when the result DB write fails.
    (messagesDb.addMessage as ReturnType<typeof mock>)
      .mockResolvedValueOnce(undefined) // user message persist succeeds
      .mockResolvedValueOnce(undefined) // dispatch succeeds
      .mockRejectedValueOnce(new Error('DB gone')); // result fails (caught inside CLIAdapter)

    // Should not throw — the CLIAdapter swallows the DB error and logs a warn
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).resolves.toBe(0);

    // CLIAdapter logs 'cli_message_persist_failed' when addMessage throws internally
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'cli_message_persist_failed'
    );
  });

  it('does not throw and continues to executeWorkflow when dispatch sendMessage fails', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockClear();
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1',
    });
    // First addMessage (user message persist) succeeds, second (dispatch) fails
    (messagesDb.addMessage as ReturnType<typeof mock>)
      .mockResolvedValueOnce(undefined) // user message persist succeeds
      .mockRejectedValueOnce(new Error('DB gone')); // dispatch fails (caught inside CLIAdapter)

    // Should not throw — dispatch failure must not block workflow execution
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true })
    ).resolves.toBe(0);

    // executeWorkflow was still called despite dispatch failure
    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does not send result card when workflow is paused even with summary', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const messagesDb = await import('@archon/core/db/messages');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-paused',
      paused: true,
      summary: 'Steps completed so far.',
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await workflowRunCommand('/test/path', 'assist', 'hello', { noWorktree: true });

      // Paused guard fires before summary check — no result card despite having a summary
      const resultCalls = (messagesDb.addMessage as ReturnType<typeof mock>).mock.calls.filter(
        (args: unknown[]) => {
          const meta = args[3] as Record<string, unknown> | undefined;
          return meta?.category === 'workflow_result';
        }
      );
      expect(resultCalls).toHaveLength(0);

      // Confirm paused message was printed
      expect(consoleSpy).toHaveBeenCalledWith('\nWorkflow paused — waiting for approval.');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.3b "Provide Archon Start And
// Status CLI JSON", Task 1 (`workflow.start` envelope conversion of
// foreground `workflow run --json`).
//
// `workflowRunCommand` already exists and is fully callable today — the
// boundary is present — so every test below is a genuine executable red
// test (not `it.skip()`): it calls the real exported function with the
// same mock scaffolding the rest of this file already uses, and asserts the
// NEW `workflow.start` envelope shape from
// `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/start-success.json`.
// Today `workflowRunCommand` prints human text ("Running workflow: ...",
// "Working directory: ...", "\nWorkflow completed successfully.") and never
// builds an envelope, so these fail for real, not vacuously.
//
// `correlationId` is now a real field on `WorkflowRunOptions` (added by Story 3.3b).
// ---------------------------------------------------------------------------

describe('workflowRunCommand — JSON envelope (Story 3.3b)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
    // `workflowDb.getWorkflowRun` is not called anywhere in `workflowRunCommand`
    // today (Task 1 adds that call) — every `.mockResolvedValueOnce()` /
    // `.mockRejectedValueOnce()` queued in this block's tests is therefore left
    // unconsumed by current production code and would otherwise leak into
    // later describe blocks (`workflowGetCommand`, `workflowResumeCommand`,
    // etc.) that share this same top-of-file mock. Reset it back to the
    // file's baseline default after every test in this block so this
    // red-phase scaffold cannot pollute unrelated, already-passing tests.
    const workflowDb = await import('@archon/core/db/workflows');
    const getWorkflowRunMock = workflowDb.getWorkflowRun as ReturnType<typeof mock>;
    getWorkflowRunMock.mockReset();
    getWorkflowRunMock.mockImplementation(() => Promise.resolve(null));
  });

  /** Common wiring shared by most scenarios below: one workflow, no codebase, no worktree. */
  async function primeCommonMocks(): Promise<void> {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
  }

  function lastStdoutJson(): Record<string, unknown> {
    const lastCall = stdoutSpy.mock.calls.at(-1) as unknown[] | undefined;
    return JSON.parse(String(lastCall?.[0])) as Record<string, unknown>;
  }

  // 3.3B-UNIT-001 [P0] R-001,R-007 — one `workflow.start` success document for
  // a completed run, matching start-success.json's envelope shape.
  it('3.3B-UNIT-001: emits one workflow.start success envelope for a completed run', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-1-completed',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1-completed',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    // Genuinely red today: current code prints multiple human lines, not one envelope.
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-1-completed',
      workflowName: 'assist',
    });
    expect(envelope.result).toMatchObject({
      operation: 'start',
      state: 'completed',
      terminal: true,
      accepted: true,
    });
  });

  // 3.3B-UNIT-008 [P1] R-007,RC-20 — workflowRunRef.projectRef is
  // "project:<codebase_id>" only when a codebase actually resolved; omitted
  // (not null/empty) otherwise.
  describe('3.3B-UNIT-008: workflowRunRef.projectRef derivation', () => {
    it('omits projectRef when no codebase resolved', async () => {
      await primeCommonMocks();
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-noproj',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-noproj',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: null,
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

      const envelope = lastStdoutJson();
      const ref = envelope.workflowRunRef as Record<string, unknown>;
      expect('projectRef' in ref).toBe(false);
    });

    it('sets projectRef to "project:<codebase_id>" when a codebase resolved', async () => {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      const conversationDb = await import('@archon/core/db/conversations');
      const codebaseDb = await import('@archon/core/db/codebases');
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');

      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      });
      (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'conv-123',
      });
      (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'cb-proj',
        name: 'test-repo',
        default_cwd: '/test/path',
      });
      (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValueOnce(
        undefined
      );
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-proj',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-proj',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: 'cb-proj',
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

      const envelope = lastStdoutJson();
      const ref = envelope.workflowRunRef as Record<string, unknown>;
      expect(ref.projectRef).toBe('project:cb-proj');
    });
  });

  // 3.3B-UNIT-009 [P0] R-008 — a failed execution that DOES carry a
  // workflowRunId emits WORKFLOW_EXECUTION_FAILED/unexpected_state/retryable
  // true/exitCode 78, with only structured details — never the raw
  // `result.error` diagnostic string (NFR-14).
  it('3.3B-UNIT-009: failed execution with a run id emits a structured, non-leaking error envelope', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      workflowRunId: 'run-failed-9',
      error: 'raw diagnostic: connection reset while calling provider',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_EXECUTION_FAILED');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(true);
    const details = error.details as Record<string, unknown>;
    expect(details.runId).toBe('run-failed-9');
    expect(JSON.stringify(details)).not.toContain('connection reset');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3B-UNIT-010 [P0] R-008 — a failed execution WITHOUT a workflowRunId
  // (early executor failure) emits INTERNAL_ERROR/implementation_defect with
  // requestAccepted:false, exitCode 70.
  it('3.3B-UNIT-010: failed execution without a run id emits INTERNAL_ERROR/requestAccepted:false', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: false,
      error: 'early failure before any run row existed',
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    expect(error.details).toMatchObject({ requestAccepted: false });
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3B-UNIT-011 [P1] R-007 — when execution succeeds but the mandatory
  // persisted-run reload fails, the command emits a structured internal
  // error carrying the runId, not a stale/inferred success envelope.
  it('3.3B-UNIT-011: persisted-run reload failure after success becomes a structured internal error', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-reload-fail',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('DB unavailable')
    );

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const details = error.details as Record<string, unknown>;
    expect(details.runId).toBe('run-reload-fail');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3B-UNIT-012 [P0] R-004,R-009 — an early throw (unknown workflow name)
  // must be caught by the fail-closed boundary and converted to a
  // WORKFLOW_NOT_FOUND envelope, never escape as a rejected promise, when
  // --json is set.
  it('3.3B-UNIT-012: unknown workflow name under --json fails closed instead of rejecting', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });

    // Today this rejects — the assertion below documents the required new
    // behavior (never throw when options.json is true) and is genuinely red.
    await expect(
      workflowRunCommand('/test/path', 'does-not-exist', 'hello', {
        json: true,
        noWorktree: true,
      })
    ).resolves.toBe(78);

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('RF-36: non-boolean json option values fail closed instead of enabling JSON mode silently', async () => {
    await expect(
      workflowRunCommand('/test/path', 'assist', 'hello', {
        json: 'true' as unknown as boolean,
        noWorktree: true,
        correlationId: 'corr-invalid-json-run',
      })
    ).resolves.toBe(64);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('MALFORMED_REQUEST');
    expect(error.category).toBe('provider_contract');
    expect(envelope.correlationId).toBe('corr-invalid-json-run');
  });

  // 3.3B-UNIT-013 [P1] R-015, W-3.3B-003 — the foreground command remains
  // genuinely blocking: the envelope is only written to stdout AFTER
  // executeWorkflow resolves, and the reported state is never a live
  // "running" snapshot (the fixture's state:"running" depicts a
  // non-blocking model this story deliberately does not implement).
  it('3.3B-UNIT-013: envelope is written only after executeWorkflow resolves (no fake async "running")', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');

    // Clear mock call history so we can detect when executeWorkflow is called in this test
    (executeWorkflow as ReturnType<typeof mock>).mockClear();

    let resolveExec: (value: { success: true; workflowRunId: string }) => void = () => {};
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveExec = resolve;
        })
    );
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-blocking',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    const runPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
      json: true,
      noWorktree: true,
    });

    try {
      // Wait for executeWorkflow to actually be called (it has many async ops before it).
      // Check every microtask for up to 100ms.
      let waited = 0;
      while ((executeWorkflow as ReturnType<typeof mock>).mock.calls.length === 0 && waited < 100) {
        await Promise.resolve();
        waited++;
      }
      // Now that executeWorkflow is pending, no envelope should exist yet.
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      // Always unblock executeWorkflow so runPromise settles, even if the
      // assertion above fails — otherwise a dangling pending promise leaks
      // past this test.
      resolveExec({ success: true, workflowRunId: 'run-blocking' });
    }
    await runPromise;

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.result).toMatchObject({ state: 'completed' });
    expect((envelope.result as Record<string, unknown>).state).not.toBe('running');
  });

  // 3.3B-UNIT-015 [P0] R-002 — exactly one stdout line for the foreground
  // JSON path, and none of the current human/progress strings leak through.
  it('3.3B-UNIT-015: JSON mode start writes exactly one stdout line with no human text', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-purity',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-purity',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = String((stdoutSpy.mock.calls[0] as unknown[])[0]);
    expect(raw).not.toContain('Running workflow:');
    expect(raw).not.toContain('Working directory:');
    expect(raw).not.toContain('Dispatching workflow');
    expect(raw).not.toContain('Workflow completed successfully');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // 3.3B-UNIT-016 [P0] R-002,R-006 — a paused-for-approval start still
  // yields exactly one envelope, with actionRequired/gateRef populated
  // (not the human "\nWorkflow paused — waiting for approval." line).
  it('3.3B-UNIT-016: paused-for-approval start emits one envelope with gateRef', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-gate',
      paused: true,
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: { approval: { nodeId: 'review', message: 'Please review the plan' } },
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.gateRef).toMatchObject({ gateId: 'review', kind: 'human-decision' });
  });

  // 3.3B-UNIT-016b [P0] R-002,R-006 — a paused interactive-loop start emits
  // state:'paused' (NOT 'waiting-for-approval') with no actionRequired/gateRef.
  // This is the command-level counterpart of the mapping-helper test 3.3B-UNIT-005.
  it('3.3B-UNIT-016b: paused interactive-loop start emits one envelope with state paused (no gateRef)', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-loop',
      paused: true,
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-loop',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {
        approval: { nodeId: 'loop-node', message: 'Loop iteration', type: 'interactive_loop' },
      },
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('paused');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBeUndefined();
    expect(result.gateRef).toBeUndefined();
  });

  // 3.3B-UNIT-018 [P1] R-010 — a supplied --correlation-id is echoed
  // verbatim in both success and error envelopes.
  describe('3.3B-UNIT-018: correlation id threading', () => {
    it('echoes a supplied correlationId on a success envelope', async () => {
      await primeCommonMocks();
      const { executeWorkflow } = await import('@archon/workflows/executor');
      const workflowDb = await import('@archon/core/db/workflows');
      (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
        success: true,
        workflowRunId: 'run-corr-ok',
      });
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-corr-ok',
        workflow_name: 'assist',
        status: 'completed',
        codebase_id: null,
        working_path: '/test/path',
        started_at: new Date(),
        metadata: {},
      });

      const opts: WorkflowRunOptions = {
        json: true,
        noWorktree: true,
        correlationId: 'corr-story-3-3b-success',
      };
      await workflowRunCommand('/test/path', 'assist', 'hello', opts);

      const envelope = lastStdoutJson();
      expect(envelope.correlationId).toBe('corr-story-3-3b-success');
    });

    it('echoes a supplied correlationId on an error envelope', async () => {
      const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
      (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      });

      const opts: WorkflowRunOptions = {
        json: true,
        noWorktree: true,
        correlationId: 'corr-story-3-3b-error',
      };
      await workflowRunCommand('/test/path', 'unknown-workflow', 'hello', opts);

      const envelope = lastStdoutJson();
      expect(envelope.correlationId).toBe('corr-story-3-3b-error');
    });
  });

  // 3.3B-UNIT-027 [P1] R-012 — a message-persistence failure during JSON
  // mode is logged, not surfaced, and does not corrupt the one-line stdout
  // contract.
  it('3.3B-UNIT-027: adapter persistence failure during JSON mode does not corrupt stdout', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    const messagesDb = await import('@archon/core/db/messages');
    (messagesDb.addMessage as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('persist failed')
    );
    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-persist-fail',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-persist-fail',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(() => lastStdoutJson()).not.toThrow();
  });

  // 3.3B-UNIT-028 [P1] R-019 — two sequential JSON starts never mix
  // correlation ids or workflowRunRefs across calls.
  it('3.3B-UNIT-028: two sequential JSON starts keep distinct correlation ids and run refs', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const conversationDb = await import('@archon/core/db/conversations');
    const codebaseDb = await import('@archon/core/db/codebases');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValue({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValue({
      id: 'conv-123',
    });
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValue(null);
    (conversationDb.updateConversation as ReturnType<typeof mock>).mockResolvedValue(undefined);

    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-A',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-A',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    const optsA: WorkflowRunOptions = {
      json: true,
      noWorktree: true,
      correlationId: 'corr-A',
    };
    await workflowRunCommand('/test/path', 'assist', 'hello', optsA);
    const envelopeA = lastStdoutJson();

    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-B',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-B',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    const optsB: WorkflowRunOptions = {
      json: true,
      noWorktree: true,
      correlationId: 'corr-B',
    };
    await workflowRunCommand('/test/path', 'assist', 'hello', optsB);
    const envelopeB = lastStdoutJson();

    expect(envelopeA.correlationId).toBe('corr-A');
    expect(envelopeB.correlationId).toBe('corr-B');
    expect((envelopeA.workflowRunRef as Record<string, unknown>).runId).toBe('run-A');
    expect((envelopeB.workflowRunRef as Record<string, unknown>).runId).toBe('run-B');
  });

  // RF-26: JSON result-card persistence regression test
  it('persists result cards via adapter.sendMessage in JSON mode', async () => {
    await primeCommonMocks();
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const workflowDb = await import('@archon/core/db/workflows');
    const messagesDb = await import('@archon/core/db/messages');

    (executeWorkflow as ReturnType<typeof mock>).mockResolvedValueOnce({
      success: true,
      workflowRunId: 'run-result-persist',
      summary: 'Workflow completed.',
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-result-persist',
      workflow_name: 'assist',
      status: 'completed',
      codebase_id: null,
      working_path: '/test/path',
      started_at: new Date(),
      metadata: {},
    });
    (messagesDb.addMessage as ReturnType<typeof mock>).mockClear();

    await workflowRunCommand('/test/path', 'assist', 'hello', { json: true, noWorktree: true });

    const resultCalls = (messagesDb.addMessage as ReturnType<typeof mock>).mock.calls.filter(
      (args: unknown[]) => {
        const meta = args[3] as Record<string, unknown> | undefined;
        return meta?.category === 'workflow_result';
      }
    );
    expect(resultCalls.length).toBeGreaterThanOrEqual(1);
    const resultCall = resultCalls[0];
    expect(resultCall[1]).toBe('assistant');
    expect(resultCall[2]).toBe('Workflow completed.');
    const meta = resultCall[3] as Record<string, unknown>;
    expect(meta.category).toBe('workflow_result');
    expect(meta.workflowResult).toEqual({
      workflowName: 'assist',
      runId: 'run-result-persist',
    });
  });

  // RF-27: JSON worktree-policy mismatch classification regression test
  it('classifies worktree-policy mismatch as MALFORMED_REQUEST in JSON mode', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');

    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({
          name: 'triage',
          description: 'Read-only triage',
          worktree: { enabled: false },
        }),
      ],
      errors: [],
    });

    await workflowRunCommand('/test/path', 'triage', 'go', {
      json: true,
      branchName: 'feat-x',
    });

    const envelope = lastStdoutJson();
    expect(envelope.success).toBe(false);
    expect(envelope.error.code).toBe('MALFORMED_REQUEST');
    expect(envelope.error.category).toBe('provider_contract');
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.execution.exitCode).toBe(64);
  });
});

const VERBOSE_EVENTS_FIXTURE: WorkflowEventRow[] = [
  {
    id: 'event-without-node',
    workflow_run_id: 'run-verbose-json',
    event_type: 'tool_completed',
    step_name: 'ignored-tool',
    step_index: null,
    data: {},
    created_at: '2026-08-03T10:00:00.000Z',
  },
  {
    id: 'zeta-started',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_started',
    step_name: 'zeta',
    step_index: 0,
    data: {},
    created_at: '2026-08-03T10:00:01.000Z',
  },
  {
    id: 'alpha-started',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_started',
    step_name: 'alpha',
    step_index: 1,
    data: {},
    created_at: '2026-08-03T10:00:02.000Z',
  },
  {
    id: 'middle-skipped',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_skipped_prior_success',
    step_name: 'middle',
    step_index: 2,
    data: {},
    created_at: '2026-08-03T10:00:03.000Z',
  },
  {
    id: 'zeta-completed',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_completed',
    step_name: 'zeta',
    step_index: 0,
    data: { node_output: 'x'.repeat(200) },
    created_at: '2026-08-03T10:00:04.000Z',
  },
  {
    id: 'alpha-failed',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_failed',
    step_name: 'alpha',
    step_index: 1,
    data: {},
    created_at: '2026-08-03T10:00:07.000Z',
  },
  {
    id: 'beta-started',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_started',
    step_name: 'beta',
    step_index: 3,
    data: {},
    created_at: '2026-08-03T10:00:08.000Z',
  },
  {
    id: 'orphan-completed',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_completed',
    step_name: 'orphan',
    step_index: 4,
    data: { node_output: 'y'.repeat(201) },
    created_at: '2026-08-03T10:00:09.000Z',
  },
  {
    id: 'plain-skipped',
    workflow_run_id: 'run-verbose-json',
    event_type: 'node_skipped',
    step_name: 'skip-plain',
    step_index: 5,
    data: {},
    created_at: '2026-08-03T10:00:10.000Z',
  },
];

const EXPECTED_VERBOSE_NODES = JSON.parse(
  JSON.stringify(buildNodeSummaries(VERBOSE_EVENTS_FIXTURE))
) as Array<Record<string, unknown>>;

describe('buildNodeSummaries', () => {
  it('resets a retried node to its current running attempt', () => {
    const summaries = buildNodeSummaries([
      {
        id: 'retry-start-1',
        workflow_run_id: 'run-retry',
        event_type: 'node_started',
        step_index: 0,
        step_name: 'build',
        data: {},
        created_at: '2026-08-03T10:00:00.000Z',
        event_order: 1,
      },
      {
        id: 'retry-failed',
        workflow_run_id: 'run-retry',
        event_type: 'node_failed',
        step_index: 0,
        step_name: 'build',
        data: { error: 'temporary failure' },
        created_at: '2026-08-03T10:00:01.000Z',
        event_order: 2,
      },
      {
        id: 'retry-start-2',
        workflow_run_id: 'run-retry',
        event_type: 'node_started',
        step_index: 0,
        step_name: 'build',
        data: {},
        created_at: '2026-08-03T10:00:02.000Z',
        event_order: 3,
      },
    ]);

    expect(summaries).toEqual([
      { nodeId: 'build', state: 'running', startedAt: '2026-08-03T10:00:02.000Z' },
    ]);
  });
});

describe('workflowStatusCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('should print message when no active runs', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand();

    expect(consoleSpy).toHaveBeenCalledWith('No active workflows.');
  });

  it('should list active runs with ID, name, path, status, and age', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-abc',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      },
    ]);

    await workflowStatusCommand();

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('run-abc'))).toBe(true);
    expect(calls.some(c => c.includes('implement'))).toBe(true);
    expect(calls.some(c => c.includes('/path/to/worktree'))).toBe(true);
    expect(calls.some(c => c.includes('running'))).toBe(true);
  });

  it('should output JSON when json=true', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand(true);

    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify({ runs: [] }, null, 2)}\n`,
      expect.any(Function)
    );
  });

  it('should show node summaries in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-verbose',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 30 * 1000),
      },
    ]);

    const startTime = new Date(Date.now() - 25 * 1000).toISOString();
    const endTime = new Date(Date.now() - 15 * 1000).toISOString();
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'e1',
        workflow_run_id: 'run-verbose',
        event_type: 'node_started',
        step_name: 'plan',
        step_index: null,
        data: {},
        created_at: startTime,
      },
      {
        id: 'e2',
        workflow_run_id: 'run-verbose',
        event_type: 'node_completed',
        step_name: 'plan',
        step_index: null,
        data: { node_output: 'Plan output here' },
        created_at: endTime,
      },
    ]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('Nodes:'))).toBe(true);
    expect(calls.some(c => c.includes('✓') && c.includes('plan'))).toBe(true);
    expect(calls.some(c => c.includes('Plan output here'))).toBe(true);
  });

  it('should show error message for failed node in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-failed',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 30 * 1000),
      },
    ]);

    const startTime = new Date(Date.now() - 20 * 1000).toISOString();
    const endTime = new Date(Date.now() - 10 * 1000).toISOString();
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'e3',
        workflow_run_id: 'run-failed',
        event_type: 'node_started',
        step_name: 'implement',
        step_index: null,
        data: {},
        created_at: startTime,
      },
      {
        id: 'e4',
        workflow_run_id: 'run-failed',
        event_type: 'node_failed',
        step_name: 'implement',
        step_index: null,
        data: { error: 'Compilation failed' },
        created_at: endTime,
      },
    ]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('✗') && c.includes('implement'))).toBe(true);
    expect(calls.some(c => c.includes('Compilation failed'))).toBe(true);
  });

  it('should not show nodes section when no events in verbose mode', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-empty',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(Date.now() - 5 * 1000),
      },
    ]);
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([]);

    await workflowStatusCommand(false, true);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('Nodes:'))).toBe(false);
  });

  it('emits the shared ordered node summaries in verbose JSON by default', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');

    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-verbose-json',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(),
      },
    ]);
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce(
      VERBOSE_EVENTS_FIXTURE
    );

    await workflowStatusCommand(true, true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      runs: Array<{ nodes: Array<Record<string, unknown>>; events?: unknown[] }>;
    };
    expect(parsed.runs[0]?.nodes).toEqual(EXPECTED_VERBOSE_NODES);
    expect(parsed.runs[0]?.events).toBeUndefined();
    expect(parsed.runs[0]?.nodes.map(node => node.nodeId)).toEqual([
      'zeta',
      'alpha',
      'middle',
      'beta',
      'orphan',
      'skip-plain',
    ]);

    const [zeta, alpha, middle, beta, orphan] = parsed.runs[0]?.nodes ?? [];
    expect(zeta).toMatchObject({
      state: 'completed',
      startedAt: '2026-08-03T10:00:01.000Z',
      durationMs: 3_000,
      outputPreview: 'x'.repeat(200),
    });
    expect(alpha).toMatchObject({
      state: 'failed',
      startedAt: '2026-08-03T10:00:02.000Z',
      durationMs: 5_000,
      error: 'Unknown error',
    });
    expect(middle?.startedAt).toBeUndefined();
    expect(middle?.durationMs).toBeUndefined();
    expect(beta).toMatchObject({
      state: 'running',
      startedAt: '2026-08-03T10:00:08.000Z',
    });
    expect(beta?.durationMs).toBeUndefined();
    expect(orphan?.startedAt).toBeUndefined();
    expect(orphan?.durationMs).toBeUndefined();
    expect(orphan?.outputPreview).toBe(`${'y'.repeat(200)}...`);
    expect(String(orphan?.outputPreview)).not.toContain('…');
  });

  it('emits raw events in verbose JSON when events=true', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-verbose-json',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(),
      },
    ]);
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce(
      VERBOSE_EVENTS_FIXTURE
    );

    await workflowStatusCommand(true, true, true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      runs: Array<{ events: WorkflowEventRow[]; nodes?: unknown[] }>;
    };
    expect(parsed.runs[0]?.events).toEqual(VERBOSE_EVENTS_FIXTURE);
    expect(parsed.runs[0]?.nodes).toBeUndefined();
  });

  it('degrades a verbose JSON event-query failure to an empty node payload', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowEventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.listWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'run-unavailable',
        workflow_name: 'implement',
        working_path: '/path/to/worktree',
        status: 'running',
        started_at: new Date(),
      },
    ]);
    (workflowEventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('events unavailable')
    );

    await workflowStatusCommand(true, true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      runs: Array<{ nodes: unknown[] }>;
    };
    expect(parsed.runs[0]?.nodes).toEqual([]);
  });
});

const EMPTY_COUNTS = {
  all: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  pending: 0,
  paused: 0,
};

describe('workflowGetCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // Human (non-JSON) not-found path is explicitly UNCHANGED by Story 3.3b
  // (Task 2: "Keep the exit code 1 for the human (non-JSON) not-found path
  // unchanged") — left as-is, still green.
  it('prints not-found (human) and exits non-zero for a missing run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('nope');

    expect(consoleSpy).toHaveBeenCalledWith('Workflow run not found: nope');
    // Exit 1 so `get <id> && ...` and CI checks react to a missing run.
    expect(code).toBe(1);
  });

  // Human (non-JSON) detail path is also unchanged — left as-is, still green.
  it('prints run detail (human) including the error from metadata', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-xyz',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { error: 'Step failed: build' },
    });

    await workflowGetCommand('run-xyz');

    expect(consoleSpy).toHaveBeenCalledWith('  ID:     run-xyz');
    expect(consoleSpy).toHaveBeenCalledWith('  Name:   implement');
    expect(consoleSpy).toHaveBeenCalledWith('  Status: failed');
    expect(consoleSpy).toHaveBeenCalledWith('  Error:  Step failed: build');
  });

  it('surfaces recorded parse warnings in verbose human output', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const eventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-warning',
      workflow_name: 'gated',
      working_path: '/repo',
      status: 'completed',
      started_at: new Date(),
      metadata: {},
    });
    (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        event_type: 'workflow_parse_warnings',
        step_name: null,
        data: { warnings: ["Node 'plan': unknown key 'interactive'"] },
        created_at: new Date().toISOString(),
      },
    ]);

    await workflowGetCommand('run-warning', false, true);

    expect(consoleSpy).toHaveBeenCalledWith('  Ignored keys (1):');
    expect(consoleSpy).toHaveBeenCalledWith("    - Node 'plan': unknown key 'interactive'");
  });

  it('includes recorded parse warnings in the verbose JSON result', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const eventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-warning',
      workflow_name: 'gated',
      working_path: '/repo',
      status: 'completed',
      started_at: new Date(),
      metadata: {},
    });
    (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        event_type: 'workflow_parse_warnings',
        step_name: null,
        data: { warnings: ["Node 'plan': unknown key 'interactive'"] },
        created_at: new Date().toISOString(),
      },
    ]);

    await workflowGetCommand('run-warning', true, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      result: { parseWarnings?: string[] };
    };
    expect(envelope.result.parseWarnings).toEqual(["Node 'plan': unknown key 'interactive'"]);
  });

  // ---------------------------------------------------------------------
  // RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.3b Task 2: `workflow get --json`
  // must stop emitting the legacy `{ok:false}` / raw-row shape and instead
  // emit `workflow.status` envelopes (RC-11). `workflowGetCommand` already
  // exists and is fully callable, so these are genuine executable red tests
  // against the CURRENTLY WRONG (legacy) output — not `it.skip()`.
  // ---------------------------------------------------------------------

  // 3.3B-UNIT-019 [P0] R-005 — not-found now emits a `workflow.status` error
  // envelope (code WORKFLOW_RUN_NOT_FOUND, category unexpected_state,
  // non-retryable) and the exit code becomes 78 (was 1) under --json.
  it('3.3B-UNIT-019: emits a workflow.status WORKFLOW_RUN_NOT_FOUND envelope and exits 78 for a missing run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('nope', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    expect(error.details).toMatchObject({ runId: 'nope' });
    expect(code).toBe(78);
  });

  // 3.3B-UNIT-020 [P0] R-005,R-008 — a DB lookup failure never leaks the raw
  // driver error text (e.g. "connection refused") into envelope details; it
  // is logged only, and the envelope reports INTERNAL_ERROR, exit 70.
  it('3.3B-UNIT-020: DB lookup failure emits INTERNAL_ERROR without leaking the raw message, exits 70', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const code = await workflowGetCommand('run-x', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    expect(JSON.stringify(error.details)).not.toContain('connection refused');
    expect(code).toBe(70);
  });

  it('RF-40: non-boolean json option values emit a workflow.status malformed-request envelope', async () => {
    const code = await workflowGetCommand(
      'run-invalid-json',
      'true' as unknown as boolean,
      false,
      undefined,
      'corr-invalid-json-get'
    );

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-invalid-json-get');
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('MALFORMED_REQUEST');
    expect(error.category).toBe('provider_contract');
    expect(code).toBe(64);
  });

  // 3.3B-UNIT-021 [P0] R-001,R-005 — a completed run now emits a
  // `workflow.status` success envelope (not the raw WorkflowRun row),
  // terminal:true, exit 0.
  it('3.3B-UNIT-021: emits a workflow.status success envelope for a completed run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-json',
      workflow_name: 'implement',
      status: 'completed',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });

    const code = await workflowGetCommand('run-json', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-json',
      workflowName: 'implement',
    });
    expect(envelope.result).toMatchObject({
      operation: 'status',
      state: 'completed',
      terminal: true,
    });
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-022 [P0] R-005,R-006 — a run paused on an approval gate maps to
  // state "waiting-for-approval" with actionRequired/gateRef, matching
  // status-success.json's illustrative shape (minus phase/W-3.3B-002).
  it('3.3B-UNIT-022: paused-for-approval run maps to waiting-for-approval with a gateRef', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { approval: { nodeId: 'review-gate', message: 'Please review' } },
    });

    const code = await workflowGetCommand('run-gate', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.gateRef).toMatchObject({ gateId: 'review-gate', kind: 'human-decision' });
    expect((envelope.workflowRunRef as Record<string, unknown>).projectRef).toBe('project:cb-1');
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-023 [P1] R-005,R-008 — a failed run's envelope reports
  // state:"failed" without leaking `metadata.error`'s raw prose into the
  // success-envelope result (the envelope stays success:true for `status`
  // reads of a failed run — this command reports state, it does not itself
  // fail because the underlying run failed).
  it('3.3B-UNIT-023: failed run status reports state:"failed" without leaking raw metadata prose', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-failed',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: { error: 'raw diagnostic: step 4 threw ECONNRESET at provider boundary' },
    });

    const code = await workflowGetCommand('run-failed', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('failed');
    expect(result.terminal).toBe(true);
    expect(result.failure).toMatchObject({
      code: 'WORKFLOW_EXECUTION_FAILED',
      category: 'unexpected_state',
      details: {
        runId: 'run-failed',
        hasError: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('ECONNRESET');
    expect(code).toBe(0);
  });

  // 3.3B-UNIT-024 [P1] R-010 — a supplied correlationId (new 4th param) is
  // echoed on success, not-found, and DB-error envelopes alike.
  describe('3.3B-UNIT-024: correlation id threading', () => {
    it('echoes correlationId on a not-found envelope', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

      await workflowGetCommand('nope', true, false, undefined, 'corr-get-not-found');

      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      expect(envelope.correlationId).toBe('corr-get-not-found');
    });

    it('echoes correlationId on a success envelope', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-corr',
        workflow_name: 'implement',
        status: 'completed',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });

      await workflowGetCommand('run-corr', true, false, undefined, 'corr-get-success');

      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      expect(envelope.correlationId).toBe('corr-get-success');
    });
  });

  // 3.3B-UNIT-025 [P1] R-013 — verbose output defaults to compact node
  // summaries; raw events require the explicit `--events` option.
  describe('3.3B-UNIT-025: verbose node summaries live under result.nodes only', () => {
    it('places node summaries under result.nodes when --verbose is set', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      const eventsDb = await import('@archon/core/db/workflow-events');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-v',
        workflow_name: 'implement',
        status: 'running',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });
      (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          event_type: 'node_started',
          step_name: 'plan',
          created_at: new Date().toISOString(),
          data: {},
        },
      ]);

      await workflowGetCommand('run-v', true, true);

      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      expect('events' in envelope).toBe(false);
      const result = envelope.result as Record<string, unknown>;
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.nodes).toHaveLength(1);
      expect(result.events).toBeUndefined();
    });

    it('omits result.events entirely when --verbose is not set', async () => {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-nonverbose',
        workflow_name: 'implement',
        status: 'running',
        codebase_id: null,
        working_path: '/tmp/wt',
        started_at: new Date(),
        metadata: {},
      });

      await workflowGetCommand('run-nonverbose', true, false);

      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      const result = envelope.result as Record<string, unknown>;
      expect('events' in result).toBe(false);
    });
  });

  // 3.3B-UNIT-026 [P1] R-013 — explicit raw-event output preserves the
  // event ordering returned by storage.
  it('3.3B-UNIT-026: --events preserves listWorkflowEvents order verbatim', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const eventsDb = await import('@archon/core/db/workflow-events');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-order',
      workflow_name: 'implement',
      status: 'running',
      codebase_id: null,
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });
    const orderedEvents = [
      {
        event_type: 'node_completed',
        step_name: 'b',
        created_at: '2026-01-01T00:00:02.000Z',
        data: {},
      },
      {
        event_type: 'node_started',
        step_name: 'a',
        created_at: '2026-01-01T00:00:01.000Z',
        data: {},
      },
    ];
    (eventsDb.listWorkflowEvents as ReturnType<typeof mock>).mockResolvedValueOnce(orderedEvents);

    await workflowGetCommand('run-order', true, true, undefined, undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result.events).toEqual(orderedEvents);
  });

  it('emits the full metadata.approval (incl. completionSignaled) in --json for a paused interactive_loop run (#2074 E)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate-json',
      workflow_name: 'validate',
      status: 'paused',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          message: 'gate',
          iteration: 2,
          completionSignaled: true,
          signaledOutput: 'REPORT',
        },
      },
    });

    const code = await workflowGetCommand('run-gate-json', true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      metadata: { approval: { completionSignaled: boolean; signaledOutput: string } };
    };
    // The agent read surface: the C fields flow through the CLI --json dump unchanged.
    expect(parsed.metadata.approval.completionSignaled).toBe(true);
    expect(parsed.metadata.approval.signaledOutput).toBe('REPORT');
    expect(code).toBe(0);
  });

  it('prints a Gate line (human) for a paused interactive_loop run (#2074 E)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-gate-human',
      workflow_name: 'validate',
      status: 'paused',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          message: 'gate',
          iteration: 2,
          completionSignaled: true,
          signaledOutput: 'REPORT',
        },
      },
    });

    await workflowGetCommand('run-gate-human');

    expect(consoleSpy).toHaveBeenCalledWith(
      '  Gate:   awaiting approval — signal detected: yes (iteration 2)'
    );
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD (SKIPPED) — Story 3.3b Task 3 (state-mapping helper)
// and the `classifyRunError` helper referenced by Task 1's Dev Notes.
//
// Unlike every other Story 3.3b block in this file, these ARE `it.skip()`
// per this skill's red-phase rule ("Use it.skip() only when the target
// module, route, harness, or dependency seam does not exist yet"): Task 3
// is explicit new design work with "no prior art" and no established export
// name — there is nothing to import yet, not even under a guessable name.
// A static `import { mapWorkflowRunToContractState } from './workflow'`
// would throw a module-linking SyntaxError and crash every other test in
// this file (verified empirically), and a dynamic `import()` probe against
// a not-yet-decided name would just be a coin flip on the implementer's
// eventual naming, not a meaningful contract check. Skipping documents the
// exact expected table (Dev Notes "State Mapping") so the implementer can
// delete `.skip` and wire up the real import once Task 3 lands, rather than
// leaving a guessed, possibly-wrong red assertion in place.
//
// To activate: implement + export the mapping/classification helper(s) from
// `./workflow`, replace the `it.skip(...)` calls below with `it(...)`,
// and import the real function(s) at the top of each block.
// ---------------------------------------------------------------------------
describe('workflow.ts run-state → contract-state mapping helper (Story 3.3b Task 3)', () => {
  // 3.3B-UNIT-002 [P0] R-006
  it('3.3B-UNIT-002: status="pending" maps to { state: "pending", terminal: false }', () => {
    const result = mapWorkflowRunToContractState({ status: 'pending', metadata: {} });
    expect(result).toEqual({ state: 'pending', terminal: false });
  });

  // 3.3B-UNIT-003 [P0] R-006
  it('3.3B-UNIT-003: status="running" maps to { state: "running", terminal: false }', () => {
    const result = mapWorkflowRunToContractState({ status: 'running', metadata: {} });
    expect(result).toEqual({ state: 'running', terminal: false });
  });

  // 3.3B-UNIT-004 [P0] R-006
  it('3.3B-UNIT-004: paused + approval context (type !== "interactive_loop") maps to waiting-for-approval with actionRequired/gateRef', () => {
    const result = mapWorkflowRunToContractState({
      status: 'paused',
      metadata: { approval: { nodeId: 'n1', message: 'm' } },
    });
    expect(result.state).toBe('waiting-for-approval');
    expect(result.terminal).toBe(false);
    expect(result.actionRequired).toBe(true);
    expect(result.gateRef).toEqual({ gateId: 'n1', kind: 'human-decision' });
  });

  // 3.3B-UNIT-005 [P0] R-006
  it('3.3B-UNIT-005: paused + interactive-loop context maps to "paused" with NO human-decision gate', () => {
    const result = mapWorkflowRunToContractState({
      status: 'paused',
      metadata: { approval: { nodeId: 'n1', message: 'm', type: 'interactive_loop' } },
    });
    expect(result).toEqual({ state: 'paused', terminal: false });
  });

  it('3.3C-UNIT-STATE-001: paused + resolved approval gate maps to "paused" not "waiting-for-approval"', () => {
    const approved = mapWorkflowRunToContractState({
      status: 'paused',
      metadata: {
        approval: { nodeId: 'n1', message: 'm', resolved: 'approved' },
      },
    });
    expect(approved.state).toBe('paused');
    expect(approved.terminal).toBe(false);
    expect(approved.actionRequired).toBeUndefined();
    expect(approved.gateRef).toBeUndefined();

    const rejected = mapWorkflowRunToContractState({
      status: 'paused',
      metadata: {
        approval: { nodeId: 'n1', message: 'm', resolved: 'rejected' },
      },
    });
    expect(rejected.state).toBe('paused');
    expect(rejected.terminal).toBe(false);
    expect(rejected.actionRequired).toBeUndefined();
  });

  // 3.3B-UNIT-006 [P0] R-006
  it('3.3B-UNIT-006: paused + absent/malformed approval metadata conservatively maps to "paused"', () => {
    expect(mapWorkflowRunToContractState({ status: 'paused', metadata: {} })).toEqual({
      state: 'paused',
      terminal: false,
    });
    expect(
      mapWorkflowRunToContractState({
        status: 'paused',
        metadata: { approval: { nodeId: 'n1' } },
      })
    ).toEqual({ state: 'paused', terminal: false });
  });

  // 3.3B-UNIT-007 [P0] R-006,R-014
  it('3.3B-UNIT-007: completed/failed/cancelled all map terminal:true and never invent a "phase" field', () => {
    const completed = mapWorkflowRunToContractState({ status: 'completed', metadata: {} });
    expect(completed).toEqual({ state: 'completed', terminal: true });
    expect('phase' in completed).toBe(false);

    const failed = mapWorkflowRunToContractState({ status: 'failed', metadata: {} });
    expect(failed).toEqual({ state: 'failed', terminal: true });
    expect('phase' in failed).toBe(false);

    const cancelled = mapWorkflowRunToContractState({ status: 'cancelled', metadata: {} });
    expect(cancelled).toEqual({ state: 'cancelled', terminal: true });
    expect('phase' in cancelled).toBe(false);
  });

  // 3.3B-UNIT-030 [P1] R-006,R-018
  it('3.3B-UNIT-030: cancelled maps to terminal:true', () => {
    const result = mapWorkflowRunToContractState({ status: 'cancelled', metadata: {} });
    expect(result).toEqual({ state: 'cancelled', terminal: true });
  });
});

describe('workflow.ts classifyRunError helper (Story 3.3b Task 1)', () => {
  // 3.3B-UNIT-017 [P1] R-009,R-018
  it('3.3B-UNIT-017: classifies bad-flags/unknown-workflow/internal/timeout into the documented table', () => {
    expect(
      classifyRunError(new Error('--branch and --no-worktree are mutually exclusive.'))
    ).toEqual({
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      retryable: false,
      exitCode: 64,
    });
    expect(classifyRunError(new Error("Workflow 'foo' not found."))).toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
    expect(
      classifyRunError(
        new Error("Workflow 'team's-flow' not found.\n\nAvailable workflows:\n  - assist")
      )
    ).toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
    expect(
      classifyRunError(
        new Error("Workflow 'foo' not found. database relation 'workflow_runs' not found")
      )
    ).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
    expect(classifyRunError(new Error('some internal failure'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  it('RF-37: does not classify infrastructure not-found errors as missing workflow names', () => {
    expect(classifyRunError(new Error('Workflow database index not found during lookup'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
    expect(classifyRunError(new Error('workflow configuration file not found on disk'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  it('RF-36: classifies non-boolean json option values as malformed requests', () => {
    expect(classifyRunError(new Error('--json must be a boolean flag'))).toEqual({
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      retryable: false,
      exitCode: 64,
    });
  });

  // 3.3B-UNIT-029 [P1] R-009,R-018
  it('3.3B-UNIT-029: a timeout-shaped error classifies as COMMAND_TIMEOUT', () => {
    const err = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
    expect(classifyRunError(err)).toEqual({
      code: 'COMMAND_TIMEOUT',
      category: 'timeout',
      retryable: true,
      exitCode: 69,
    });
  });
});

describe('run-id prefix resolution (short ids from `workflow runs`)', () => {
  const FULL_ID = '0b1ee8da-1111-2222-3333-444455556666';
  const CODEBASE = { id: 'cb-1', name: 'proj', default_cwd: '/repo' };
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockClear();
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockClear();
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('resolves a unique short prefix to the full run id (get)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: FULL_ID },
    ]);
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: FULL_ID,
      workflow_name: 'implement',
      status: 'completed',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });

    const code = await workflowGetCommand('0b1ee8da', true, undefined, '/repo');

    expect(workflowDb.findWorkflowRunsByIdPrefix).toHaveBeenCalledWith('0b1ee8da', 'cb-1');
    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith(FULL_ID);
    expect(code).toBe(0);
  });

  it('skips codebase and prefix lookups entirely for a full UUID', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: FULL_ID,
      workflow_name: 'implement',
      status: 'completed',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });

    const code = await workflowGetCommand(FULL_ID, true, undefined, '/repo');

    expect(codebaseDb.findCodebaseByDefaultCwd).not.toHaveBeenCalled();
    expect(workflowDb.findWorkflowRunsByIdPrefix).not.toHaveBeenCalled();
    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith(FULL_ID);
    expect(code).toBe(0);
  });

  it('skips lookups for a 32-char undashed full id (SQLite id shape)', async () => {
    const undashedId = 'e1f890f05e5bab0d906921593bf500c4';
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: undashedId,
      workflow_name: 'implement',
      status: 'completed',
      working_path: '/tmp/wt',
      started_at: new Date(),
      metadata: {},
    });

    const code = await workflowGetCommand(undashedId, true, undefined, '/repo');

    expect(codebaseDb.findCodebaseByDefaultCwd).not.toHaveBeenCalled();
    expect(workflowDb.findWorkflowRunsByIdPrefix).not.toHaveBeenCalled();
    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith(undashedId);
    expect(code).toBe(0);
  });

  it('throws on an ambiguous prefix (human mode)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: '0b1ee8da-1111-2222-3333-444455556666' },
      { id: '0b1ee8da-9999-8888-7777-666655554444' },
    ]);

    await expect(workflowResumeCommand('0b1ee8da', undefined, '/repo')).rejects.toThrow(
      'matches more than one run'
    );
  });

  it('emits {ok:false} JSON on an ambiguous prefix (never throws in --json)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: '0b1ee8da-1111-2222-3333-444455556666' },
      { id: '0b1ee8da-9999-8888-7777-666655554444' },
    ]);

    await workflowAbandonCommand('0b1ee8da', true, '/repo');

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      ok: boolean;
      runId: string;
      action: string;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.runId).toBe('0b1ee8da');
    expect(parsed.action).toBe('abandon');
    expect(parsed.error).toContain('matches more than one run');
  });

  it('passes the id through unchanged when cwd is not a registered project', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('deadbeef', true, undefined, '/somewhere');

    expect(workflowDb.findWorkflowRunsByIdPrefix).not.toHaveBeenCalled();
    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith('deadbeef');
    expect(code).toBe(78);
  });

  it('passes the id through when the prefix matches nothing in this project', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([]);
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('deadbeef', true, undefined, '/repo');

    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith('deadbeef');
    expect(code).toBe(78);
  });

  it('abandons by short prefix and reports the resolved full id', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: FULL_ID },
    ]);
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: FULL_ID,
      workflow_name: 'implement',
      status: 'running',
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowAbandonCommand('0b1ee8da', true, '/repo');

    expect(workflowDb.cancelWorkflowRun).toHaveBeenCalledWith(FULL_ID);
    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      ok: boolean;
      runId: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.runId).toBe(FULL_ID);
  });

  it('approves by short prefix and reports the resolved full id', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: FULL_ID },
    ]);
    const pausedRun = {
      id: FULL_ID,
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce(pausedRun);

    await workflowApproveCommand('0b1ee8da', 'lgtm', true, undefined, '/repo');

    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith(FULL_ID);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(true);
    expect((envelope.workflowRunRef as Record<string, unknown>).runId).toBe(FULL_ID);
  });

  it('rejects by short prefix and reports the resolved full id', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(
      CODEBASE
    );
    (workflowDb.findWorkflowRunsByIdPrefix as ReturnType<typeof mock>).mockResolvedValueOnce([
      { id: FULL_ID },
    ]);
    const pausedRun = {
      id: FULL_ID,
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce({ ...pausedRun, status: 'cancelled' });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowRejectCommand('0b1ee8da', 'nope', true, undefined, '/repo');

    expect(workflowDb.getWorkflowRun).toHaveBeenCalledWith(FULL_ID);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(true);
    expect((envelope.workflowRunRef as Record<string, unknown>).runId).toBe(FULL_ID);
  });

  it('skips resolution when no cwd is provided (exact lookup only)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const code = await workflowGetCommand('deadbeef', true);

    expect(codebaseDb.findCodebaseByDefaultCwd).not.toHaveBeenCalled();
    expect(workflowDb.findWorkflowRunsByIdPrefix).not.toHaveBeenCalled();
    expect(code).toBe(78);
  });
});

describe('workflowRunsCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('scopes to the cwd-resolved codebase id', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-proj',
      name: 'owner/repo',
      default_cwd: '/test/path',
    });
    const listSpy = workflowDb.listDashboardRuns as ReturnType<typeof mock>;
    listSpy.mockClear();
    listSpy.mockResolvedValueOnce({ runs: [], total: 0, counts: EMPTY_COUNTS });

    await workflowRunsCommand('/test/path', {});

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-proj', limit: 20 })
    );
  });

  it('prints the unregistered-cwd note and lists globally when no codebase resolves', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [],
      total: 0,
      counts: EMPTY_COUNTS,
    });

    await workflowRunsCommand('/unregistered', {});

    expect(consoleSpy).toHaveBeenCalledWith('(not a registered project — showing all runs)');
  });

  it('emits the full dashboard result as JSON', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [
        {
          id: 'r1',
          workflow_name: 'assist',
          status: 'completed',
          current_step_name: null,
          total_steps: null,
          started_at: new Date(),
        },
      ],
      total: 1,
      counts: { ...EMPTY_COUNTS, all: 1, completed: 1 },
    });

    await workflowRunsCommand('/test/path', { json: true });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      runs: unknown[];
      total: number;
      scopeFallback: boolean;
    };
    expect(parsed.total).toBe(1);
    expect(parsed.runs).toHaveLength(1);
    // codebase did not resolve → result is a global fallback, flagged for agents
    expect(parsed.scopeFallback).toBe(true);
  });

  it('marks scopeFallback false in --json when the project scope resolves', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-proj',
      name: 'owner/repo',
      default_cwd: '/test/path',
    });
    (workflowDb.listDashboardRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      runs: [],
      total: 0,
      counts: EMPTY_COUNTS,
    });

    await workflowRunsCommand('/test/path', { json: true });

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as { scopeFallback: boolean };
    expect(parsed.scopeFallback).toBe(false);
  });

  it('passes --all (no codebase scope) plus --status/--limit through to listDashboardRuns', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const findSpy = codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>;
    findSpy.mockClear();
    const listSpy = workflowDb.listDashboardRuns as ReturnType<typeof mock>;
    listSpy.mockClear();
    listSpy.mockResolvedValueOnce({ runs: [], total: 0, counts: EMPTY_COUNTS });

    await workflowRunsCommand('/test/path', { all: true, status: 'running', limit: 5 });

    // --all skips the codebase lookup entirely
    expect(findSpy).not.toHaveBeenCalled();
    const arg = listSpy.mock.calls[0][0] as { codebaseId?: string; status?: string; limit: number };
    expect(arg.codebaseId).toBeUndefined();
    expect(arg.status).toBe('running');
    expect(arg.limit).toBe(5);
  });

  it('throws on an invalid --status', async () => {
    await expect(workflowRunsCommand('/test/path', { status: 'bogus' })).rejects.toThrow(
      /Invalid --status 'bogus'/
    );
  });

  it('emits {ok:false} JSON (never throws) on an invalid --status in --json mode', async () => {
    await workflowRunsCommand('/test/path', { status: 'bogus', json: true });

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Invalid --status 'bogus'");
  });
});

describe('write command --json output', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('abandon --json emits a structured cancelled result', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-ab',
      workflow_name: 'implement',
      status: 'running',
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowAbandonCommand('run-ab', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(firstJsonPayload(stdoutSpy))).toEqual({
      ok: true,
      runId: 'run-ab',
      action: 'abandon',
      status: 'cancelled',
      workflowName: 'implement',
    });
  });

  it('abandon --json emits {ok:false} on a not-found run (never throws)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowAbandonCommand('missing', true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Workflow run not found');
  });

  it('approve --json records the decision and does NOT auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    const pausedRun = {
      id: 'run-ap',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    };
    const approvedRun = {
      ...pausedRun,
      metadata: { approval: { nodeId: 'gate', message: 'ok?', resolved: 'approved' } },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce(approvedRun);
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    const exitCode = await workflowApproveCommand('run-ap', 'lgtm', true);

    expect(exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-ap',
      workflowName: 'implement',
    });
    expect(envelope.result).toMatchObject({
      operation: 'approve',
      decision: { outcome: 'approved', recorded: true },
      resumable: true,
      state: 'paused',
      terminal: false,
    });
    // No inline resume → workflowRunCommand (whose first step is discovery) never ran
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('approve --json includes live supervisor continuation for plannotator gates', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const pausedRun = {
      id: 'run-plannotator-json',
      workflow_name: 'review-plan',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'gate',
          message: 'Review',
          gateId: 'gate-1',
        },
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce({
        ...pausedRun,
        metadata: {
          approval: { ...pausedRun.metadata.approval, resolved: 'approved' },
        },
      });

    await workflowApproveCommand('run-plannotator-json', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      result: { continuation: string };
    };
    expect(envelope.result.continuation).toBe('live_plannotator_supervisor');
  });

  it('approve --json success on interactive loop gate emits same envelope shape', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const loopRun = {
      id: 'run-loop',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {
        approval: { nodeId: 'loop-node', type: 'interactive_loop', message: 'feedback?' },
      },
    };
    const resolvedLoopRun = {
      ...loopRun,
      metadata: {
        approval: {
          nodeId: 'loop-node',
          type: 'interactive_loop',
          message: 'feedback?',
          resolved: 'approved',
        },
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(loopRun)
      .mockResolvedValueOnce(resolvedLoopRun);

    await workflowApproveCommand('run-loop', 'looks good', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('approve');
    expect((result.decision as Record<string, unknown>).outcome).toBe('approved');
    expect((result.decision as Record<string, unknown>).recorded).toBe(true);
    expect(result.state).toBe('paused');
    expect(result.terminal).toBe(false);
  });

  it('approve --json error: run not paused → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-completed',
      workflow_name: 'implement',
      status: 'completed',
      metadata: {},
    });

    const exitCode = await workflowApproveCommand('run-completed', undefined, true);

    expect(exitCode).toBe(78);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.approve');
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('approve --json error: already resolved → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resolved',
      workflow_name: 'implement',
      status: 'paused',
      metadata: { approval: { nodeId: 'gate', message: 'ok?', resolved: 'approved' } },
    });

    await workflowApproveCommand('run-resolved', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  it('approve --json error: missing approval context → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    // approveWorkflow will throw 'missing approval context' when the run is paused
    // but has no approval metadata
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-ctx',
      workflow_name: 'implement',
      status: 'paused',
      metadata: {},
    });

    await workflowApproveCommand('run-no-ctx', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
  });

  it('approve --json error: run not found → WORKFLOW_RUN_NOT_FOUND', async () => {
    // resolveRunIdArg falls through to approveWorkflow which calls getWorkflowRun
    // and gets null → throws 'Workflow run not found: ...'
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowApproveCommand('nonexistent-id', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('approve --json error: DB failure on post-approval fetch → INTERNAL_ERROR', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    // First call: approveWorkflow's internal lookup succeeds
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-db-fail',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    });
    // Second call: post-approval fetch fails
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('DB transient error')
    );

    const exitCode = await workflowApproveCommand('run-db-fail', undefined, true);

    expect(exitCode).toBe(70);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  it('approve --json error: post-approval readback returns null → INTERNAL_ERROR (not RUN_NOT_FOUND)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    // First call: approveWorkflow's internal lookup succeeds
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-null-readback',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    });
    // Second call: post-approval fetch returns null (row vanished)
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const exitCode = await workflowApproveCommand('run-null-readback', undefined, true);

    expect(exitCode).toBe(70);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  it('approve --json error: timeout → COMMAND_TIMEOUT envelope (fail-closed)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const timeoutErr = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(timeoutErr);

    const exitCode = await workflowApproveCommand('run-timeout', undefined, true);

    expect(exitCode).toBe(69);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.category).toBe('timeout');
    expect(error.retryable).toBe(true);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(69);
  });

  it('reject --json error: timeout → COMMAND_TIMEOUT envelope (fail-closed)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const timeoutErr = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(timeoutErr);

    const exitCode = await workflowRejectCommand('run-timeout', 'nope', true);

    expect(exitCode).toBe(69);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.category).toBe('timeout');
    expect(error.retryable).toBe(true);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(69);
  });

  it('reject --json success (cancelled) emits workflow.reject envelope', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    const pausedRun = {
      id: 'run-rj',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      user_message: 'go',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce({ ...pausedRun, status: 'cancelled' });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowRejectCommand('run-rj', 'nope', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(true);
    expect(envelope.workflowRunRef).toMatchObject({
      provider: 'archon',
      runId: 'run-rj',
      workflowName: 'implement',
    });
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('reject');
    expect((result.decision as Record<string, unknown>).outcome).toBe('rejected');
    expect((result.decision as Record<string, unknown>).recorded).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.resumable).toBe(false);
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('reject --json success (rework, not cancelled) emits resumable:true', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const pausedRun = {
      id: 'run-rj-rework',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {
        approval: {
          nodeId: 'gate',
          message: 'ok?',
          onRejectPrompt: 'Fix the issues',
          onRejectMaxAttempts: 3,
          rejectionCount: 0,
        },
      },
    };
    const rejectedRun = {
      ...pausedRun,
      metadata: {
        approval: {
          nodeId: 'gate',
          message: 'ok?',
          onRejectPrompt: 'Fix the issues',
          onRejectMaxAttempts: 3,
          rejectionCount: 0,
          resolved: 'rejected',
        },
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce(rejectedRun);

    await workflowRejectCommand('run-rj-rework', 'needs work', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('workflow.reject');
    const result = envelope.result as Record<string, unknown>;
    expect(result.cancelled).toBe(false);
    expect(result.resumable).toBe(true);
    expect(result.state).toBe('paused');
    expect(result.terminal).toBe(false);
  });

  it('reject --json success (max attempts reached) emits cancelled:true, maxAttemptsReached:true', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const pausedRun = {
      id: 'run-rj-max',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {
        rejection_count: 2,
        approval: {
          nodeId: 'gate',
          message: 'ok?',
          onRejectPrompt: 'Fix the issues',
          onRejectMaxAttempts: 3,
        },
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pausedRun)
      .mockResolvedValueOnce({ ...pausedRun, status: 'cancelled' });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowRejectCommand('run-rj-max', 'still bad', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.cancelled).toBe(true);
    expect(result.maxAttemptsReached).toBe(true);
    expect(result.resumable).toBe(false);
  });

  it('reject --json error: run not paused → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-completed',
      workflow_name: 'implement',
      status: 'completed',
      metadata: {},
    });

    const exitCode = await workflowRejectCommand('run-completed', undefined, true);

    expect(exitCode).toBe(78);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.reject');
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('reject --json error: already resolved → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resolved',
      workflow_name: 'implement',
      status: 'paused',
      metadata: { approval: { nodeId: 'gate', message: 'ok?', resolved: 'rejected' } },
    });

    await workflowRejectCommand('run-resolved', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  it('reject --json error: missing approval context → UNEXPECTED_STATE', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-ctx-rj',
      workflow_name: 'implement',
      status: 'paused',
      metadata: {},
    });

    const exitCode = await workflowRejectCommand('run-no-ctx-rj', undefined, true);

    expect(exitCode).toBe(78);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    expect(envelope.command).toBe('workflow.reject');
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('reject --json error: run not found → WORKFLOW_RUN_NOT_FOUND', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowRejectCommand('nonexistent-id', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  it('reject --json error: post-rejection readback returns null → INTERNAL_ERROR (not RUN_NOT_FOUND)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    const pausedRun = {
      id: 'run-null-reject',
      workflow_name: 'implement',
      status: 'paused' as const,
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      conversation_id: 'conv',
      metadata: { approval: { nodeId: 'gate', message: 'ok?' } },
    };
    // First call: rejectWorkflow's internal lookup succeeds
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(pausedRun);
    // Second call: post-rejection fetch returns null
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    const exitCode = await workflowRejectCommand('run-null-reject', undefined, true);

    expect(exitCode).toBe(70);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  it('resume --json validates resumability without executing (executed:false)', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-rs',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      metadata: {},
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowResumeCommand('run-rs', true);

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(parsed.command).toBe('workflow.resume');
    expect(parsed.success).toBe(true);
    const result = parsed.result as Record<string, unknown>;
    expect(result.operation).toBe('resume');
    expect(result.executed).toBe(false);
    expect(result.validated).toBe(true);
    expect(result.resumable).toBe(true);
    expect(discoverSpy).not.toHaveBeenCalled();
  });
});

describe('workflowRunCommand — detach', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  function createDetachedChildFixture(pid: number | null = 12345): {
    child: ReturnType<typeof mockChildProcessSpawn>;
    unref: ReturnType<typeof mock>;
    emit: (event: 'exit' | 'error', ...args: unknown[]) => void;
  } {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const unref = mock(() => undefined);
    const child = {
      pid: pid ?? undefined,
      on: mock(() => child),
      once: mock((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
        return child;
      }),
      off: mock((event: string) => {
        handlers.delete(event);
        return child;
      }),
      unref,
    };

    return {
      child: child as unknown as ReturnType<typeof mockChildProcessSpawn>,
      unref,
      emit: (event, ...args) => handlers.get(event)?.(...args),
    };
  }

  async function finishStartupWindow(
    commandPromise: Promise<void>,
    expectedSpawnCount = 1
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < 20 && mockChildProcessSpawn.mock.calls.length < expectedSpawnCount;
      attempt++
    ) {
      await Promise.resolve();
    }
    expect(mockChildProcessSpawn).toHaveBeenCalledTimes(expectedSpawnCount);
    jest.advanceTimersByTime(500);
    await commandPromise;
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockChildProcessSpawn.mockReset();
    mockChildProcessSpawn.mockImplementation(() => createDetachedChildFixture().child);
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockReset();
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve(null)
    );
    (codebaseDb.findCodebaseByPathPrefix as ReturnType<typeof mock>).mockReset();
    (codebaseDb.findCodebaseByPathPrefix as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve(null)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('spawns a detached child (minus --detach, plus --branch/--conversation-id) and does NOT await executeWorkflow', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const { executeWorkflow } = await import('@archon/workflows/executor');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    // Force the log-file path to fall back to 'ignore' so the test writes no files
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });

    const execBefore = (executeWorkflow as ReturnType<typeof mock>).mock.calls.length;
    const child = createDetachedChildFixture();
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];

    // Capture call data BEFORE mockReset() — resetting clears recorded calls.
    let spawnCallCount = 0;
    let spawnCmd: string[] = [];
    let spawnOpts: { cwd: string; detached?: boolean; windowsHide?: boolean } | undefined;
    try {
      const commandPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
      });
      await finishStartupWindow(commandPromise);
      spawnCallCount = mockChildProcessSpawn.mock.calls.length;
      const call = mockChildProcessSpawn.mock.calls[0];
      if (call) {
        const exec = call[0] as string;
        const args = (call[1] ?? []) as string[];
        spawnCmd = [exec, ...args];
        spawnOpts = call[2] as
          | { cwd: string; detached?: boolean; windowsHide?: boolean }
          | undefined;
      }
    } finally {
      process.argv = savedArgv;
    }

    expect(spawnCallCount).toBe(1);
    // The actual Windows fix: the child must be spawned into its own process
    // group, or the launching shell's teardown kills it (~1s in).
    expect(spawnOpts?.detached).toBe(true);
    expect(spawnOpts?.windowsHide).toBe(true);
    expect(spawnCmd).not.toContain('--detach');
    expect(spawnCmd).toContain('--branch');
    expect(spawnCmd).toContain('--conversation-id');
    expect(spawnCmd).toContain('--cwd');
    const cwdIdx = spawnCmd.indexOf('--cwd');
    expect(spawnCmd[cwdIdx + 1]).toBe('/test/path');
    expect(spawnOpts?.cwd).toBe('/test/path');
    // Generated branch is `assist-<timestamp>`
    const branchIdx = spawnCmd.indexOf('--branch');
    expect(spawnCmd[branchIdx + 1]).toMatch(/^assist-\d+$/);
    // executeWorkflow must NOT run in the detaching parent
    const execAfter = (executeWorkflow as ReturnType<typeof mock>).mock.calls.length;
    expect(execAfter).toBe(execBefore);
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("Started 'assist' in the background.");
  });

  // #2213 — the headline `--json` claim. `writeJsonLine` (not console.log) is
  // what emits the payload, and it is only reached on this `--detach` branch,
  // so this is the only place the "stdout stays exactly the payload" guarantee
  // can actually be observed. Asserts the captured stdout still JSON.parse()s
  // while the warning went to stderr.
  it('keeps stdout a parseable JSON payload while warning on stderr', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource({ name: 'assist', description: 'Help' }, 'project', [
          "Node 'plan': unknown key 'interactive' will be ignored.",
        ]),
      ],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });

    const child = createDetachedChildFixture();
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = [
      'bun',
      '/abs/cli.ts',
      'workflow',
      'run',
      'assist',
      'hello',
      '--detach',
      '--json',
    ];

    try {
      const commandPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
        json: true,
      });
      await finishStartupWindow(commandPromise);
    } finally {
      process.argv = savedArgv;
    }

    // stdout: exactly one line, and it parses.
    const payload = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      ok: boolean;
      action: string;
      workflow: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('run');
    expect(payload.workflow).toBe('assist');
    // The warning reached the user — on stderr, not in the payload.
    expect(warnSpy).toHaveBeenCalledWith("Warning: 'assist' declares keys the engine ignores:");
    expect(JSON.stringify(payload)).not.toContain('unknown key');
    warnSpy.mockRestore();
  });

  it('does NOT pin a --branch on the detached child for a registered folder project', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    const codebaseDb = await import('@archon/core/db/codebases');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });
    // Detach folder probe: exact miss, then path-prefix resolves a folder project.
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (codebaseDb.findCodebaseByPathPrefix as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'platform',
      default_cwd: '/test/path',
      kind: 'folder',
    });

    const child = createDetachedChildFixture();
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];
    let spawnCmd: string[] = [];
    const callsBefore = mockChildProcessSpawn.mock.calls.length;
    try {
      const commandPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
      });
      await finishStartupWindow(commandPromise);
      const call = mockChildProcessSpawn.mock.calls[callsBefore];
      if (call) {
        const exec = call[0] as string;
        const args = (call[1] ?? []) as string[];
        spawnCmd = [exec, ...args];
      }
    } finally {
      process.argv = savedArgv;
    }

    expect(spawnCmd).not.toContain('--detach');
    expect(spawnCmd).not.toContain('--branch'); // folder project → no worktree branch
    expect(spawnCmd).toContain('--conversation-id');
  });

  it('--detach --json emits a structured ack', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });
    const child = createDetachedChildFixture();
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = [
      'bun',
      '/abs/cli.ts',
      'workflow',
      'run',
      'assist',
      'hello',
      '--detach',
      '--json',
    ];

    try {
      const commandPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
        json: true,
      });
      await finishStartupWindow(commandPromise);
    } finally {
      process.argv = savedArgv;
    }

    const parsed = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ok: true, action: 'run', detached: true, workflow: 'assist' });
    expect(typeof parsed.conversationId).toBe('string');
  });

  it('rejects an immediate non-zero child exit with the log tail and no success ack', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    const tempHome = mkdtempSync(join(tmpdir(), 'archon-detached-failure-'));
    const conversationId = 'cli-detached-failure';
    const logPath = join(tempHome, 'logs', `detached-run-${conversationId}.log`);
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => tempHome);
    const child = createDetachedChildFixture();
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];

    try {
      const commandPromise = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
        json: true,
        conversationId,
      });
      for (
        let attempt = 0;
        attempt < 20 && mockChildProcessSpawn.mock.calls.length === 0;
        attempt++
      ) {
        await Promise.resolve();
      }
      expect(mockChildProcessSpawn).toHaveBeenCalledTimes(1);
      appendFileSync(logPath, 'database unavailable during startup\n');
      child.emit('exit', 1, null);

      await expect(commandPromise).rejects.toThrow(
        /exit code 1[\s\S]*database unavailable during startup/
      );
    } finally {
      process.argv = savedArgv;
      rmSync(tempHome, { recursive: true, force: true });
    }

    expect(child.unref).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('writes a delimiter for every invocation sharing a conversation id', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    const tempHome = mkdtempSync(join(tmpdir(), 'archon-detached-delimiters-'));
    const conversationId = 'cli-shared-conversation';
    const firstChild = createDetachedChildFixture();
    const secondChild = createDetachedChildFixture();
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>)
      .mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      })
      .mockResolvedValueOnce({
        workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
        errors: [],
      });
    (paths.getArchonHome as ReturnType<typeof mock>)
      .mockImplementationOnce(() => tempHome)
      .mockImplementationOnce(() => tempHome);
    mockChildProcessSpawn
      .mockReturnValueOnce(firstChild.child)
      .mockReturnValueOnce(secondChild.child);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];

    try {
      const firstRun = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
        conversationId,
      });
      await finishStartupWindow(firstRun);
      const secondRun = workflowRunCommand('/test/path', 'assist', 'hello', {
        detach: true,
        conversationId,
      });
      await finishStartupWindow(secondRun, 2);

      const log = readFileSync(
        join(tempHome, 'logs', `detached-run-${conversationId}.log`),
        'utf8'
      );
      const delimiters = log
        .split('\n')
        .filter(line => line.startsWith(`--- detached workflow invocation: ${conversationId} at `));
      expect(delimiters).toHaveLength(2);
    } finally {
      process.argv = savedArgv;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('throws (no false success ack) when the detached child fails to spawn', async () => {
    const { discoverWorkflowsWithConfig } = await import('@archon/workflows/workflow-discovery');
    const paths = await import('@archon/paths');
    (discoverWorkflowsWithConfig as ReturnType<typeof mock>).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'assist', description: 'Help' })],
      errors: [],
    });
    (paths.getArchonHome as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new Error('no home in test');
    });
    // Node's spawn does not throw synchronously on a bad executable — the only
    // synchronous failure signal is an undefined pid.
    const child = createDetachedChildFixture(null);
    mockChildProcessSpawn.mockReturnValueOnce(child.child);
    const savedArgv = process.argv;
    process.argv = ['bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach'];

    try {
      await expect(
        workflowRunCommand('/test/path', 'assist', 'hello', { detach: true })
      ).rejects.toThrow(/Failed to start detached workflow child/);
    } finally {
      process.argv = savedArgv;
    }
    // The success ack must never have been printed.
    const logged = consoleSpy.mock.calls.map(call => String(call[0]));
    expect(logged).not.toContain("Started 'assist' in the background.");
  });
});

describe('buildDetachedRunCmd', () => {
  // BUNDLED_IS_BINARY is a module-level const (mocked false), so the binary
  // branch is unreachable through spawnDetachedWorkflowRun — exercise both
  // branches directly via the pure builder.

  it('dev mode: keeps [execPath, entryScript], slices argv(2), drops --detach/--json', () => {
    const cmd = buildDetachedRunCmd(
      false,
      '/path/to/bun',
      ['/path/to/bun', '/abs/cli.ts', 'workflow', 'run', 'assist', 'hello', '--detach', '--json'],
      '/abs/cwd',
      ['--branch', 'assist-123', '--conversation-id', 'cli-1']
    );

    expect(cmd[0]).toBe('/path/to/bun');
    expect(cmd[1]).toBe('/abs/cli.ts');
    expect(cmd).not.toContain('--detach');
    expect(cmd).not.toContain('--json');
    expect(cmd).toContain('assist');
    // --cwd pinned absolute, then extra flags
    const cwdIdx = cmd.indexOf('--cwd');
    expect(cmd[cwdIdx + 1]).toBe('/abs/cwd');
    expect(cmd).toContain('--branch');
    expect(cmd).toContain('--conversation-id');
  });

  // A Bun single-file executable's argv is NOT [binary, ...userArgs]. Bun
  // injects a virtual entry path at argv[1] and reports argv[0] as 'bun':
  //   ['bun', '/$bunfs/root/archon', 'workflow', 'run', ...]
  // Verified against a real `bun build --compile` artifact. The previous
  // fixture modelled a compiled argv with no argv[1] at all, which is why
  // #2248 (detached child dies with `Unknown command: B:/~BUN/root/...`)
  // shipped green.
  // `--input` is the first repeatable flag in the tree (#2554). Nothing here handles
  // repetition specially — argv is forwarded verbatim — so this pins the property a
  // future change to the argv rebuild could silently break, turning a detached run into
  // one that starts with its inputs missing instead of failing.
  it('forwards every repeated --input to the detached child', () => {
    const cmd = buildDetachedRunCmd(
      false,
      '/path/to/bun',
      [
        '/path/to/bun',
        '/abs/cli.ts',
        'workflow',
        'run',
        'review-block',
        '--input',
        'diff=D1',
        '--input',
        'style=terse',
        '--detach',
      ],
      '/abs/cwd',
      []
    );

    expect(cmd.filter(arg => arg === '--input')).toHaveLength(2);
    expect(cmd).toContain('diff=D1');
    expect(cmd).toContain('style=terse');
    expect(cmd).not.toContain('--detach');
  });

  it('binary mode: uses [execPath] only (no duplicated entry arg), drops the Bun SFE virtual argv[1]', () => {
    const cmd = buildDetachedRunCmd(
      true,
      '/usr/local/bin/archon',
      ['bun', '/$bunfs/root/archon', 'workflow', 'run', 'assist', 'hello', '--detach', '--json'],
      '/abs/cwd',
      ['--branch', 'assist-123']
    );

    expect(cmd[0]).toBe('/usr/local/bin/archon');
    // The binary path must appear exactly once — never duplicated as argv[1].
    expect(cmd.filter(arg => arg === '/usr/local/bin/archon')).toHaveLength(1);
    // The virtual entry path must never reach the child: cli.ts parses
    // process.argv.slice(2), so a leaked argv[1] becomes the child's command.
    expect(cmd.some(arg => arg.includes('$bunfs'))).toBe(false);
    expect(cmd[1]).toBe('workflow');
    expect(cmd).not.toContain('--detach');
    expect(cmd).not.toContain('--json');
    const cwdIdx = cmd.indexOf('--cwd');
    expect(cmd[cwdIdx + 1]).toBe('/abs/cwd');
    expect(cmd.slice(cwdIdx + 2)).toEqual(['--branch', 'assist-123']);
  });

  it('binary mode: drops the Windows Bun SFE virtual argv[1] (#2248 repro)', () => {
    const cmd = buildDetachedRunCmd(
      true,
      'C:\\Users\\dev\\archon.exe',
      [
        'bun',
        'B:/~BUN/root/archon-windows-x64.exe',
        'workflow',
        'run',
        'assist',
        'hello',
        '--detach',
        '--json',
      ],
      'C:\\checkout',
      ['--branch', 'assist-123']
    );

    expect(cmd[0]).toBe('C:\\Users\\dev\\archon.exe');
    // The exact token that appeared as `Unknown command: ...` in the report.
    expect(cmd).not.toContain('B:/~BUN/root/archon-windows-x64.exe');
    expect(cmd[1]).toBe('workflow');
    expect(cmd[2]).toBe('run');
  });
});

describe('workflowResumeCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowResumeCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should throw when run is not resumable', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'test',
      status: 'completed',
    });

    await expect(workflowResumeCommand('run-1')).rejects.toThrow(
      "Cannot resume run with status 'completed'"
    );
  });

  it('should print resume info and delegate to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
    });

    // workflowResumeCommand calls workflowRunCommand internally which needs many
    // mocks. The --resume execution flow is tested separately in workflowRunCommand tests.
    // Here we only verify the initial output by catching the downstream error.
    try {
      await workflowResumeCommand('run-1');
    } catch {
      // workflowRunCommand will fail due to missing mocks — that's fine
    }

    // Printed resume message before delegating to workflowRunCommand
    expect(consoleSpy).toHaveBeenCalledWith('Resuming workflow: implement');
    expect(consoleSpy).toHaveBeenCalledWith('Path: /tmp/test-worktree');
  });

  it('should throw when run has no working path', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-path',
      workflow_name: 'implement',
      status: 'failed',
      working_path: null,
    });

    await expect(workflowResumeCommand('run-no-path')).rejects.toThrow(
      'has no working path recorded'
    );
  });

  it('should pass codebase_id from run record to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
    });

    // Return a matching workflow so workflowRunCommand doesn't throw before codebase lookup
    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    // Simulate getCodebase returning the codebase found by ID
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout', // different from working_path
    });

    try {
      await workflowResumeCommand('run-1');
    } catch {
      // workflowRunCommand may fail on other mocks — that's fine
    }

    // getCodebase SHOULD have been called with the stored codebase_id
    expect(codebaseDb.getCodebase).toHaveBeenCalledWith('cb-existing');
  });

  it('fails loudly when getCodebase throws during resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-err',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-bad',
    });

    // getCodebase throws — simulates DB hiccup
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowResumeCommand('run-err')).rejects.toThrow(
      "Failed to load codebase 'cb-bad' for workflow run 'run-err'"
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_resume_codebase_lookup_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('fails loudly when codebase row is missing during resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-missing-codebase',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-missing',
    });
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowResumeCommand('run-missing-codebase')).rejects.toThrow(
      "references codebase 'cb-missing', but that codebase no longer exists"
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('should discover workflows from codebase.default_cwd, not working_path', async () => {
    // Regression test for #1663: when working_path is a worktree or workspace
    // clone that lacks the user's local workflow YAML, discovery must fall back
    // to codebase.default_cwd so the file is still found.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1663',
      workflow_name: 'my-approval-workflow',
      status: 'failed',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowResumeCommand('run-1663');
    } catch {
      // downstream failure is acceptable — we only need to assert the discovery cwd
    }

    // Discovery must use the codebase source path, NOT working_path
    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });

  it('should fall back to working_path for discovery when codebase_id is missing', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-codebase',
      workflow_name: 'legacy',
      status: 'failed',
      user_message: 'go',
      working_path: '/tmp/old-worktree',
      codebase_id: null,
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowResumeCommand('run-no-codebase');
    } catch {
      // downstream failure is acceptable
    }

    // No codebase → falls back to working_path (preserves existing behavior)
    expect(discoverSpy).toHaveBeenCalledWith('/tmp/old-worktree', expect.any(Function));
  });

  it('resolves the covering codebase by path prefix instead of re-registering the worktree working_path (#2127)', async () => {
    // Regression for #2127: resuming from a worktree working_path whose run has
    // no codebase_id must resolve the covering registered codebase via prefix
    // lookup (like `workflow run` does) — NOT fall through to auto-registration,
    // which trips the source-symlink guard for an already-covered path.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const { registerRepository } = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-2127',
      workflow_name: 'implement',
      status: 'failed',
      user_message: 'go',
      working_path: '/registered/root/worktrees/feat',
      codebase_id: null,
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    // Exact default_cwd match misses (worktree path != registered root); the
    // path-prefix lookup resolves the covering repo codebase.
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce(null);
    (codebaseDb.findCodebaseByPathPrefix as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-registered',
      name: 'coleam00/Archon',
      default_cwd: '/registered/root',
      kind: 'repo',
    });

    // If resolution regressed to auto-registration, this is what would run — and
    // fail with the source-symlink-mismatch guard the issue reported. Clear the
    // module-level mock's history first so the not-called assertion is scoped to
    // this test (other tests in the file exercise auto-registration).
    (registerRepository as ReturnType<typeof mock>).mockClear();
    (registerRepository as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('Source symlink at ~/.archon/workspaces/coleam00/Archon/source already points to')
    );

    // With the codebase resolved, resume proceeds past the registration step and
    // fails later on the absent resumable run (default findResumableRun → null).
    // The point is it does NOT surface the registration-failure error.
    await expect(workflowResumeCommand('run-2127')).rejects.toThrow('No resumable run found');

    expect(codebaseDb.findCodebaseByPathPrefix).toHaveBeenCalledWith(
      '/registered/root/worktrees/feat'
    );
    expect(registerRepository).not.toHaveBeenCalled();
  });
});

describe('workflowApproveCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowApproveCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should pass codebase_id from run record to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-1',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
      metadata: { approval: { nodeId: 'review-node' } },
    });

    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout',
    });

    try {
      await workflowApproveCommand('run-approve-1');
    } catch {
      // downstream failure is acceptable
    }

    expect(codebaseDb.getCodebase).toHaveBeenCalledWith('cb-existing');
  });

  it('fails loudly when codebase row is missing during approve auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-missing-codebase',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-missing',
      metadata: { approval: { type: 'approval', nodeId: 'review-node', message: 'Approve?' } },
    });
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowApproveCommand('run-approve-missing-codebase')).rejects.toThrow(
      "Approved but failed to resume workflow 'implement': Workflow run 'run-approve-missing-codebase' references codebase 'cb-missing', but that codebase no longer exists"
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('fails with recorded-approval recovery when getCodebase throws during approve auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-codebase-error',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-bad',
      metadata: { approval: { type: 'approval', nodeId: 'review-node', message: 'Approve?' } },
    });
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockRejectedValueOnce(new Error('database offline'));

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowApproveCommand('run-approve-codebase-error')).rejects.toThrow(
      "Approved but failed to resume workflow 'implement': Failed to load codebase 'cb-bad' for workflow run 'run-approve-codebase-error': database offline\n" +
        'Cannot safely discover workflows from the run worktree because project workflow files may be missing.\n' +
        'Fix the codebase lookup problem, then retry.\n' +
        "The approval was recorded. Run 'bun run cli workflow resume run-approve-codebase-error' to retry."
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_approve_codebase_lookup_failed'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-approve-codebase-error' }),
      'cli.workflow_approve_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith('/tmp/test-worktree', expect.any(Function));
  });

  it('should pass original platform conversation ID through to workflowRunCommand', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-conv',
      workflow_name: 'implement',
      status: 'paused',
      user_message: 'add auth',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
      conversation_id: 'db-uuid-original',
      metadata: { approval: { nodeId: 'review-node', message: 'Approve?' } },
    });

    // Return a conversation with the original platform ID
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'db-uuid-original',
      platform_type: 'cli',
      platform_conversation_id: 'cli-original-123',
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'implement' })],
      errors: [],
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-existing',
      name: 'owner/repo',
      default_cwd: '/path/to/main-checkout',
    });

    // Clear call history before our test so we can assert precisely
    (conversationsDb.getOrCreateConversation as ReturnType<typeof mock>).mockClear();

    try {
      await workflowApproveCommand('run-approve-conv');
    } catch {
      // downstream failure is acceptable — we only need to reach getOrCreateConversation
    }

    // Verify the original platform conversation ID was passed through
    expect(conversationsDb.getConversationById).toHaveBeenCalledWith('db-uuid-original');
    expect(conversationsDb.getOrCreateConversation).toHaveBeenCalledWith('cli', 'cli-original-123');
  });

  it('should discover workflows from codebase.default_cwd, not working_path', async () => {
    // Regression test for #1663: auto-resume after approve must look up the
    // workflow YAML in the source repo (codebase.default_cwd), not the
    // worktree/workspace working_path that may lack the file.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-1663',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
      metadata: { approval: { nodeId: 'gate', message: 'Approve?' } },
    });

    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowApproveCommand('run-approve-1663');
    } catch {
      // downstream failure is acceptable
    }

    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });

  it('records plannotator approval without starting a replacement execution', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const resolveGate = workflowDb.resolveApprovalGate as ReturnType<typeof mock>;
    resolveGate.mockReset();
    resolveGate.mockResolvedValue({ resolved: true });
    const getRun = workflowDb.getWorkflowRun as ReturnType<typeof mock>;
    getRun.mockReset();
    getRun.mockResolvedValue({
      id: 'run-plannotator-cli',
      workflow_name: 'review-plan',
      status: 'paused',
      user_message: 'review it',
      working_path: '/tmp/test-worktree',
      codebase_id: 'cb-existing',
      conversation_id: 'conv-1',
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review-node',
          message: 'Review',
          gateId: 'gate-1',
        },
      },
    });
    const discoverySpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverySpy.mockClear();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockClear();
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockClear();

    await workflowApproveCommand('run-plannotator-cli');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('live Plannotator supervisor will continue')
    );
    expect(discoverySpy).not.toHaveBeenCalled();
    expect(codebaseDb.getCodebase).not.toHaveBeenCalled();
    expect(conversationsDb.getConversationById).not.toHaveBeenCalled();
  });
});

describe('workflowReviewOpenCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.transitionPlannotatorGate as ReturnType<typeof mock>).mockReset();
    (workflowDb.transitionPlannotatorGate as ReturnType<typeof mock>).mockResolvedValue({
      outcome: 'updated',
      approval: {},
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('human mode dispatches the replacement exactly once from persisted run context', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const executor = await import('@archon/workflows/executor');
    const pausedRun = {
      id: 'run-review-open',
      workflow_name: 'review-plan',
      status: 'paused' as const,
      user_message: 'review it',
      working_path: '/persisted/worktree',
      codebase_id: 'cb-review',
      conversation_id: 'conv-review',
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review-node',
          message: 'Review',
          gateId: 'gate-old',
          document: '/persisted/worktree/review.html',
          phase: 'idle',
        },
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockReset();
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValue(pausedRun);
    (workflowDb.findResumableRun as ReturnType<typeof mock>).mockReset();
    (workflowDb.findResumableRun as ReturnType<typeof mock>).mockResolvedValue(pausedRun);
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockReset();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValue({
      id: 'cb-review',
      name: 'owner/repo',
      default_cwd: '/persisted/source',
    });
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockReset();
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-review',
      platform_type: 'cli',
      platform_conversation_id: 'cli-review',
    });
    const discover = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discover.mockReset();
    discover.mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'review-plan' })],
      errors: [],
    });
    const execute = executor.executeWorkflow as ReturnType<typeof mock>;
    execute.mockClear();
    (executor.hydrateResumableRun as ReturnType<typeof mock>).mockReset();
    (executor.hydrateResumableRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      preCreatedRun: pausedRun,
      priorCompletedNodes: new Map(),
      priorTokenUsage: { input: 0, output: 0 },
    });

    const exitCode = await workflowReviewOpenCommand('run-review-open', false, '/ambient/cwd');
    discover.mockResolvedValue({ workflows: [], errors: [] });

    expect(exitCode).toBe(0);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith('/persisted/source', expect.any(Function));
    expect(workflowDb.findResumableRun).toHaveBeenCalledWith('review-plan', '/persisted/worktree');
    expect(conversationsDb.getConversationById).toHaveBeenCalledWith('conv-review');
    expect(execute).toHaveBeenCalledTimes(1);
    const executeOptions = execute.mock.calls[0]?.[7] as
      | {
          preCreatedRun?: typeof pausedRun;
          priorCompletedNodes?: Map<string, string>;
        }
      | undefined;
    expect(executeOptions?.preCreatedRun).toBe(pausedRun);
    expect(executeOptions?.priorCompletedNodes?.size).toBe(0);
  });

  it('JSON mode records takeover without dispatch and tells callers how to resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');
    const executor = await import('@archon/workflows/executor');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-review-open-json',
      workflow_name: 'review-plan',
      status: 'paused',
      user_message: 'review it',
      working_path: '/persisted/worktree',
      codebase_id: null,
      conversation_id: 'conv-review',
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review-node',
          message: 'Review',
          gateId: 'gate-old',
          document: '/persisted/worktree/review.html',
        },
      },
    });
    const discover = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discover.mockClear();
    const execute = executor.executeWorkflow as ReturnType<typeof mock>;
    execute.mockClear();

    const exitCode = await workflowReviewOpenCommand('run-review-open-json', true);

    expect(exitCode).toBe(0);
    expect(discover).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(firstJsonPayload(stdoutSpy)) as {
      continuation: string;
      message: string;
    };
    expect(payload.continuation).toBe('caller_resume');
    expect(payload.message).toContain('workflow resume run-review-open-json');
  });
});

describe('workflowAbandonCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowAbandonCommand('missing-id')).rejects.toThrow(
      'Workflow run not found: missing-id'
    );
  });

  it('should throw when run is not abandonable', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'test',
      status: 'completed',
    });

    await expect(workflowAbandonCommand('run-1')).rejects.toThrow(
      "Cannot abandon run with status 'completed'"
    );
  });

  it('should abandon a running workflow', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'implement',
      status: 'running',
    });
    (workflowDb.cancelWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    await workflowAbandonCommand('run-1');

    expect(workflowDb.cancelWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(consoleSpy).toHaveBeenCalledWith('Abandoned workflow run: run-1');
  });
});

describe('workflowCleanupCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print deletion count when runs are deleted', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      count: 5,
    });

    await workflowCleanupCommand(30);

    expect(consoleSpy).toHaveBeenCalledWith('Deleted 5 workflow run(s) older than 30 days.');
  });

  it('should print no-op message when count is 0', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockResolvedValueOnce({
      count: 0,
    });

    await workflowCleanupCommand(7);

    expect(consoleSpy).toHaveBeenCalledWith('No workflow runs older than 7 days to clean up.');
  });

  it('should throw when deleteOldWorkflowRuns fails', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.deleteOldWorkflowRuns as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('disk full')
    );

    await expect(workflowCleanupCommand(7)).rejects.toThrow(
      'Failed to clean up workflow runs: disk full'
    );
  });
});

describe('workflowRejectCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should throw when run not found', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await expect(workflowRejectCommand('missing-id')).rejects.toThrow();
  });

  it('should throw when run is not paused', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-1',
      workflow_name: 'my-wf',
      status: 'running',
      metadata: {},
    });

    await expect(workflowRejectCommand('run-1')).rejects.toThrow('Cannot reject run');
  });

  it('cancels immediately when no on_reject configured', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-plain',
      workflow_name: 'plain-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    await workflowRejectCommand('run-plain', 'not good');

    // Terminal reject resolves + cancels atomically (#2113); the audit event
    // rides the same transaction (#2146).
    expect(workflowDb.resolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-plain',
      { nodeId: 'gate', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'gate',
          data: { decision: 'rejected', reason: 'not good' },
        },
      ]
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected and cancelled'));
  });

  it('updates metadata and auto-resumes when on_reject configured and under limit', async () => {
    const workflowDb = await import('@archon/core/db/workflows');

    const runData = {
      id: 'run-on-reject',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);

    try {
      await workflowRejectCommand('run-on-reject', 'needs work');
    } catch {
      // downstream workflowRunCommand failure is acceptable in this unit test
    }

    // Stays 'paused' (no status write) — rework staged atomically via the CAS on
    // the approval context (#2075/#2113), with the audit event in the same
    // transaction (#2146)
    expect(workflowDb.resolveApprovalGate).toHaveBeenCalledWith(
      'run-on-reject',
      { nodeId: 'gate', gateId: undefined },
      {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
          resolved: 'rejected',
        },
        rejection_reason: 'needs work',
        rejection_count: 1,
      },
      [
        {
          event_type: 'approval_received',
          step_name: 'gate',
          data: { decision: 'rejected', reason: 'needs work' },
        },
      ]
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected workflow'));
  });

  it('should pass original platform conversation ID through on reject-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const conversationsDb = await import('@archon/core/db/conversations');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-conv',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      conversation_id: 'db-uuid-reject',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    // rejectWorkflow reads the run twice internally (getRunOrThrow + updateWorkflowRun check)
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);

    // Return a conversation with the original platform ID
    (conversationsDb.getConversationById as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'db-uuid-reject',
      platform_type: 'cli',
      platform_conversation_id: 'cli-reject-456',
    });

    (
      workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>
    ).mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'my-wf' })],
      errors: [],
    });

    // Clear call history before our test so we can assert precisely
    (conversationsDb.getOrCreateConversation as ReturnType<typeof mock>).mockClear();

    try {
      await workflowRejectCommand('run-reject-conv', 'needs work');
    } catch {
      // downstream workflowRunCommand failure is acceptable — we only need to reach getOrCreateConversation
    }

    // Verify the original platform conversation ID was passed through
    expect(conversationsDb.getConversationById).toHaveBeenCalledWith('db-uuid-reject');
    expect(conversationsDb.getOrCreateConversation).toHaveBeenCalledWith('cli', 'cli-reject-456');
  });

  it('cancels when max attempts reached', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const core = await import('@archon/core');

    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-max',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: '/repo',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 2,
      },
    });
    (core.createWorkflowStore as ReturnType<typeof mock>).mockReturnValueOnce({
      createWorkflowEvent: mock(() => Promise.resolve()),
    });

    await workflowRejectCommand('run-max', 'still bad');

    // Terminal reject resolves + cancels atomically (#2113); the audit event
    // rides the same transaction (#2146).
    expect(workflowDb.resolveAndCancelApprovalGate).toHaveBeenCalledWith(
      'run-max',
      { nodeId: 'gate', gateId: undefined },
      [
        {
          event_type: 'approval_received',
          step_name: 'gate',
          data: { decision: 'rejected', reason: 'still bad' },
        },
      ]
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('max attempts reached'));
  });

  it('throws when on_reject configured but working_path is null', async () => {
    const workflowDb = await import('@archon/core/db/workflows');

    const runData = {
      id: 'run-no-path',
      workflow_name: 'my-wf',
      status: 'paused',
      user_message: 'build it',
      working_path: null,
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    await expect(workflowRejectCommand('run-no-path', 'bad')).rejects.toThrow('no working path');
  });

  it('should discover workflows from codebase.default_cwd on reject-resume, not working_path', async () => {
    // Regression for #1663: reject with on_reject configured re-invokes
    // workflowRunCommand. Discovery must use the source repo, not the worktree.
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-1663',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-with-yaml',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-with-yaml',
      name: 'owner/repo',
      default_cwd: '/users/me/source-repo-with-yaml',
    });

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowRejectCommand('run-reject-1663', 'needs work');
    } catch {
      // downstream failure is acceptable
    }

    // Discovery must use the codebase source path, NOT working_path
    expect(discoverSpy).toHaveBeenCalledWith(
      '/users/me/source-repo-with-yaml',
      expect.any(Function)
    );
  });

  it('fails loudly when getCodebase throws during reject auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-codebase-error',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-bad',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockRejectedValueOnce(new Error('database offline'));

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(workflowRejectCommand('run-reject-codebase-error', 'needs work')).rejects.toThrow(
      "Rejected but failed to resume workflow 'my-approval-workflow': Failed to load codebase 'cb-bad' for workflow run 'run-reject-codebase-error'"
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ codebaseId: 'cb-bad' }),
      'cli.workflow_reject_codebase_lookup_failed'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-reject-codebase-error' }),
      'cli.workflow_reject_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith(
      '/tmp/worktree-without-yaml',
      expect.any(Function)
    );
  });

  it('fails with recorded-rejection recovery when codebase row is missing during reject auto-resume', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const codebaseDb = await import('@archon/core/db/codebases');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-missing-codebase',
      workflow_name: 'my-approval-workflow',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/worktree-without-yaml',
      codebase_id: 'cb-missing',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);
    const getCodebaseMock = codebaseDb.getCodebase as ReturnType<typeof mock>;
    getCodebaseMock.mockReset();
    getCodebaseMock.mockResolvedValueOnce(null);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await expect(
      workflowRejectCommand('run-reject-missing-codebase', 'needs work')
    ).rejects.toThrow(
      "Rejected but failed to resume workflow 'my-approval-workflow': Workflow run 'run-reject-missing-codebase' references codebase 'cb-missing', but that codebase no longer exists.\n" +
        'Cannot safely discover workflows from the run worktree because project workflow files may be missing.\n' +
        'Re-register the project or restore the codebase row, then retry.\n' +
        "The rejection was recorded. Run 'bun run cli workflow resume run-reject-missing-codebase' to retry."
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-reject-missing-codebase' }),
      'cli.workflow_reject_resume_failed'
    );
    expect(discoverSpy).not.toHaveBeenCalledWith(
      '/tmp/worktree-without-yaml',
      expect.any(Function)
    );
  });

  it('should fall back to working_path for discovery on reject when codebase_id is missing', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const workflowDiscovery = await import('@archon/workflows/workflow-discovery');

    const runData = {
      id: 'run-reject-no-codebase',
      workflow_name: 'legacy',
      status: 'paused',
      user_message: 'go',
      working_path: '/tmp/old-worktree',
      codebase_id: null,
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    };
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(runData);
    (workflowDb.updateWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(undefined);

    const discoverSpy = workflowDiscovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    discoverSpy.mockResolvedValueOnce({ workflows: [], errors: [] });

    try {
      await workflowRejectCommand('run-reject-no-codebase', 'bad');
    } catch {
      // downstream failure is acceptable
    }

    // No codebase → falls back to working_path (preserves existing behavior)
    expect(discoverSpy).toHaveBeenCalledWith('/tmp/old-worktree', expect.any(Function));
  });
});

describe('workflowRunCommand — progress rendering', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  function setupWorkflowMocks(): void {
    // These need to be set up for each test since workflowRunCommand has many dependencies
    const discoverMock = require('@archon/workflows/workflow-discovery')
      .discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverMock.mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'plan', description: 'Plan work' })],
      errors: [],
    });

    const conversationDb = require('@archon/core/db/conversations');
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });

    const codebaseDb = require('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });
  }

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    capturedSubscribeHandler = null;
    mockUnsubscribe.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should subscribe to emitter when not quiet', async () => {
    setupWorkflowMocks();

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    // capturedSubscribeHandler is set when subscribeForConversation is called
    expect(capturedSubscribeHandler).not.toBeNull();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should subscribe (for run-id tracking) but not render when quiet', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_started',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', { quiet: true });

    // quiet still subscribes — the handler tracks the owned run id for the
    // signal cleanup guard (#1123) — but renders no progress output.
    expect(capturedSubscribeHandler).not.toBeNull();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalledWith('[classify] Started\n');
  });

  it('should call unsubscribe after executeWorkflow completes', async () => {
    setupWorkflowMocks();

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should write node_started event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_started',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Started\n');
  });

  it('should write node_completed event with duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
          duration: 12400,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Completed (12.4s)\n');
  });

  it('should write node_failed event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_failed',
          runId: 'run-1',
          nodeId: 'classify',
          nodeName: 'classify',
          error: 'timeout exceeded',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[classify] Failed: timeout exceeded\n');
  });

  it('should write node_skipped event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_skipped',
          runId: 'run-1',
          nodeId: 'deploy',
          nodeName: 'deploy',
          reason: 'when_condition',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[deploy] Skipped (when_condition)\n');
  });

  it('should write approval_pending event to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'approval_pending',
          runId: 'run-1',
          nodeId: 'review',
          message: 'Please review the changes',
        });
      }
      return { success: true, workflowRunId: 'run-1', paused: true };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith(
      '[review] Waiting for approval: Please review the changes\n'
    );
  });

  it('should not write tool_started without verbose', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'tool_started',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
          toolCallId: 'call-1',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('tool: Bash'));
  });

  it('should write tool_started with verbose', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'tool_started',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
          toolCallId: 'call-1',
        });
        capturedSubscribeHandler({
          type: 'tool_completed',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
          durationMs: 42,
          toolCallId: 'call-1',
          toolOutcome: 'error',
          exitCode: 1,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', { verbose: true });

    expect(stderrSpy).toHaveBeenCalledWith('[classify] tool: Bash (started, call-1)\n');
    expect(stderrSpy).toHaveBeenCalledWith('[classify] tool: Bash (42ms, call-1, error, exit 1)\n');
  });

  it('should render a legacy tool completion without optional metadata', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'tool_completed',
          runId: 'run-1',
          toolName: 'Bash',
          stepName: 'classify',
          durationMs: 42,
          toolCallId: 'call-1',
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', { verbose: true });

    expect(stderrSpy).toHaveBeenCalledWith('[classify] tool: Bash (42ms, call-1)\n');
  });

  it('should call unsubscribe even when executeWorkflow throws', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      throw new Error('executor crashed');
    });

    await expect(workflowRunCommand('/test/path', 'plan', 'hello', {})).rejects.toThrow(
      'executor crashed'
    );

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should write node_completed with sub-second duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'fast',
          nodeName: 'fast',
          duration: 500,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[fast] Completed (500ms)\n');
  });

  it('should write node_completed with minutes duration to stderr', async () => {
    setupWorkflowMocks();

    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      if (capturedSubscribeHandler) {
        capturedSubscribeHandler({
          type: 'node_completed',
          runId: 'run-1',
          nodeId: 'slow',
          nodeName: 'slow',
          duration: 90000,
        });
      }
      return { success: true, workflowRunId: 'run-1' };
    });

    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(stderrSpy).toHaveBeenCalledWith('[slow] Completed (1m30s)\n');
  });
});

// ---------------------------------------------------------------------------
// Signal cleanup guard (#1123) — SIGTERM/SIGINT handlers must be run-scoped,
// status-guarded, and removed once executeWorkflow settles.
// ---------------------------------------------------------------------------

describe('workflowRunCommand — signal cleanup guard (#1123)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  function setupWorkflowMocks(): void {
    const discoverMock = require('@archon/workflows/workflow-discovery')
      .discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverMock.mockResolvedValueOnce({
      workflows: [makeTestWorkflowWithSource({ name: 'plan', description: 'Plan work' })],
      errors: [],
    });

    const conversationDb = require('@archon/core/db/conversations');
    (conversationDb.getOrCreateConversation as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'conv-1',
      platform: 'cli',
      platform_conversation_id: 'cli-123',
      title: null,
      is_active: true,
      codebase_id: null,
    });

    const codebaseDb = require('@archon/core/db/codebases');
    (codebaseDb.findCodebaseByDefaultCwd as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-1',
      name: 'test-repo',
      default_cwd: '/test/path',
    });
  }

  /** Flush the cleanup handler's fire-and-forget promise chain. */
  async function settleCleanup(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /** The SIGTERM listeners added since `baseline` (i.e. by the command under test). */
  function addedSigtermListeners(baseline: readonly unknown[]): Array<() => void> {
    return process.listeners('SIGTERM').filter(listener => !baseline.includes(listener)) as Array<
      () => void
    >;
  }

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    // The cleanup chain ends in process.exit(1) — neuter it so invoking the
    // handler in-process doesn't kill the test runner.
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    capturedSubscribeHandler = null;
    mockUnsubscribe.mockClear();

    const workflowsDb = require('@archon/core/db/workflows');
    (workflowsDb.failWorkflowRun as ReturnType<typeof mock>).mockClear();
    (workflowsDb.getActiveWorkflowRun as ReturnType<typeof mock>).mockClear();
    (workflowsDb.getWorkflowRunStatus as ReturnType<typeof mock>).mockReset();
    (workflowsDb.getWorkflowRunStatus as ReturnType<typeof mock>).mockResolvedValue(null);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('removes SIGTERM/SIGINT handlers once executeWorkflow settles (no leak, no stacking)', async () => {
    const sigtermBaseline = process.listenerCount('SIGTERM');
    const sigintBaseline = process.listenerCount('SIGINT');

    let duringRunSigterm = 0;
    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementation(async () => {
      duringRunSigterm = process.listenerCount('SIGTERM');
      return { success: true, workflowRunId: 'run-1' };
    });

    setupWorkflowMocks();
    await workflowRunCommand('/test/path', 'plan', 'hello', {});
    expect(duringRunSigterm).toBe(sigtermBaseline + 1);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline);
    expect(process.listenerCount('SIGINT')).toBe(sigintBaseline);

    // A second invocation in the same process must not stack handlers either.
    setupWorkflowMocks();
    await workflowRunCommand('/test/path', 'plan', 'hello', {});
    expect(duringRunSigterm).toBe(sigtermBaseline + 1);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBaseline);
    expect(process.listenerCount('SIGINT')).toBe(sigintBaseline);

    (executeWorkflow as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ success: true, workflowRunId: 'test-run-id' })
    );
  });

  it('does not fail the run when it is paused at a new gate at signal time', async () => {
    const workflowsDb = require('@archon/core/db/workflows');
    // The run this process drives has committed its pause at the next gate.
    (workflowsDb.getWorkflowRunStatus as ReturnType<typeof mock>).mockResolvedValue('paused');

    const sigtermBefore = process.listeners('SIGTERM');
    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      // The executor announced the run this process owns…
      capturedSubscribeHandler?.({
        type: 'workflow_started',
        runId: 'run-1',
        workflowName: 'plan',
        conversationId: 'conv-1',
      });
      // …then the signal lands while the handler is still registered.
      const [handler] = addedSigtermListeners(sigtermBefore);
      expect(handler).toBeDefined();
      handler();
      await settleCleanup();
      return { success: true, workflowRunId: 'run-1', paused: true };
    });

    setupWorkflowMocks();
    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    // Paused-at-gate is an external transition the signal handler must respect.
    expect(workflowsDb.failWorkflowRun).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still fails the run on a genuine mid-run interrupt (legacy behavior)', async () => {
    const workflowsDb = require('@archon/core/db/workflows');
    (workflowsDb.getWorkflowRunStatus as ReturnType<typeof mock>).mockResolvedValue('running');

    const sigtermBefore = process.listeners('SIGTERM');
    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      capturedSubscribeHandler?.({
        type: 'workflow_started',
        runId: 'run-1',
        workflowName: 'plan',
        conversationId: 'conv-1',
      });
      const [handler] = addedSigtermListeners(sigtermBefore);
      expect(handler).toBeDefined();
      handler();
      await settleCleanup();
      return { success: false, workflowRunId: 'run-1', error: 'interrupted' };
    });

    setupWorkflowMocks();
    await expect(workflowRunCommand('/test/path', 'plan', 'hello', {})).rejects.toThrow(
      'Workflow failed'
    );

    expect(workflowsDb.failWorkflowRun).toHaveBeenCalledWith(
      'run-1',
      'Process terminated (SIGTERM)'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('never touches a run it does not own (no owned run id at signal time)', async () => {
    const workflowsDb = require('@archon/core/db/workflows');

    const sigtermBefore = process.listeners('SIGTERM');
    const { executeWorkflow } = require('@archon/workflows/executor');
    (executeWorkflow as ReturnType<typeof mock>).mockImplementationOnce(async () => {
      // No workflow_started yet — this process owns no run. Another process's
      // run on the same conversation must never be failed by this handler.
      const [handler] = addedSigtermListeners(sigtermBefore);
      expect(handler).toBeDefined();
      handler();
      await settleCleanup();
      return { success: true, workflowRunId: 'run-1' };
    });

    setupWorkflowMocks();
    await workflowRunCommand('/test/path', 'plan', 'hello', {});

    expect(workflowsDb.failWorkflowRun).not.toHaveBeenCalled();
    expect(workflowsDb.getActiveWorkflowRun).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// extractStaleWorkspaceEntry — parser edge cases
// ---------------------------------------------------------------------------

describe('extractStaleWorkspaceEntry', () => {
  it('extracts the workspace dir from a POSIX source-symlink error', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry(
        'Source symlink at /home/user/.archon/workspaces/acme/widget/source already points to /other, expected /here'
      )
    ).toBe('/home/user/.archon/workspaces/acme/widget');
  });

  it('extracts the workspace dir from a Windows source-symlink error (backslash sep)', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry(
        'Source symlink at C:\\Users\\me\\.archon\\workspaces\\acme\\widget\\source already points to D:\\x, expected D:\\y'
      )
    ).toBe('C:\\Users\\me\\.archon\\workspaces\\acme\\widget');
  });

  it('returns null when the prefix does not match (unrelated error)', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(extractStaleWorkspaceEntry('ENOENT: no such file or directory')).toBeNull();
  });

  it('returns null when the prefix matches but the delimiter is missing', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry('Source symlink at /some/path (truncated message)')
    ).toBeNull();
  });

  it('returns null when the source path has no path separator at all', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(
      extractStaleWorkspaceEntry('Source symlink at bareword already points to /x, expected /y')
    ).toBeNull();
  });

  it('returns null on an empty input', async () => {
    const { extractStaleWorkspaceEntry } = await import('./workflow');
    expect(extractStaleWorkspaceEntry('')).toBeNull();
  });
});

describe('workflowResetSessionsCommand', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockDeleteNodeSessions.mockClear();
    mockDeleteNodeSessions.mockResolvedValue({ deleted: 0 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('refuses a cross-scope reset without --scope and without --yes', async () => {
    await expect(workflowResetSessionsCommand('feature-dev', {})).rejects.toThrow(/Refusing/);
    expect(mockDeleteNodeSessions).not.toHaveBeenCalled();
  });

  it('proceeds across all scopes when --yes is given (no scope filter)', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 4 });

    await workflowResetSessionsCommand('feature-dev', { yes: true });

    expect(mockDeleteNodeSessions).toHaveBeenCalledWith({
      workflow_name: 'feature-dev',
      scope_key: undefined,
      node_id: undefined,
    });
    const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some(c => c.includes('4') && c.includes('across all scopes'))).toBe(true);
  });

  it('proceeds with --scope and no --yes, narrowing to that scope', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 1 });

    await workflowResetSessionsCommand('feature-dev', { scope: 'conv-1', node: 'planner' });

    expect(mockDeleteNodeSessions).toHaveBeenCalledWith({
      workflow_name: 'feature-dev',
      scope_key: 'conv-1',
      node_id: 'planner',
    });
  });

  it('emits machine-readable JSON when --json is set', async () => {
    mockDeleteNodeSessions.mockResolvedValueOnce({ deleted: 2 });

    await workflowResetSessionsCommand('feature-dev', { scope: 'conv-1', json: true });

    expect(firstJsonPayload(stdoutSpy)).toBe(
      JSON.stringify({ workflow: 'feature-dev', deleted: 2, scope: 'conv-1', node: null })
    );
  });
});

describe('workflowRetryNodeCommand', () => {
  it.todo('parses workflow retry-node <run-id> <node-id> and streams retry execution', () => {});
  it.todo('prints human-readable retry scope, safety ref, and reset feedback', () => {});
  it.todo('emits machine-readable JSON without inline auto-resume when --json is set', () => {});
  it.todo('emits {ok:false} JSON when retry-node is rejected in --json mode', () => {});
  it.todo('accepts retry-node only when cwd matches the run codebase or worktree path', () => {});
  it.todo(
    'rejects retry-node when cwd does not match the run codebase or worktree contracts',
    () => {}
  );
});

describe('hasUnresolvedWriteback (H2 teardown-preserve decision)', () => {
  it('true when the gate was raised but never resolved (failed/partial apply)', () => {
    expect(hasUnresolvedWriteback({ pending_writeback: { envId: 'e' } })).toBe(true);
  });
  it('false once the write-back resolved (applied/discarded)', () => {
    expect(
      hasUnresolvedWriteback({ pending_writeback: { envId: 'e' }, writeback_resolved: true })
    ).toBe(false);
  });
  it('false for a run that never raised a write-back gate', () => {
    expect(hasUnresolvedWriteback({ isolation: 'container' })).toBe(false);
    expect(hasUnresolvedWriteback(undefined)).toBe(false);
  });
});

describe('resolveContainerBackendConfig', () => {
  it('applies defaults when config is absent', () => {
    const cfg = resolveContainerBackendConfig(undefined);
    expect(cfg).toEqual({
      image: 'archon-runner:latest',
      network: 'bridge',
      memoryMb: 4096,
      pidsLimit: 512,
    });
  });

  it('passes through valid values', () => {
    const cfg = resolveContainerBackendConfig({
      image: '  my-runner:1  ',
      network: 'none',
      memoryMb: 2048,
      pidsLimit: 256,
    });
    expect(cfg).toEqual({
      image: 'my-runner:1',
      network: 'none',
      memoryMb: 2048,
      pidsLimit: 256,
    });
  });

  it('rejects a non bridge/none network (no silent --network host)', () => {
    expect(() => resolveContainerBackendConfig({ network: 'host' })).toThrow(/bridge.*none/);
  });

  it('rejects a fractional memoryMb (docker --memory needs an integer)', () => {
    expect(() => resolveContainerBackendConfig({ memoryMb: 512.5 })).toThrow(/positive integer/);
  });

  it('rejects a non-integer / non-positive pidsLimit', () => {
    expect(() => resolveContainerBackendConfig({ pidsLimit: 10.5 })).toThrow(/positive integer/);
    expect(() => resolveContainerBackendConfig({ pidsLimit: 0 })).toThrow(/positive integer/);
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD — Story 3.3c "Provide Archon Provider Decision Command
// CLI JSON". Tests for `workflowApproveCommand` and `workflowRejectCommand`
// JSON envelope mode, plus `classifyRunError` extensions for decision-specific
// error patterns.
//
// Target: packages/cli/src/commands/workflow.ts
// Test design: _bmad-output/implementation-artifacts/3-3c-provide-archon-
// provider-decision-command-cli-json.md
//
// These are `test.skip()` scaffolds: the envelope conversion (Slices 1-4) does
// not exist yet — the JSON branch currently emits the legacy `{ok:true/false}`
// shape. Each skip states what implementation makes it activatable.
//
// ACTIVATION: remove `.skip` once workflowApproveCommand / workflowRejectCommand
// JSON branches use buildSuccessEnvelope/buildErrorEnvelope with a fail-closed
// try/catch, and classifyRunError has the decision-specific patterns.
// ---------------------------------------------------------------------------

describe('workflowApproveCommand — JSON envelope mode (Story 3.3c)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // 3.3C-UNIT-001 [P0] AC #1 — approve success on a standard approval gate
  it.skip('3.3C-UNIT-001: emits workflow.approve success envelope for an approval gate', async () => {
    // ACTIVATION: workflowApproveCommand JSON branch uses buildSuccessEnvelope
    // with command 'workflow.approve' and result containing operation/decision.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-env-1',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb-1',
      conversation_id: 'conv-1',
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    // Post-approval re-fetch for envelope state mapping
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-env-1',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      metadata: {
        approval: { type: 'approval', nodeId: 'gate', message: 'Approve?', resolved: 'approved' },
      },
    });

    await workflowApproveCommand('run-approve-env-1', 'lgtm', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = firstJsonPayload(stdoutSpy);
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref.runId).toBe('run-approve-env-1');
    expect(ref.workflowName).toBe('implement');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('approve');
    const decision = result.decision as Record<string, unknown>;
    expect(decision.outcome).toBe('approved');
    expect(decision.recorded).toBe(true);
    expect(envelope).not.toHaveProperty('error');
  });

  // 3.3C-UNIT-002 [P0] AC #1 — approve success on an interactive loop gate
  it.skip('3.3C-UNIT-002: emits workflow.approve success envelope for an interactive loop gate', async () => {
    // ACTIVATION: same as 3.3C-UNIT-001; interactive loop type in approval context
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-loop',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: {
        approval: { type: 'interactive_loop', nodeId: 'loop-node', message: 'Continue?' },
      },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-approve-loop',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'loop-node',
          message: 'Continue?',
          resolved: 'approved',
        },
      },
    });

    await workflowApproveCommand('run-approve-loop', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('approve');
    expect((result.decision as Record<string, unknown>).outcome).toBe('approved');
  });

  // 3.3C-UNIT-003 [P0] AC #2 — approve error: run not paused
  it.skip('3.3C-UNIT-003: emits UNEXPECTED_STATE envelope when approve called on a non-paused run', async () => {
    // ACTIVATION: classifyRunError handles 'Cannot approve run with status'
    // and workflowApproveCommand JSON branch wraps in fail-closed try/catch.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-not-paused',
      workflow_name: 'implement',
      status: 'completed',
      metadata: {},
    });

    await workflowApproveCommand('run-not-paused', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
    expect(envelope).not.toHaveProperty('workflowRunRef');
    expect(envelope).not.toHaveProperty('result');
  });

  // 3.3C-UNIT-004 [P0] AC #2 — approve error: already resolved
  it.skip('3.3C-UNIT-004: emits UNEXPECTED_STATE envelope when gate is already resolved', async () => {
    // ACTIVATION: classifyRunError handles 'already resolved'/'already approved'/
    // 'awaiting resume' patterns, and the JSON branch catches them.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-already-resolved',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      metadata: { approval: { nodeId: 'gate', message: 'ok?', resolved: 'approved' } },
    });
    // approveWorkflow throws when gate is already resolved
    (workflowDb.resolveApprovalGate as ReturnType<typeof mock>).mockResolvedValueOnce({
      resolved: false,
    });

    await workflowApproveCommand('run-already-resolved', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
  });

  // 3.3C-UNIT-005 [P0] AC #2 — approve error: missing approval context
  it.skip('3.3C-UNIT-005: emits UNEXPECTED_STATE envelope when approval context is missing', async () => {
    // ACTIVATION: classifyRunError handles 'missing approval context' and the
    // JSON branch catches it.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-ctx',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      metadata: {},
    });

    await workflowApproveCommand('run-no-ctx', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    expect((envelope.error as Record<string, unknown>).code).toBe('UNEXPECTED_STATE');
  });

  // 3.3C-UNIT-006 [P0] AC #2 — approve error: run not found via resolveRunIdArg
  it.skip('3.3C-UNIT-006: emits WORKFLOW_RUN_NOT_FOUND envelope when run does not exist', async () => {
    // ACTIVATION: classifyRunError handles 'Workflow run not found' and the
    // JSON branch catches it with WORKFLOW_RUN_NOT_FOUND.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowApproveCommand('nonexistent-run-id', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3C-UNIT-007 [P1] AC #2 — approve error: DB error on post-approval fetch
  it.skip('3.3C-UNIT-007: emits INTERNAL_ERROR envelope when post-approval run fetch fails', async () => {
    // ACTIVATION: after approveWorkflow succeeds, the code fetches the run for
    // the envelope; if getWorkflowRun throws, emit INTERNAL_ERROR.
    const workflowDb = await import('@archon/core/db/workflows');
    // First call: approveWorkflow succeeds (lookup + CAS)
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-db-err',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    // Second call: post-approval re-fetch throws DB error
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('database connection lost')
    );

    await workflowApproveCommand('run-db-err', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3C-UNIT-008 [P0] — JSON approve does NOT auto-resume (preserved invariant)
  it.skip('3.3C-UNIT-008: JSON approve does not invoke workflowRunCommand (no auto-resume)', async () => {
    // ACTIVATION: same as 3.3C-UNIT-001; verifies the non-resume invariant
    // documented at workflow.ts:2986-2993.
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-resume',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb',
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-resume',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: 'cb',
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowApproveCommand('run-no-resume', 'lgtm', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    // No inline resume → workflowRunCommand (whose first step is discovery) never ran
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  // 3.3C-UNIT-009 [P1] — exactly one stdout line, no human text
  it.skip('3.3C-UNIT-009: JSON mode approve writes exactly one stdout line with no human text', async () => {
    // ACTIVATION: envelope conversion replaces legacy JSON.stringify
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-one-line',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-one-line',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });

    await workflowApproveCommand('run-one-line', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = firstJsonPayload(stdoutSpy);
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toContain('Approved workflow');
    expect(raw).not.toContain('Resuming');
  });

  // 3.3C-UNIT-010 [P1] — correlationId echoed in approve envelope
  it.skip('3.3C-UNIT-010: correlationId is echoed in approve success envelope', async () => {
    // ACTIVATION: workflowApproveCommand accepts correlationId as 4th positional
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-corr',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-corr',
      workflow_name: 'assist',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: { approval: { type: 'approval', nodeId: 'gate', resolved: 'approved' } },
    });

    await workflowApproveCommand('run-corr', 'lgtm', true, undefined, 'corr-3c-approve');

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.correlationId).toBe('corr-3c-approve');
  });
});

describe('workflowRejectCommand — JSON envelope mode (Story 3.3c)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // 3.3C-UNIT-011 [P0] AC #1 — reject success: cancelled (no on_reject)
  it.skip('3.3C-UNIT-011: emits workflow.reject success envelope with cancelled=true, resumable=false', async () => {
    // ACTIVATION: workflowRejectCommand JSON branch uses buildSuccessEnvelope
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-cancel',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb-1',
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Approve?' } },
    });
    // Post-rejection re-fetch
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-cancel',
      workflow_name: 'implement',
      status: 'cancelled',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      metadata: {},
    });

    await workflowRejectCommand('run-reject-cancel', 'not good', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('reject');
    expect((result.decision as Record<string, unknown>).outcome).toBe('rejected');
    expect((result.decision as Record<string, unknown>).recorded).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.resumable).toBe(false);
    expect(envelope).not.toHaveProperty('error');
  });

  // 3.3C-UNIT-012 [P0] AC #1 — reject success: not cancelled (has on_reject rework)
  it.skip('3.3C-UNIT-012: emits workflow.reject success envelope with cancelled=false, resumable=true', async () => {
    // ACTIVATION: same as above; rework-resumable path
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-rework',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 0,
      },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-rework',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {
        approval: { type: 'approval', nodeId: 'gate', resolved: 'rejected' },
        rejection_count: 1,
      },
    });

    await workflowRejectCommand('run-reject-rework', 'needs work', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.cancelled).toBe(false);
    expect(result.resumable).toBe(true);
  });

  // 3.3C-UNIT-013 [P0] AC #1 — reject success: max attempts reached
  it.skip('3.3C-UNIT-013: emits workflow.reject envelope with maxAttemptsReached=true, cancelled=true', async () => {
    // ACTIVATION: same as above; max attempts path
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-max',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'gate',
          message: 'Approve?',
          onRejectPrompt: 'Fix',
          onRejectMaxAttempts: 3,
        },
        rejection_count: 2,
      },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-max',
      workflow_name: 'implement',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    await workflowRejectCommand('run-reject-max', 'still bad', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.maxAttemptsReached).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.resumable).toBe(false);
  });

  // 3.3C-UNIT-014 [P1] AC #1 — reject success: container write-back rejection
  it('3.3C-UNIT-014: emits workflow.reject envelope for container write-back rejection (cancelled=false)', async () => {
    // ACTIVATION: envelope conversion of the write-back rejection path
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-wb',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: {
        approval: { type: 'writeback', nodeId: '__writeback__', message: 'Apply changes?' },
        pending_writeback: { envId: 'env-1' },
      },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-wb',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {
        approval: { type: 'writeback', nodeId: '__writeback__', resolved: 'rejected' },
        pending_writeback: { envId: 'env-1' },
      },
    });

    await workflowRejectCommand('run-reject-wb', 'discard changes', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    expect(envelope).not.toHaveProperty('error');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('reject');
    expect((result.decision as Record<string, unknown>).outcome).toBe('rejected');
    expect((result.decision as Record<string, unknown>).recorded).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.resumable).toBe(true);
    expect(result.maxAttemptsReached).toBe(false);
    expect(result.state).toBe('paused');
    expect(result.terminal).toBe(false);
  });

  // 3.3C-UNIT-015 [P0] AC #2 — reject error: run not paused
  it.skip('3.3C-UNIT-015: emits UNEXPECTED_STATE envelope when reject called on non-paused run', async () => {
    // ACTIVATION: classifyRunError handles 'Cannot reject run with status'
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-np',
      workflow_name: 'implement',
      status: 'running',
      metadata: {},
    });

    await workflowRejectCommand('run-reject-np', 'nope', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3C-UNIT-016 [P0] AC #2 — reject error: already resolved
  it.skip('3.3C-UNIT-016: emits UNEXPECTED_STATE envelope when reject gate is already resolved', async () => {
    // ACTIVATION: classifyRunError handles 'already resolved'
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-reject-resolved',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      metadata: { approval: { nodeId: 'gate', message: 'ok?', resolved: 'rejected' } },
    });
    (workflowDb.resolveApprovalGate as ReturnType<typeof mock>).mockResolvedValueOnce({
      resolved: false,
    });

    await workflowRejectCommand('run-reject-resolved', 'nope', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    expect((envelope.error as Record<string, unknown>).code).toBe('UNEXPECTED_STATE');
  });

  // 3.3C-UNIT-017 [P0] AC #2 — reject error: run not found
  it.skip('3.3C-UNIT-017: emits WORKFLOW_RUN_NOT_FOUND envelope when rejected run does not exist', async () => {
    // ACTIVATION: classifyRunError handles 'Workflow run not found'
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowRejectCommand('nonexistent-reject', 'nope', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('WORKFLOW_RUN_NOT_FOUND');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    expect((envelope.execution as Record<string, unknown>).exitCode).toBe(78);
  });

  // 3.3C-UNIT-018 [P0] — JSON reject does NOT auto-resume
  it.skip('3.3C-UNIT-018: JSON reject does not invoke workflowRunCommand (no auto-resume)', async () => {
    // ACTIVATION: envelope conversion preserves the no-resume invariant
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-resume-rj',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-resume-rj',
      workflow_name: 'implement',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();

    await workflowRejectCommand('run-no-resume-rj', 'nope', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  // 3.3C-UNIT-019 [P1] — correlationId echoed in reject envelope
  it.skip('3.3C-UNIT-019: correlationId is echoed in reject success envelope', async () => {
    // ACTIVATION: workflowRejectCommand accepts correlationId parameter
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-corr-rj',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      user_message: 'go',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-corr-rj',
      workflow_name: 'assist',
      status: 'cancelled',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    await workflowRejectCommand('run-corr-rj', 'nope', true, undefined, 'corr-3c-reject');

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.correlationId).toBe('corr-3c-reject');
  });
});

describe('classifyRunError — decision-specific patterns (Story 3.3c Slice 4)', () => {
  // 3.3C-UNIT-020 [P0] — 'already resolved' pattern
  it('3.3C-UNIT-020: already-resolved error classifies as UNEXPECTED_STATE', () => {
    // ACTIVATION: classifyRunError adds 'already resolved'/'already approved'/
    // 'awaiting resume' patterns
    expect(
      classifyRunError(new Error('Workflow run abc was already approved and is awaiting resume.'))
    ).toEqual({
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });

    expect(
      classifyRunError(new Error('Gate was already resolved by a concurrent approve'))
    ).toEqual({
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
  });

  // 3.3C-UNIT-021 [P0] — 'Cannot approve/reject run with status' pattern
  it('3.3C-UNIT-021: cannot-approve/reject-status error classifies as UNEXPECTED_STATE', () => {
    // ACTIVATION: classifyRunError adds 'Cannot approve run with status'
    // and 'Cannot reject run with status' patterns
    expect(classifyRunError(new Error('Cannot approve run with status "completed"'))).toEqual({
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });

    expect(classifyRunError(new Error('Cannot reject run with status "running"'))).toEqual({
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
  });

  // 3.3C-UNIT-022 [P0] — 'missing approval context' pattern
  it('3.3C-UNIT-022: missing-approval-context error classifies as UNEXPECTED_STATE', () => {
    // ACTIVATION: classifyRunError adds 'missing approval context' pattern
    expect(
      classifyRunError(new Error('Workflow run is paused but missing approval context.'))
    ).toEqual({
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
  });

  // 3.3C-UNIT-023 [P0] — 'Workflow run not found' pattern (distinct from workflow-name not-found)
  it('3.3C-UNIT-023: workflow-run-not-found classifies as WORKFLOW_RUN_NOT_FOUND', () => {
    // ACTIVATION: classifyRunError adds 'Workflow run not found' pattern
    expect(classifyRunError(new Error('Workflow run not found: abc123'))).toEqual({
      code: 'WORKFLOW_RUN_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
  });

  // 3.3C-UNIT-024 [P0] — negative: patterns must not overmatch
  it('3.3C-UNIT-024: decision-specific patterns do not overmatch related strings', () => {
    // ACTIVATION: same patterns as above; negative cases
    // 'resolved' alone should NOT match
    expect(classifyRunError(new Error('The task was resolved successfully'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });

    // 'Workflow not found' (no 'run') should NOT match WORKFLOW_RUN_NOT_FOUND
    // (it already matches the existing WORKFLOW_NOT_FOUND regex for name lookups)
    expect(classifyRunError(new Error("Workflow 'foo' not found."))).toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });

    // Recovery prose must not extend this shared classifier. Story 3.3d maps
    // typed RecoveryParentError causes at its private command boundary.
    expect(classifyRunError(new Error('Cannot resume run with status "completed"'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // RF-3c-001 — ambiguous short run-id → MALFORMED_REQUEST (not INTERNAL_ERROR)
  it('RF-3c-001: ambiguous short run-id classifies as MALFORMED_REQUEST', () => {
    expect(
      classifyRunError(
        new Error(
          "Run id 'abc' matches more than one run in this project — use more characters or the full id (from 'archon workflow runs --json')."
        )
      )
    ).toEqual({
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      retryable: false,
      exitCode: 64,
    });
  });

  // RF-3c-002 — post-decision readback failure does NOT match WORKFLOW_RUN_NOT_FOUND
  it('RF-3c-002: post-decision readback failure classifies as INTERNAL_ERROR, not RUN_NOT_FOUND', () => {
    expect(
      classifyRunError(new Error('Failed to read back workflow run after approval: run-123'))
    ).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
    expect(
      classifyRunError(new Error('Failed to read back workflow run after rejection: run-456'))
    ).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // 3.3C-UNIT-025 [P1] — existing patterns unaffected (regression)
  it('3.3C-UNIT-025: existing classifier patterns continue to work (regression)', () => {
    // ACTIVATION: classifyRunError additions must not break existing patterns
    // Existing: mutually exclusive flags → MALFORMED_REQUEST
    expect(
      classifyRunError(new Error('--branch and --no-worktree are mutually exclusive.'))
    ).toEqual({
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      retryable: false,
      exitCode: 64,
    });
    // Existing: workflow name not found → WORKFLOW_NOT_FOUND
    expect(classifyRunError(new Error("Workflow 'bar' not found."))).toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      category: 'unexpected_state',
      retryable: false,
      exitCode: 78,
    });
    // Existing: timeout → COMMAND_TIMEOUT
    const timeoutErr = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
    expect(classifyRunError(timeoutErr)).toEqual({
      code: 'COMMAND_TIMEOUT',
      category: 'timeout',
      retryable: true,
      exitCode: 69,
    });
    // Existing: fallback → INTERNAL_ERROR
    expect(classifyRunError(new Error('some internal failure'))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // 3.3D-UNIT-CLS-001 [P0] TD-007 — recovery prose is not a type discriminator
  it('3.3D-UNIT-CLS-001: does not classify resume prose as UNEXPECTED_STATE', () => {
    expect(
      classifyRunError(
        new Error(
          "Cannot resume run with status 'completed'. Only failed or paused runs can be resumed."
        )
      )
    ).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // 3.3D-UNIT-CLS-002 [P0] TD-007 — retry classification is typed
  it('3.3D-UNIT-CLS-002: does not classify retry prose as UNEXPECTED_STATE', () => {
    expect(
      classifyRunError(new Error("Cannot retry workflow run with status 'completed'."))
    ).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // 3.3D-UNIT-CLS-003 [P0] TD-007 — cancel classification is typed
  it('3.3D-UNIT-CLS-003: does not classify cancel prose as UNEXPECTED_STATE', () => {
    expect(classifyRunError(new Error("Cannot cancel run with status 'completed'."))).toEqual({
      code: 'INTERNAL_ERROR',
      category: 'implementation_defect',
      retryable: false,
      exitCode: 70,
    });
  });

  // 3.3D-UNIT-CLS-004 [P1] AC #5 — negative: unrelated error still falls through to INTERNAL_ERROR
  it('3.3D-UNIT-CLS-004: unrelated "Cannot resume" substring does not overmatch to UNEXPECTED_STATE', () => {
    // This is an anti-overmatch test: an error that includes the word "resume"
    // but is NOT a status check must NOT match the resume pattern.
    const result = classifyRunError(new Error('Cannot resume because disk is full'));
    expect(result.code).not.toBe('UNEXPECTED_STATE');
    expect(result.code).toBe('INTERNAL_ERROR');
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD — Story 3.3d "Provide Archon Recovery Command CLI JSON".
// Tests for resume envelope conversion, retry (whole-run + targeted) dispatch,
// cancel CAS, and classifier extensions.
//
// Target: packages/cli/src/commands/workflow.ts
// Test design: _bmad-output/implementation-artifacts/3-3d-provide-archon-
// recovery-command-cli-json.md
//
// These are `it.skip()` scaffolds: the envelope conversion (Slices 2-5) does
// not exist yet — the resume JSON branch currently emits the legacy `{ok:true}`
// shape, and retry/cancel handlers do not exist. Each skip states what
// implementation makes it activatable.
//
// ACTIVATION: remove `.skip` once:
// - workflowResumeCommand JSON branch uses buildSuccessEnvelope/buildErrorEnvelope
// - workflowRetryCommand (new) exists with detached-dispatch envelope
// - workflowCancelCommand (new) exists with CAS-based envelope
// - classifyRunError has recovery-specific patterns
// ---------------------------------------------------------------------------

describe('workflowResumeCommand — JSON envelope mode (Story 3.3d)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.error.mockClear();
    const codebaseDb = await import('@archon/core/db/codebases');
    const pendingDb = await import('@archon/core/db/workflow-pending-interactions');
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockReset();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({
        id: 'cb-default',
        name: 'test/repo',
        repository_url: null,
        default_cwd: '/tmp/repo',
        commands: {},
      })
    );
    (pendingDb.listPendingInteractions as ReturnType<typeof mock>).mockReset();
    (pendingDb.listPendingInteractions as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve([])
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // 3.3D-UNIT-001 [P0] AC #1 — resume success on a paused run
  it('3.3D-UNIT-001: emits workflow.resume success envelope for a paused run with resumable=true, executed=false', async () => {
    // ACTIVATION: workflowResumeCommand JSON branch uses buildSuccessEnvelope
    // with command 'workflow.resume' and result containing operation/state/
    // validated/resumable/executed.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-paused',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: 'cb-1',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });

    await workflowResumeCommand('run-resume-paused', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = firstJsonPayload(stdoutSpy);
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref.runId).toBe('run-resume-paused');
    expect(ref.workflowName).toBe('implement');
    expect(ref.provider).toBe('archon');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('resume');
    expect(result.validated).toBe(true);
    expect(result.resumable).toBe(true);
    expect(result.executed).toBe(false);
    expect(envelope).not.toHaveProperty('error');
  });

  // 3.3D-UNIT-002 [P0] AC #1 — resume success on a failed run
  it('3.3D-UNIT-002: emits workflow.resume success envelope for a failed run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-001; failed is also resumable
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-failed',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    await workflowResumeCommand('run-resume-failed', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('resume');
    expect(result.resumable).toBe(true);
    expect(result.executed).toBe(false);
  });

  it('emits workflow.resume success envelope for an Ask-resumed running run', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const pendingDb = await import('@archon/core/db/workflow-pending-interactions');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-ask',
      workflow_name: 'implement',
      status: 'running',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });
    (pendingDb.listPendingInteractions as ReturnType<typeof mock>).mockResolvedValueOnce([
      {
        id: 'ask-1',
        workflow_run_id: 'run-resume-ask',
        node_id: 'ask',
        tool_use_id: 'tool-1',
        kind: 'ask',
        status: 'answered',
        envelope: {},
        answer: { answers: [{ questionId: 'q1', value: 'yes' }] },
        provider_session_id: 'sess-1',
        created_at: new Date(),
        resolved_at: new Date(),
        resolved_by: 'user-1',
      },
    ]);

    await workflowResumeCommand('run-resume-ask', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('resume');
    expect(result.state).toBe('running');
    expect(result.resumable).toBe(true);
    expect(result.executed).toBe(false);
  });

  // 3.3D-UNIT-003 [P0] AC #1 — resume error: completed run → UNEXPECTED_STATE
  it('3.3D-UNIT-003: emits UNEXPECTED_STATE envelope when resume called on a completed run', async () => {
    // ACTIVATION: classifyRunError handles 'Cannot resume run with status'
    // and workflowResumeCommand JSON branch wraps in fail-closed try/catch
    // using buildErrorEnvelope instead of printJsonWriteError.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-completed',
      workflow_name: 'implement',
      status: 'completed',
      metadata: {},
    });

    await workflowResumeCommand('run-resume-completed', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
    expect(envelope).not.toHaveProperty('workflowRunRef');
    expect(envelope).not.toHaveProperty('result');
  });

  // 3.3D-UNIT-004 [P0] AC #1 — resume error: cancelled run → UNEXPECTED_STATE
  it('3.3D-UNIT-004: emits UNEXPECTED_STATE envelope when resume called on a cancelled run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-003
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-cancelled',
      workflow_name: 'implement',
      status: 'cancelled',
      metadata: {},
    });

    await workflowResumeCommand('run-resume-cancelled', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  // 3.3D-UNIT-005 [P0] AC #1 — resume error: running run → UNEXPECTED_STATE
  it('3.3D-UNIT-005: emits UNEXPECTED_STATE envelope when resume called on a running run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-003
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-resume-running',
      workflow_name: 'implement',
      status: 'running',
      metadata: {},
    });

    await workflowResumeCommand('run-resume-running', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  // 3.3D-UNIT-006 [P0] AC #1 — resume error: run not found
  it('3.3D-UNIT-006: emits UNEXPECTED_STATE envelope when run does not exist', async () => {
    // ACTIVATION: resume handler intercepts 'Workflow run not found' from
    // resumeWorkflowOp and re-throws with a message matching the UNEXPECTED_STATE
    // classifier pattern (R1-F1: recovery commands use UNEXPECTED_STATE for missing runs).
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    await workflowResumeCommand('nonexistent-run', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3D-UNIT-007 [P0] AC #1 — no side effects: resume JSON does not invoke
  // discovery or execution
  it('3.3D-UNIT-007: JSON resume does not invoke workflow discovery or execution', async () => {
    // ACTIVATION: same envelope conversion as 3.3D-UNIT-001; verifies the
    // no-execution invariant from AC #1.
    const workflowDb = await import('@archon/core/db/workflows');
    const discovery = await import('@archon/workflows/workflow-discovery');
    const executor = await import('@archon/workflows/executor');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-side-effect',
      workflow_name: 'implement',
      status: 'failed',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });
    const discoverSpy = discovery.discoverWorkflowsWithConfig as ReturnType<typeof mock>;
    discoverSpy.mockClear();
    const executeSpy = executor.executeWorkflow as ReturnType<typeof mock>;
    executeSpy.mockClear();

    await workflowResumeCommand('run-no-side-effect', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    expect(discoverSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  // 3.3D-UNIT-008 [P1] AC #1 — exactly one stdout line
  it('3.3D-UNIT-008: JSON resume writes exactly one stdout line with no human text', async () => {
    // ACTIVATION: envelope conversion replaces legacy JSON.stringify
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-one-line-rs',
      workflow_name: 'assist',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: {},
    });

    await workflowResumeCommand('run-one-line-rs', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = firstJsonPayload(stdoutSpy);
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toContain('Resuming workflow');
    expect(raw).not.toContain('Path:');
  });

  // 3.3D-UNIT-009 [P1] AC #1 — state mapping uses contract vocabulary
  it('3.3D-UNIT-009: resume envelope state reflects mapWorkflowRunToContractState', async () => {
    // ACTIVATION: resume envelope uses mapWorkflowRunToContractState for state
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-state-map',
      workflow_name: 'implement',
      status: 'paused',
      working_path: '/tmp/wt',
      codebase_id: null,
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    });

    await workflowResumeCommand('run-state-map', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    // mapWorkflowRunToContractState maps paused+unresolved approval to
    // 'waiting-for-approval', not raw 'paused'
    expect(result.state).toBe('waiting-for-approval');
  });

  // 3.3D-UNIT-010 [P1] AC #5 — DB error on resume → INTERNAL_ERROR
  it('3.3D-UNIT-010: emits INTERNAL_ERROR envelope when DB throws during resume', async () => {
    // ACTIVATION: buildErrorEnvelope replaces printJsonWriteError
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('database connection lost')
    );

    await workflowResumeCommand('run-db-err', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3D-UNIT-039 [P1] R1-F39 — folder project resume skips git check
  it('3.3D-UNIT-039: resume JSON succeeds for a folder project run even when git check would fail', async () => {
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockReset();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder',
      name: 'ops-folder',
      repository_url: null,
      default_cwd: '/tmp/ops-folder',
      kind: 'folder',
      commands: {},
    });

    const git = await import('@archon/git');
    const origExecFileAsync = git.execFileAsync;
    (git.execFileAsync as ReturnType<typeof mock>).mockImplementation((...args: unknown[]) => {
      // Simulate git rev-parse --git-dir failing for folder projects
      const callArgs = args[1] as string[] | undefined;
      if (callArgs && callArgs.includes('rev-parse')) {
        return Promise.reject(new Error('not a git repository'));
      }
      return (origExecFileAsync as ReturnType<typeof mock>)(...args);
    });

    try {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-folder-resume',
        workflow_name: 'assist',
        status: 'paused',
        working_path: '/tmp/ops-folder',
        codebase_id: 'cb-folder',
        metadata: {},
      });

      await workflowResumeCommand('run-folder-resume', true);

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.command).toBe('workflow.resume');
      const result = envelope.result as Record<string, unknown>;
      expect(result.resumable).toBe(true);
      expect(result.executed).toBe(false);
    } finally {
      (git.execFileAsync as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ stdout: '.git\n', stderr: '' })
      );
    }
  });
});

describe('workflowCancelCommand — JSON envelope mode (Story 3.3d)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.error.mockClear();
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockClear();
    (workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>).mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // 3.3D-UNIT-011 [P0] AC #4 — cancel success on a paused run
  it('3.3D-UNIT-011: emits workflow.cancel success envelope with state=cancelled, terminal=true', async () => {
    // ACTIVATION: workflowCancelCommand exists and uses the provider recovery CAS
    // + buildSuccessEnvelope with command 'workflow.cancel'.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cancel-paused',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      metadata: {},
    });
    (workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    // workflowCancelCommand must be exported and callable
    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cancel-paused', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref.runId).toBe('run-cancel-paused');
    expect(ref.workflowName).toBe('implement');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('cancel');
    expect(result.state).toBe('cancelled');
    expect(result.terminal).toBe(true);
    expect(result).not.toHaveProperty('previousState');
    expect(envelope).not.toHaveProperty('error');
  });

  // 3.3D-UNIT-012 [P0] AC #4 — cancel success on a running run
  it('3.3D-UNIT-012: emits workflow.cancel success envelope for a running run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-011; running is cancellable
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cancel-running',
      workflow_name: 'implement',
      status: 'running',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });
    (workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cancel-running', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('cancel');
    expect(result.state).toBe('cancelled');
    expect(result.terminal).toBe(true);
  });

  // 3.3D-UNIT-013 [P0] AC #4 — cancel success on a failed run
  it('3.3D-UNIT-013: emits workflow.cancel success envelope for a failed run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-011
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cancel-failed',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });
    (workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cancel-failed', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.state).toBe('cancelled');
    expect(result.terminal).toBe(true);
  });

  // 3.3D-UNIT-014 [P0] AC #4 — cancel error: completed run → UNEXPECTED_STATE
  it('3.3D-UNIT-014: emits UNEXPECTED_STATE envelope when cancel called on a completed run', async () => {
    // ACTIVATION: workflowCancelCommand pre-checks status before CAS;
    // completed is non-cancellable.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cancel-completed',
      workflow_name: 'implement',
      status: 'completed',
      metadata: {},
    });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cancel-completed', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    expect(error.retryable).toBe(false);
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3D-UNIT-015 [P0] AC #4 — cancel error: already cancelled → UNEXPECTED_STATE
  it('3.3D-UNIT-015: emits UNEXPECTED_STATE envelope when cancel called on an already-cancelled run', async () => {
    // ACTIVATION: same as 3.3D-UNIT-014
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cancel-already',
      workflow_name: 'implement',
      status: 'cancelled',
      metadata: {},
    });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cancel-already', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  // 3.3D-UNIT-016 [P0] AC #4 — cancel error: CAS race loser → UNEXPECTED_STATE
  it('3.3D-UNIT-016: emits UNEXPECTED_STATE envelope when CAS returns cancelled=false', async () => {
    // ACTIVATION: workflowCancelCommand uses the provider recovery CAS directly and
    // checks the `cancelled` boolean; false means CAS lost.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-cas-loser',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });
    const cancelMock = workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>;
    cancelMock.mockReset();
    cancelMock.mockResolvedValueOnce({ cancelled: false });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-cas-loser', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    expect(error.category).toBe('unexpected_state');
    cancelMock.mockImplementation(() => Promise.resolve({ cancelled: true }));
  });

  // 3.3D-UNIT-017 [P0] AC #4 — cancel error: run not found → UNEXPECTED_STATE (R1-F1)
  it('3.3D-UNIT-017: emits UNEXPECTED_STATE envelope when run does not exist for cancel', async () => {
    // ACTIVATION: cancel handler throws with 'Cannot cancel run with status' message
    // which classifies as UNEXPECTED_STATE (R1-F1: recovery commands use UNEXPECTED_STATE).
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('nonexistent-cancel', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(78);
  });

  // 3.3D-UNIT-018 [P1] AC #4 — cancel result has no previousState field
  it('3.3D-UNIT-018: cancel success envelope has no previousState (TD-004)', async () => {
    // ACTIVATION: workflowCancelCommand uses the provider recovery CAS directly,
    // NOT abandonWorkflow which leaks pre-cancel run data.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-prev',
      workflow_name: 'implement',
      status: 'paused',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });
    (workflowDb.cancelRecoveryWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      cancelled: true,
    });

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-no-prev', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('previousState');
    expect(result).not.toHaveProperty('workingPath');
    expect(result).not.toHaveProperty('workflowName');
  });

  // 3.3D-UNIT-041 [P0] TD-007 — recovery classification is typed, not prose-driven
  it('3.3D-UNIT-041: does not classify an untyped English error message as UNEXPECTED_STATE', async () => {
    const rawMessage = "Cannot cancel run with status 'completed'";
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error(rawMessage)
    );

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-untyped-error', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    expect(error.details).toEqual({ requestAccepted: false, reason: 'unexpected_failure' });
    expect(JSON.stringify(envelope)).not.toContain(rawMessage);
  });

  // 3.3D-UNIT-042 [P0] TD-007 — infrastructure timeout uses a stable typed code
  it('3.3D-UNIT-042: maps ETIMEDOUT to COMMAND_TIMEOUT without inspecting message text', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockRejectedValueOnce(
      Object.assign(new Error('opaque infrastructure failure'), { code: 'ETIMEDOUT' })
    );

    const { workflowCancelCommand } = await import('./workflow');
    await workflowCancelCommand('run-timeout', true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.category).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ requestAccepted: false, reason: 'internal_timeout' });
    expect((envelope.execution as Record<string, unknown>).exitCode).toBe(69);
  });
});

describe('workflowRetryCommand — JSON envelope mode (Story 3.3d)', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = spyOnJsonStdout();
    mockLogger.error.mockClear();
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockReset();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({
        id: 'cb-default',
        name: 'test/repo',
        repository_url: null,
        default_cwd: '/tmp/repo',
        commands: {},
      })
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // 3.3D-UNIT-019 [P0] AC #2 — whole-run retry dispatch success
  it('3.3D-UNIT-019: emits workflow.retry success envelope with scope=run, dispatched=true, detached=true', async () => {
    // ACTIVATION: workflowRetryCommand exists, resolves run, spawns detached
    // worker for whole-run retry, returns dispatch-only envelope.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-retry-whole',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: 'cb-1',
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 99999,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-retry-whole', undefined, true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    const ref = envelope.workflowRunRef as Record<string, unknown>;
    expect(ref.runId).toBe('run-retry-whole');
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('retry');
    expect(result.scope).toBe('run');
    expect(result.dispatched).toBe(true);
    expect(result.detached).toBe(true);
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('resumed');
    expect(result).not.toHaveProperty('attempt');
  });

  // 3.3D-UNIT-020 [P0] AC #3 — targeted retry dispatch success
  it('3.3D-UNIT-020: emits workflow.retry success envelope with scope=node, nodeId, dispatched=true', async () => {
    // ACTIVATION: workflowRetryCommand with nodeId parameter spawns a detached
    // worker for targeted node retry.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-retry-node',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 88888,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-retry-node', 'step-3', true);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown>;
    expect(result.operation).toBe('retry');
    expect(result.scope).toBe('node');
    expect(result.nodeId).toBe('step-3');
    expect(result.dispatched).toBe(true);
    expect(result.detached).toBe(true);
  });

  // 3.3D-UNIT-021 [P0] AC #2 — parent does not own whole-run retry eligibility
  it('3.3D-UNIT-021: dispatches a completed run so the exact worker owns eligibility', async () => {
    // TD-002: the parent validates only exact-worker spawn prerequisites. The
    // worker's `workflow resume` command owns the lifecycle decision.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-retry-completed',
      workflow_name: 'implement',
      status: 'completed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 45454,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const callsBefore = mockChildProcessSpawn.mock.calls.length;
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-retry-completed', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect((envelope.result as Record<string, unknown>).dispatched).toBe(true);
    expect(mockChildProcessSpawn.mock.calls.length - callsBefore).toBe(1);
    const workerArgs = (mockChildProcessSpawn.mock.calls[callsBefore]?.[1] ?? []) as string[];
    expect(workerArgs).toContain('resume');
    expect(workerArgs).toContain('run-retry-completed');
  });

  // 3.3D-UNIT-022 [P0] AC #2 — no duplicate lifecycle pre-check in parent
  it('3.3D-UNIT-022: dispatches a running run so the exact worker owns eligibility', async () => {
    // Same ownership proof as UNIT-021 for a second non-resumable state.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-retry-running',
      workflow_name: 'implement',
      status: 'running',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 56565,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-retry-running', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    expect((envelope.result as Record<string, unknown>).dispatched).toBe(true);
  });

  // 3.3D-UNIT-023 [P0] AC #2 — retry error: run not found → UNEXPECTED_STATE (R1-F1)
  it('3.3D-UNIT-023: emits UNEXPECTED_STATE envelope when run does not exist for retry', async () => {
    // The parent cannot construct an exact worker command without a persisted
    // run, so this typed precondition remains parent-owned.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('nonexistent-retry', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('UNEXPECTED_STATE');
  });

  // 3.3D-UNIT-024 [P0] AC #2 — retry error: spawn failure → INTERNAL_ERROR
  it('3.3D-UNIT-024: emits INTERNAL_ERROR envelope when spawn fails for whole-run retry', async () => {
    // ACTIVATION: workflowRetryCommand catches spawn failure and emits
    // INTERNAL_ERROR with exit 70.
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-spawn-fail',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: undefined,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-spawn-fail', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown>;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.category).toBe('implementation_defect');
    const execution = envelope.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(70);
  });

  // 3.3D-UNIT-025 [P0] AC #3 — targeted retry: parent does NOT validate node
  it('3.3D-UNIT-025: targeted retry does not call getWorkflowRun a second time to validate nodeId (TD-003)', async () => {
    // ACTIVATION: workflowRetryCommand with nodeId only validates run exists,
    // NOT the node; node validation is the worker's job.
    const workflowDb = await import('@archon/core/db/workflows');
    const getRun = workflowDb.getWorkflowRun as ReturnType<typeof mock>;
    getRun.mockResolvedValueOnce({
      id: 'run-no-node-check',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 77777,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const callsBefore = getRun.mock.calls.length;
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-no-node-check', 'possibly-invalid-node', true);

    // Only ONE call to getWorkflowRun (run lookup), no second call for node validation
    expect(getRun.mock.calls.length - callsBefore).toBe(1);
    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    expect(envelope.success).toBe(true);
    expect((envelope.result as Record<string, unknown>).nodeId).toBe('possibly-invalid-node');
  });

  // 3.3D-UNIT-026 [P1] AC #2/#3 — retry result has no worker-derived fields
  it('3.3D-UNIT-026: retry envelope result contains no state/resumed/attempt/retryEpoch/safetyRef fields', async () => {
    // ACTIVATION: workflowRetryCommand returns dispatch-only result per TD-002/003
    const workflowDb = await import('@archon/core/db/workflows');
    (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'run-no-worker-fields',
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: '/tmp/wt',
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 66666,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const { workflowRetryCommand } = await import('./workflow');
    await workflowRetryCommand('run-no-worker-fields', undefined, true);

    const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
    const result = envelope.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('resumed');
    expect(result).not.toHaveProperty('attempt');
    expect(result).not.toHaveProperty('retryEpoch');
    expect(result).not.toHaveProperty('safetyRef');
  });

  // R1-F11: whole-run retry worker argv must use the persisted run.id, not the caller input
  it('R1-F11: whole-run retry detached worker argv contains run.id (persisted UUID), not the caller-supplied input', async () => {
    const workflowDb = await import('@archon/core/db/workflows');
    const persistedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const workingPath = '/tmp/wt';
    const getRun = workflowDb.getWorkflowRun as ReturnType<typeof mock>;
    getRun.mockResolvedValueOnce({
      id: persistedId,
      workflow_name: 'implement',
      status: 'failed',
      codebase_id: null,
      working_path: workingPath,
      metadata: {},
    });

    mockChildProcessSpawn.mockReturnValueOnce({
      pid: 55555,
      on: mock(() => undefined),
      unref: mock(() => undefined),
    } as unknown as ReturnType<typeof mockChildProcessSpawn>);
    const callsBefore = mockChildProcessSpawn.mock.calls.length;
    const { workflowRetryCommand } = await import('./workflow');
    // Caller supplies a short prefix; the handler resolves to persistedId via getWorkflowRun.
    await workflowRetryCommand('short-prefix', undefined, true);

    // Exactly one new spawn call from this test
    expect(mockChildProcessSpawn.mock.calls.length - callsBefore).toBe(1);
    const call = mockChildProcessSpawn.mock.calls[callsBefore];
    const args = (call[1] ?? []) as string[];
    // The worker argv must contain the persisted UUID, not the caller's 'short-prefix'.
    expect(args).toContain(persistedId);
    expect(args).not.toContain('short-prefix');
    // Worker runs `workflow resume <run.id>`, not `workflow retry`
    expect(args).toContain('resume');
    expect(args).not.toContain('retry');
    // R1-F20: worker argv must include --cwd bound to the run's persisted working_path
    // so the worker resumes in the exact run's working directory.
    const cwdIdx = args.indexOf('--cwd');
    expect(cwdIdx).toBeGreaterThan(-1);
    expect(args[cwdIdx + 1]).toBe(workingPath);
  });

  // 3.3D-UNIT-040 [P1] R1-F39 — folder project retry skips git check
  it('3.3D-UNIT-040: retry JSON succeeds for a folder project run even when git check would fail', async () => {
    const codebaseDb = await import('@archon/core/db/codebases');
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockReset();
    (codebaseDb.getCodebase as ReturnType<typeof mock>).mockResolvedValueOnce({
      id: 'cb-folder-retry',
      name: 'ops-folder',
      repository_url: null,
      default_cwd: '/tmp/ops-folder',
      kind: 'folder',
      commands: {},
    });

    const git = await import('@archon/git');
    const origExecFileAsync = git.execFileAsync;
    (git.execFileAsync as ReturnType<typeof mock>).mockImplementation((...args: unknown[]) => {
      const callArgs = args[1] as string[] | undefined;
      if (callArgs && callArgs.includes('rev-parse')) {
        return Promise.reject(new Error('not a git repository'));
      }
      return (origExecFileAsync as ReturnType<typeof mock>)(...args);
    });

    try {
      const workflowDb = await import('@archon/core/db/workflows');
      (workflowDb.getWorkflowRun as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'run-folder-retry',
        workflow_name: 'implement',
        status: 'failed',
        working_path: '/tmp/ops-folder',
        codebase_id: 'cb-folder-retry',
        metadata: {},
      });

      mockChildProcessSpawn.mockReturnValueOnce({
        pid: 88888,
        on: mock(() => undefined),
        unref: mock(() => undefined),
      } as unknown as ReturnType<typeof mockChildProcessSpawn>);

      const { workflowRetryCommand } = await import('./workflow');
      await workflowRetryCommand('run-folder-retry', undefined, true);

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const envelope = JSON.parse(firstJsonPayload(stdoutSpy)) as Record<string, unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.command).toBe('workflow.retry');
      const result = envelope.result as Record<string, unknown>;
      expect(result.dispatched).toBe(true);
      expect(result.detached).toBe(true);
    } finally {
      (git.execFileAsync as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({ stdout: '.git\n', stderr: '' })
      );
    }
  });
});

describe('hasUnresolvedWriteback (H2 teardown-preserve decision)', () => {
  it('true when the gate was raised but never resolved (failed/partial apply)', () => {
    expect(hasUnresolvedWriteback({ pending_writeback: { envId: 'e' } })).toBe(true);
  });
  it('false once the write-back resolved (applied/discarded)', () => {
    expect(
      hasUnresolvedWriteback({ pending_writeback: { envId: 'e' }, writeback_resolved: true })
    ).toBe(false);
  });
  it('false for a run that never raised a write-back gate', () => {
    expect(hasUnresolvedWriteback({ isolation: 'container' })).toBe(false);
    expect(hasUnresolvedWriteback(undefined)).toBe(false);
  });
});

describe('resolveContainerBackendConfig', () => {
  it('applies defaults when config is absent', () => {
    const cfg = resolveContainerBackendConfig(undefined);
    expect(cfg).toEqual({
      image: 'archon-runner:latest',
      network: 'bridge',
      memoryMb: 4096,
      pidsLimit: 512,
    });
  });

  it('passes through valid values', () => {
    const cfg = resolveContainerBackendConfig({
      image: '  my-runner:1  ',
      network: 'none',
      memoryMb: 2048,
      pidsLimit: 256,
    });
    expect(cfg).toEqual({
      image: 'my-runner:1',
      network: 'none',
      memoryMb: 2048,
      pidsLimit: 256,
    });
  });

  it('rejects a non bridge/none network (no silent --network host)', () => {
    expect(() => resolveContainerBackendConfig({ network: 'host' })).toThrow(/bridge.*none/);
  });

  it('rejects a fractional memoryMb (docker --memory needs an integer)', () => {
    expect(() => resolveContainerBackendConfig({ memoryMb: 512.5 })).toThrow(/positive integer/);
  });

  it('rejects a non-integer / non-positive pidsLimit', () => {
    expect(() => resolveContainerBackendConfig({ pidsLimit: 10.5 })).toThrow(/positive integer/);
    expect(() => resolveContainerBackendConfig({ pidsLimit: 0 })).toThrow(/positive integer/);
  });
});
