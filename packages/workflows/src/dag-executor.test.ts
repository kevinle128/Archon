import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
  setSystemTime,
  setDefaultTimeout,
  type Mock,
} from 'bun:test';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'os';
import * as git from '@archon/git';

// Windows process creation is far dearer than Linux (no fork; Git-Bash). The
// first real bash-node executeDagWorkflow in this file hit 5765 ms on
// windows-latest under parallel package load — Bun's 5000 ms default. Keep
// the Linux alarm; only widen the Windows budget (same precedent as
// plannotator-gate-executor.test.ts).
if (process.platform === 'win32') {
  setDefaultTimeout(20_000);
}

// --- Mock logger (MUST come before imports of modules under test) ---

const mockLogFn = mock(() => {});
const mockLogger = {
  info: mockLogFn,
  warn: mockLogFn,
  error: mockLogFn,
  debug: mockLogFn,
  trace: mockLogFn,
  fatal: mockLogFn,
  child: mock(() => mockLogger),
};
// Hoisted telemetry mock — declared before the mock.module factory runs so the
// completion-telemetry tests can assert on it.
const mockCaptureWorkflowCompleted = mock(() => {});
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
  getCommandFolderSearchPaths: (folder?: string) => {
    const paths = ['.archon/commands'];
    if (folder) paths.unshift(folder);
    return paths;
  },
  getWorkflowFolderSearchPaths: () => ['.archon/workflows'],
  getDefaultCommandsPath: () => '/nonexistent/defaults',
  getDefaultWorkflowsPath: () => '/nonexistent/defaults/workflows',
  getHomeWorkflowsPath: () => '/nonexistent/home/workflows',
  getLegacyHomeWorkflowsPath: () => '/nonexistent/home/.archon/workflows',
  getArchonHome: () => '/nonexistent/home',
  // Telemetry is fire-and-forget; mock as a no-op so terminal sites can call it.
  // Hoisted so tests can assert outcome / exit_reason at each terminal site.
  captureWorkflowCompleted: mockCaptureWorkflowCompleted,
}));

// --- Bootstrap provider registry (after path mocks, before dag-executor import) ---
import {
  registerBuiltinProviders,
  registerOmpProvider,
  registerOpencodeProvider,
  registerPiProvider,
  registerQoderCliProvider,
  registerDevinProvider,
  registerDeepseekProvider,
  DEVIN_CAPABILITIES,
  DEEPSEEK_CAPABILITIES,
  clearRegistry,
  getRegistration,
} from '@archon/providers';
clearRegistry();
registerBuiltinProviders();
registerOmpProvider();
registerOpencodeProvider();
// Pi is a community provider (best-effort structured output) — register it so the
// reask-loop tests can resolve `getProviderCapabilities('pi')` to 'best-effort'.
// deps.getAgentProvider is mocked, so the real Pi SDK is never loaded.
registerPiProvider();
registerDevinProvider();
registerQoderCliProvider();
// DeepSeek community provider — registry lookup for capabilities + interrupt
// conformance (#187). deps.getAgentProvider stays mocked.
registerDeepseekProvider();

// --- Imports (after mocks) ---
import {
  buildTopologicalLayers,
  checkTriggerRule,
  substituteNodeOutputRefs,
  substituteLoopPrevRefs,
  applyLoopPrevToBodyNode,
  executeDagWorkflow,
  collectContainerIncompatibleProviders,
  collectAskHumanUnsupportedProviders,
  containerCommandName,
  buildSubprocessDockerArgs,
} from './dag-executor';
import type { WorkflowModelScope } from './node-model-resolution';
import { getSteeringRegistry, type NodeSteeringHandle } from './steering-registry';
import { writeNodeArtifact } from './artifacts-index';
import { getWorkflowEventEmitter, type WorkflowEmitterEvent } from './event-emitter';
import { loadMcpConfig } from '@archon/providers/mcp/config';
import type {
  ApprovalContext,
  DagNode,
  BashNode,
  ScriptNode,
  NodeOutput,
  WorkflowRun,
  WorkflowDefinition,
  PendingInteraction,
} from './schemas';
import { dagNodeSchema } from './schemas';
import { discoverWorkflows } from './workflow-discovery';
import { parseWorkflow } from './loader';
import { expandWorkflowIncludes } from './include-expander';
import { OutputRefError } from './output-ref';
import type { WorkflowDeps, IWorkflowPlatform, WorkflowConfig } from './deps';
import type { IWorkflowStore, WorkflowEventData } from './store';
import { buildAiProfile } from './model-validation';
import {
  AskHumanNoStarterError,
  AskHumanPauseFailedError,
  type SendQueryOptions,
} from '@archon/providers/types';
import * as plannotatorGateExecutor from './plannotator-gate-executor';
import { applyEnvOverlay } from './env-overlay';

// --- Mock helpers ---

function createMockStore(): IWorkflowStore {
  let nodeMessageSeq = 0;
  const nodeMessages: Awaited<ReturnType<IWorkflowStore['appendNodeMessage']>>[] = [];
  return {
    createWorkflowRun: mock(() =>
      Promise.resolve({
        id: 'mock-run-id',
        workflow_name: 'mock',
        conversation_id: 'conv-mock',
        parent_conversation_id: null,
        codebase_id: null,
        status: 'running' as const,
        user_message: 'mock message',
        metadata: {},
        started_at: new Date(),
        completed_at: null,
        last_activity_at: null,
        working_path: null,
        parent_run_id: null,
      })
    ),
    getWorkflowRun: mock(() => Promise.resolve(null)),
    findChildRuns: mock(() => Promise.resolve([])),
    getRunAncestry: mock(() => Promise.resolve([])),
    getActiveWorkflowRunByPath: mock(() => Promise.resolve(null)),
    failOrphanedRuns: mock(() => Promise.resolve({ count: 0 })),
    findResumableRun: mock(() => Promise.resolve(null)),
    resumeWorkflowRun: mock(() =>
      Promise.resolve({
        id: 'mock-run-id',
        workflow_name: 'mock',
        conversation_id: 'conv-mock',
        parent_conversation_id: null,
        codebase_id: null,
        status: 'running' as const,
        user_message: 'mock message',
        metadata: {},
        started_at: new Date(),
        completed_at: null,
        last_activity_at: null,
        working_path: null,
        parent_run_id: null,
      })
    ),
    resumeApprovedGate: mock(() => Promise.resolve({ resumed: true })),
    updateWorkflowRun: mock(() => Promise.resolve()),
    setWorkflowRunEnvOverlay: mock(() =>
      Promise.resolve({
        id: 'mock-run-id',
        workflow_name: 'mock',
        conversation_id: 'conv-mock',
        parent_conversation_id: null,
        codebase_id: null,
        status: 'running' as const,
        user_message: 'mock message',
        metadata: {},
        started_at: new Date(),
        completed_at: null,
        last_activity_at: null,
        working_path: null,
        parent_run_id: null,
      })
    ),
    resolveApprovalGate: mock(() => Promise.resolve({ resolved: true })),
    transitionPlannotatorGate: mock(
      (input: Parameters<IWorkflowStore['transitionPlannotatorGate']>[0]) =>
        Promise.resolve({
          outcome: 'updated' as const,
          approval: {
            nodeId: input.nodeId,
            message: '',
            type: 'plannotator_gate' as const,
            gateId: input.nextGateId ?? input.expectedGateId,
            document: input.document,
            phase: input.phase,
          },
        })
    ),
    persistRouteDecisionTransition: mock(
      (input: Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0]) =>
        Promise.resolve({
          id: input.workflow_run_id,
          workflow_name: 'mock',
          conversation_id: 'conv-mock',
          parent_conversation_id: null,
          codebase_id: null,
          status: 'running' as const,
          user_message: 'mock message',
          metadata: input.metadata,
          started_at: new Date(),
          completed_at: null,
          last_activity_at: null,
          working_path: null,
        })
    ),
    updateWorkflowActivity: mock(() => Promise.resolve()),
    getWorkflowRunStatus: mock(() => Promise.resolve('running' as const)),
    completeWorkflowRun: mock(() => Promise.resolve()),
    failWorkflowRun: mock(() => Promise.resolve()),
    pauseWorkflowRun: mock(() => Promise.resolve()),
    claimWriteback: mock(() => Promise.resolve({ claimed: true })),
    releaseWritebackClaim: mock(() => Promise.resolve()),
    cancelWorkflowRun: mock(() => Promise.resolve()),
    createWorkflowEvent: mock(() => Promise.resolve()),
    enqueueExternalWorkflowEvent: mock(() => Promise.resolve()),
    getDagResumeSnapshot: mock(() =>
      Promise.resolve({
        completedNodeOutputs: new Map<string, string>(),
        tokens: { input: 0, output: 0 },
      })
    ),
    getCodebase: mock(() => Promise.resolve(null)),
    getCodebaseEnvVars: mock(() => Promise.resolve({})),
    getWorkflowNodeSession: mock(() => Promise.resolve(null)),
    upsertWorkflowNodeSession: mock(() => Promise.resolve()),
    deleteWorkflowNodeSessions: mock(() => Promise.resolve({ deleted: 0 })),
    appendNodeMessage: async input => {
      const row = {
        ...input,
        id: `node-message-${String(++nodeMessageSeq)}`,
        seq: nodeMessageSeq,
        created_at: new Date(),
      };
      nodeMessages.push(row);
      return row;
    },
    listNodeMessages: async (workflowRunId, nodeId) =>
      nodeMessages
        .filter(row => row.workflow_run_id === workflowRunId && row.node_id === nodeId)
        .sort((a, b) => a.seq - b.seq),
    insertPendingInteraction: mock(async input => ({
      ...input,
      id: 'pending-1',
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
    })),
    listPendingInteractions: mock(async () => []),
    resolvePendingInteraction: mock(async input => ({
      interaction: {
        id: 'pending-1',
        workflow_run_id: input.workflow_run_id,
        node_id: 'review',
        tool_use_id: input.tool_use_id,
        kind: 'ask' as const,
        status: 'answered' as const,
        envelope: {},
        answer: input.answer,
        provider_session_id: 'sess-1',
        created_at: new Date(),
        resolved_at: new Date(),
        resolved_by: input.resolved_by,
      },
      resumed: false,
      remaining_pending: 0,
    })),
  };
}

/** All-true capabilities for Claude mock */
const mockClaudeCapabilities = () => ({
  sessionResume: true,
  mcp: true,
  hooks: true,
  skills: true,
  agents: true,
  toolRestrictions: true,
  structuredOutput: 'enforced' as const,
  envInjection: true,
  costControl: true,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: true,
  sandbox: true,
  settingSources: true,
});
/** Capabilities for Codex mock */
const mockCodexCapabilities = () => ({
  sessionResume: true,
  mcp: true,
  hooks: false,
  skills: true,
  agents: false,
  toolRestrictions: false,
  structuredOutput: 'enforced' as const,
  envInjection: true,
  costControl: false,
  effortControl: true,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
});

/** Mock AI sendQuery generator */
const mockSendQueryDag = mock(function* () {
  yield { type: 'assistant', content: 'DAG AI response' };
  yield { type: 'result', sessionId: 'dag-session-id' };
});

const mockGetAgentProviderDag = mock(() => ({
  sendQuery: mockSendQueryDag,
  getType: () => 'claude',
  getCapabilities: mockClaudeCapabilities,
}));

function createMockDeps(storeOverride?: IWorkflowStore): WorkflowDeps {
  const store = storeOverride ?? createMockStore();
  return {
    store,
    usageRecorder: {
      recordWorkflowUsage: mock(() => Promise.resolve()),
    },
    getAgentProvider: mockGetAgentProviderDag,
    loadConfig: mock(() =>
      Promise.resolve({
        assistant: 'claude' as const,
        prRemote: 'origin',
        commands: {},
        defaults: { loadDefaultCommands: false, loadDefaultWorkflows: false },
        assistants: { claude: {}, codex: {} },
      })
    ),
  };
}

function createMockPlatform(): IWorkflowPlatform {
  return {
    sendMessage: mock(() => Promise.resolve()),
    getStreamingMode: mock(() => 'batch' as const),
    getPlatformType: mock(() => 'test'),
    sendStructuredEvent: mock(() => Promise.resolve()),
  };
}

const minimalConfig: WorkflowConfig = {
  assistant: 'claude',
  prRemote: 'origin',
  assistants: { claude: {}, codex: {} },
  commands: {},
  defaults: { loadDefaultCommands: false, loadDefaultWorkflows: false },
};

// --- Helpers ---

function node(id: string, depends_on?: string[], opts?: Partial<DagNode>): DagNode {
  return { id, command: id, ...(depends_on?.length ? { depends_on } : {}), ...opts };
}

/**
 * Build a NodeOutput fixture for substitution tests.
 * Omits `structuredOutput` when undefined so the `'structuredOutput' in nodeOutput` presence
 * check in substituteNodeOutputRefs matches real producer behavior (Pi/Codex/Claude populate
 * it; older providers and the pending/skipped states leave it off).
 */
function makeOutput(
  state: NodeOutput['state'],
  output = '',
  structuredOutput?: unknown,
  declaredFields?: string[]
): NodeOutput {
  const extra = {
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    ...(declaredFields !== undefined ? { declaredFields } : {}),
  };
  if (state === 'failed') {
    return { state, output, error: 'error', ...extra } as NodeOutput;
  }
  if (state === 'pending' || state === 'skipped') {
    return { state, output } as NodeOutput;
  }
  return { state, output, ...extra } as NodeOutput;
}

function makeWorkflowRun(id = 'dag-test-run-id', overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id,
    workflow_name: 'dag-test',
    conversation_id: 'conv-dag',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'dag test message',
    metadata: {},
    started_at: new Date(),
    completed_at: null,
    last_activity_at: null,
    working_path: null,
    parent_run_id: null,
    ...overrides,
  };
}

// --- Tests ---

describe('buildTopologicalLayers', () => {
  it('single node with no dependencies -> one layer', () => {
    const layers = buildTopologicalLayers([node('a')]);
    expect(layers).toHaveLength(1);
    expect(layers[0].map(n => n.id)).toEqual(['a']);
  });

  it('linear chain -> one node per layer', () => {
    const layers = buildTopologicalLayers([node('a'), node('b', ['a']), node('c', ['b'])]);
    expect(layers).toHaveLength(3);
    expect(layers[0].map(n => n.id)).toEqual(['a']);
    expect(layers[1].map(n => n.id)).toEqual(['b']);
    expect(layers[2].map(n => n.id)).toEqual(['c']);
  });

  it('fan-out: classify -> [investigate, plan] in same layer', () => {
    const layers = buildTopologicalLayers([
      node('classify'),
      node('investigate', ['classify']),
      node('plan', ['classify']),
    ]);
    expect(layers).toHaveLength(2);
    expect(layers[0].map(n => n.id)).toEqual(['classify']);
    const layer1Ids = layers[1].map(n => n.id).sort();
    expect(layer1Ids).toEqual(['investigate', 'plan']);
  });

  it('fan-in: [a, b] -> implement in its own layer', () => {
    const layers = buildTopologicalLayers([node('a'), node('b'), node('implement', ['a', 'b'])]);
    expect(layers).toHaveLength(2);
    expect(layers[0].map(n => n.id).sort()).toEqual(['a', 'b']);
    expect(layers[1].map(n => n.id)).toEqual(['implement']);
  });

  it('diamond: classify -> [investigate, plan] -> implement', () => {
    const layers = buildTopologicalLayers([
      node('classify'),
      node('investigate', ['classify']),
      node('plan', ['classify']),
      node('implement', ['investigate', 'plan']),
    ]);
    expect(layers).toHaveLength(3);
    expect(layers[0].map(n => n.id)).toEqual(['classify']);
    expect(layers[1].map(n => n.id).sort()).toEqual(['investigate', 'plan']);
    expect(layers[2].map(n => n.id)).toEqual(['implement']);
  });

  it('throws on cyclic graph (runtime safety check)', () => {
    const cyclic = [node('a', ['b']), node('b', ['a'])];
    expect(() => buildTopologicalLayers(cyclic)).toThrow('Cycle detected');
  });

  it('self-referential node throws', () => {
    const selfRef = [node('a', ['a'])];
    expect(() => buildTopologicalLayers(selfRef)).toThrow('Cycle detected');
  });

  it('two independent chains share layers correctly', () => {
    const layers = buildTopologicalLayers([
      node('a'),
      node('b', ['a']),
      node('c'),
      node('d', ['c']),
    ]);
    expect(layers).toHaveLength(2);
    expect(layers[0].map(n => n.id).sort()).toEqual(['a', 'c']);
    expect(layers[1].map(n => n.id).sort()).toEqual(['b', 'd']);
  });
});

describe('checkTriggerRule', () => {
  it('all_success: runs when all deps completed', () => {
    const n = node('b', ['a']);
    const outputs = new Map([['a', makeOutput('completed')]]);
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });

  it('all_success: skips when one dep failed', () => {
    const n = node('c', ['a', 'b']);
    const outputs = new Map([
      ['a', makeOutput('completed')],
      ['b', makeOutput('failed')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('all_success: skips when one dep skipped (skipped != success)', () => {
    const n = node('c', ['a', 'b']);
    const outputs = new Map([
      ['a', makeOutput('completed')],
      ['b', makeOutput('skipped')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('one_success: runs when at least one dep completed', () => {
    const n = node('c', ['a', 'b'], { trigger_rule: 'one_success' });
    const outputs = new Map([
      ['a', makeOutput('completed')],
      ['b', makeOutput('failed')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });

  it('one_success: skips when no deps completed', () => {
    const n = node('c', ['a', 'b'], { trigger_rule: 'one_success' });
    const outputs = new Map([
      ['a', makeOutput('failed')],
      ['b', makeOutput('skipped')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('none_failed_min_one_success: runs with skipped branch and completed branch', () => {
    const n = node('implement', ['investigate', 'plan'], {
      trigger_rule: 'none_failed_min_one_success',
    });
    const outputs = new Map([
      ['investigate', makeOutput('skipped')],
      ['plan', makeOutput('completed')],
    ]);
    // skipped is not failed, plan succeeded -> run
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });

  it('none_failed_min_one_success: skips when one failed', () => {
    const n = node('implement', ['investigate', 'plan'], {
      trigger_rule: 'none_failed_min_one_success',
    });
    const outputs = new Map([
      ['investigate', makeOutput('failed')],
      ['plan', makeOutput('completed')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('all_done: runs when all deps are in a terminal state', () => {
    const n = node('c', ['a', 'b'], { trigger_rule: 'all_done' });
    const outputs = new Map([
      ['a', makeOutput('failed')],
      ['b', makeOutput('skipped')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });

  it('all_done: skips when a dep is still running', () => {
    const n = node('c', ['a', 'b'], { trigger_rule: 'all_done' });
    const outputs = new Map([
      ['a', makeOutput('running')],
      ['b', makeOutput('completed')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('no deps: always runs', () => {
    const n = node('a');
    const outputs = new Map<string, NodeOutput>();
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });

  it('all_success: skips when upstream absent from outputs (synthesised as failed)', () => {
    const n = node('c', ['a', 'b']);
    const outputs = new Map([['a', makeOutput('completed')]]);
    // 'b' is absent -> synthesised as failed -> all_success skips
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('all_done: runs when absent upstream is synthesised as failed (failed is terminal)', () => {
    const n = node('c', ['a'], { trigger_rule: 'all_done' });
    const outputs = new Map<string, NodeOutput>(); // 'a' absent -> synthesised as failed -> terminal
    expect(checkTriggerRule(n, outputs)).toBe('run');
  });
});

describe('checkTriggerRule -- classify-gated pipeline behavior on failure', () => {
  it('all_success aspect skips when classify failed', () => {
    const aspect = node('code-review', ['review-classify']);
    const outputs = new Map([['review-classify', makeOutput('failed', '')]]);
    expect(checkTriggerRule(aspect, outputs)).toBe('skip');
  });

  it('one_success synthesize skips when all aspects skipped (classify failed)', () => {
    const synth = node('synthesize-review', ['code-review', 'error-handling', 'test-coverage'], {
      trigger_rule: 'one_success',
    });
    const outputs = new Map([
      ['code-review', makeOutput('skipped')],
      ['error-handling', makeOutput('skipped')],
      ['test-coverage', makeOutput('skipped')],
    ]);
    expect(checkTriggerRule(synth, outputs)).toBe('skip');
  });
});

describe('DAG Loader -- cycle detection', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('rejects cyclic DAG at load time', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'cyclic.yaml'),
      `
name: cyclic-dag
description: A cyclic dag
nodes:
  - id: a
    command: plan
    depends_on: [b]
  - id: b
    command: implement
    depends_on: [a]
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/cycle/i);
  });

  it('rejects unknown depends_on reference', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'bad-ref.yaml'),
      `
name: bad-ref
description: Bad dep ref
nodes:
  - id: a
    command: plan
    depends_on: [nonexistent]
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/nonexistent/);
  });

  it('rejects duplicate node IDs', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'dup-ids.yaml'),
      `
name: dup-ids
description: Duplicate node IDs
nodes:
  - id: a
    command: plan
  - id: a
    command: implement
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/duplicate/i);
  });

  it('rejects node with both command and prompt', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'both.yaml'),
      `
name: both-cmd-prompt
description: Both command and prompt
nodes:
  - id: a
    command: plan
    prompt: "do something"
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/mutually exclusive/i);
  });

  it('rejects node with neither command nor prompt', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'neither.yaml'),
      `
name: no-cmd-or-prompt
description: No command or prompt
nodes:
  - id: a
    depends_on: []
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/must have either/i);
  });

  it('accepts valid DAG with fan-out, when: conditions, and trigger_rule', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'valid.yaml'),
      `
name: classify-and-fix
description: Classify then fix or plan
nodes:
  - id: classify
    command: classify-issue
    output_format:
      type: object
      properties:
        type:
          type: string
          enum: [BUG, FEATURE]
      required: [type]
  - id: investigate
    command: investigate-bug
    depends_on: [classify]
    when: "$classify.output.type == 'BUG'"
  - id: plan
    command: plan-feature
    depends_on: [classify]
    when: "$classify.output.type == 'FEATURE'"
  - id: implement
    command: implement-changes
    depends_on: [investigate, plan]
    trigger_rule: none_failed_min_one_success
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const wf = result.workflows[0].workflow;
    expect(wf.nodes).toHaveLength(4);
    expect(wf.nodes[0].id).toBe('classify');
    expect(wf.nodes[0].output_format).toBeDefined();
    expect(wf.nodes[1].when).toBe("$classify.output.type == 'BUG'");
    expect(wf.nodes[3].trigger_rule).toBe('none_failed_min_one_success');
  });

  it('accepts inline prompt nodes', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'inline-prompt.yaml'),
      `
name: inline-prompts
description: DAG with inline prompts
nodes:
  - id: step-a
    prompt: "Output exactly: hello from A"
  - id: step-b
    prompt: "Output exactly: hello from B"
    depends_on: [step-a]
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const wf = result.workflows[0].workflow;
    expect(wf.nodes).toBeDefined();
    expect(wf.nodes[0].prompt).toBe('Output exactly: hello from A');
    expect(wf.nodes[1].depends_on).toEqual(['step-a']);
  });

  it('ignores unknown top-level fields when valid nodes: is present', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'nodes-extra.yaml'),
      `
name: extra-fields
description: Has extra top-level fields that are ignored
nodes:
  - id: a
    command: plan
loop:
  until: COMPLETE
  max_iterations: 5
prompt: "do something"
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].workflow.name).toBe('extra-fields');
  });

  it('rejects node with invalid trigger_rule', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'bad-rule.yaml'),
      `
name: bad-trigger-rule
description: Invalid trigger rule
nodes:
  - id: a
    command: plan
  - id: b
    command: implement
    depends_on: [a]
    trigger_rule: all-success
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/trigger_rule/i);
  });

  it('parses allowed_tools and denied_tools on DAG nodes', async () => {
    const wfDir = join(testDir, '.archon', 'workflows');
    await mkdir(wfDir, { recursive: true });

    await writeFile(
      join(wfDir, 'tool-restrictions.yaml'),
      `
name: tool-restriction-test
description: Test tool restrictions
nodes:
  - id: review
    command: code-review
    allowed_tools: [Read, Grep, Glob]
  - id: implement
    command: implement-feature
    denied_tools: [WebSearch, WebFetch]
  - id: mcp-only
    command: mcp-command
    allowed_tools: []
`
    );

    const result = await discoverWorkflows(testDir, { loadDefaults: false });
    expect(result.errors).toHaveLength(0);
    const wf = result.workflows
      .map(ws => ws.workflow)
      .find(w => w.name === 'tool-restriction-test');
    expect(wf).toBeDefined();
    if (!wf) return;

    expect(wf.nodes[0].allowed_tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(wf.nodes[0].denied_tools).toBeUndefined();

    expect(wf.nodes[1].denied_tools).toEqual(['WebSearch', 'WebFetch']);
    expect(wf.nodes[1].allowed_tools).toBeUndefined();

    // Empty array must be preserved (distinct from absent)
    expect(wf.nodes[2].allowed_tools).toEqual([]);
  });
});

describe('substituteNodeOutputRefs', () => {
  it('replaces $nodeId.output with node output text', () => {
    const outputs = new Map([['a', makeOutput('completed', 'hello')]]);
    expect(substituteNodeOutputRefs('Result: $a.output', outputs)).toBe('Result: hello');
  });

  it('unknown node ref resolves to empty string and logs a warning', () => {
    mockLogFn.mockClear();
    const outputs = new Map<string, NodeOutput>();
    expect(substituteNodeOutputRefs('Result: $missing.output', outputs)).toBe('Result: ');
    const warnCalls = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag_node_output_ref_unknown_node'
    );
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0][0]).toEqual(expect.objectContaining({ nodeId: 'missing' }));
  });

  it('dot notation extracts JSON field', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ type: 'BUG' }))]]);
    expect(substituteNodeOutputRefs('Fix $a.output.type issue', outputs)).toBe('Fix BUG issue');
  });

  it('dot notation on invalid JSON throws (no-silent-drop)', () => {
    // Schemaless node, output is not a JSON object → a `.field` ref is a drop the
    // author must see. Throws (propagates to fail the consuming node) instead of ''.
    const outputs = new Map([['a', makeOutput('completed', 'not-json')]]);
    expect(() => substituteNodeOutputRefs('$a.output.field', outputs)).toThrow(OutputRefError);
  });

  it('declared-optional field absent resolves to empty (the one non-throw case)', () => {
    const outputs = new Map([
      ['a', makeOutput('completed', '{"type":"BUG"}', { type: 'BUG' }, ['type', 'note'])],
    ]);
    expect(substituteNodeOutputRefs('$a.output.note', outputs)).toBe('');
  });

  it('field not in the declared schema throws (typo)', () => {
    const outputs = new Map([
      ['a', makeOutput('completed', '{"type":"BUG"}', { type: 'BUG' }, ['type'])],
    ]);
    expect(() => substituteNodeOutputRefs('$a.output.tpye', outputs)).toThrow(OutputRefError);
  });

  it('schemaless JSON node missing a referenced key throws', () => {
    const outputs = new Map([['a', makeOutput('completed', '{"type":"BUG"}')]]);
    expect(() => substituteNodeOutputRefs('$a.output.missing', outputs)).toThrow(OutputRefError);
  });

  it('unknown node ref WITH a field throws (no-silent-drop, unknown-node)', () => {
    // The whole-text `$missing.output` form stays lenient ('' — see test above), but a
    // `.field` ref to an unknown id is a typo the load-time validator can't always see
    // (bash/script/approval/cancel + command-file refs aren't scanned). It must fail the
    // consuming node loudly, matching known-producer strict-field posture.
    const outputs = new Map([['analyze', makeOutput('completed', '{"type":"BUG"}')]]);
    let caught: unknown;
    try {
      substituteNodeOutputRefs('Fix $analze.output.type', outputs);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputRefError);
    expect((caught as OutputRefError).reason).toBe('unknown-node');
    // did-you-mean names the near miss.
    expect((caught as OutputRefError).message).toContain("'analyze'");
  });

  it('unknown node ref WITH a field throws even in bash-escaped mode', () => {
    const outputs = new Map<string, NodeOutput>();
    expect(() => substituteNodeOutputRefs('echo $missing.output.field', outputs, true)).toThrow(
      OutputRefError
    );
  });
});

describe('substituteNodeOutputRefs -- shell escaping', () => {
  it('does not escape by default (AI prompt substitution)', () => {
    const outputs = new Map([['a', makeOutput('completed', 'hello; rm -rf /')]]);
    expect(substituteNodeOutputRefs('Result: $a.output', outputs)).toBe('Result: hello; rm -rf /');
  });

  it('shell-quotes output when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', 'hello world')]]);
    expect(substituteNodeOutputRefs('echo $a.output', outputs, true)).toBe("echo 'hello world'");
  });

  it('escapes shell metacharacters when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', 'hello; rm -rf /')]]);
    expect(substituteNodeOutputRefs('echo $a.output', outputs, true)).toBe(
      "echo 'hello; rm -rf /'"
    );
  });

  it('escapes single quotes inside output when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', "it's alive")]]);
    expect(substituteNodeOutputRefs('echo $a.output', outputs, true)).toBe("echo 'it'\\''s alive'");
  });

  it('missing ref becomes empty string when escapedForBash=true', () => {
    const outputs = new Map<string, NodeOutput>();
    expect(substituteNodeOutputRefs('echo $missing.output', outputs, true)).toBe("echo ''");
  });

  it('JSON field escapes shell metacharacters when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ cmd: 'foo; bar' }))]]);
    expect(substituteNodeOutputRefs('echo $a.output.cmd', outputs, true)).toBe("echo 'foo; bar'");
  });

  it('numeric JSON field is not quoted (safe as-is)', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ count: 42 }))]]);
    expect(substituteNodeOutputRefs('exit $a.output.count', outputs, true)).toBe('exit 42');
  });

  it('boolean JSON field is not quoted (safe as-is)', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ ok: true }))]]);
    expect(substituteNodeOutputRefs('[ $a.output.ok ]', outputs, true)).toBe('[ true ]');
  });

  it('empty string output becomes quoted empty string when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', '')]]);
    expect(substituteNodeOutputRefs('echo $a.output', outputs, true)).toBe("echo ''");
  });

  it('embedded newline in output is safe when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', 'hello\nworld')]]);
    // Single-quoted bash strings can contain literal newlines safely
    expect(substituteNodeOutputRefs('echo $a.output', outputs, true)).toBe("echo 'hello\nworld'");
  });

  it('object JSON field becomes JSON stringified when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ nested: { x: 1 } }))]]);
    expect(substituteNodeOutputRefs('echo $a.output.nested', outputs, true)).toBe(
      'echo \'{"x":1}\''
    );
  });

  it('array JSON field becomes JSON stringified', () => {
    const outputs = new Map([
      ['a', makeOutput('completed', JSON.stringify({ items: ['todo', 'fix'] }))],
    ]);
    expect(substituteNodeOutputRefs('$a.output.items', outputs)).toBe('["todo","fix"]');
  });

  it('array JSON field is shell-quoted when escapedForBash=true', () => {
    const outputs = new Map([
      ['a', makeOutput('completed', JSON.stringify({ items: ['todo', 'fix'] }))],
    ]);
    expect(substituteNodeOutputRefs('echo $a.output.items', outputs, true)).toBe(
      'echo \'["todo","fix"]\''
    );
  });

  it('nested object in array field becomes JSON stringified', () => {
    const outputs = new Map([
      [
        'a',
        makeOutput('completed', JSON.stringify({ files: [{ name: 'a.ts', status: 'modified' }] })),
      ],
    ]);
    expect(substituteNodeOutputRefs('$a.output.files', outputs)).toBe(
      '[{"name":"a.ts","status":"modified"}]'
    );
  });

  it('null values in arrays stringify to "null"', () => {
    const outputs = new Map([
      ['a', makeOutput('completed', JSON.stringify({ items: [null, 'ok'] }))],
    ]);
    expect(substituteNodeOutputRefs('$a.output.items', outputs)).toBe('[null,"ok"]');
  });

  it('null object field becomes JSON stringified "null"', () => {
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ config: null }))]]);
    expect(substituteNodeOutputRefs('$a.output.config', outputs)).toBe('null');
  });

  it('dot notation on invalid JSON throws even when escapedForBash=true', () => {
    const outputs = new Map([['a', makeOutput('completed', 'not-json')]]);
    expect(() => substituteNodeOutputRefs('$a.output.field', outputs, true)).toThrow(
      OutputRefError
    );
  });
});

describe('substituteNodeOutputRefs -- large output file substitution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `archon-test-large-output-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('inlines small output even when outputFileDir is provided', () => {
    const outputs = new Map([['a', makeOutput('completed', 'small')]]);
    const result = substituteNodeOutputRefs('echo $a.output', outputs, true, tempDir);
    expect(result).toBe("echo 'small'");
  });

  it('writes large output (>=32KB) to file and returns $(cat ...) reference', async () => {
    const largeOutput = 'x'.repeat(33_000);
    const outputs = new Map([['a', makeOutput('completed', largeOutput)]]);
    const result = substituteNodeOutputRefs('echo $a.output', outputs, true, tempDir);
    expect(result).toContain('$(cat ');
    expect(result).toContain('a.nodeoutput');
    // Verify file was written with correct content
    const { readFile: readFileAsync } = await import('fs/promises');
    const written = await readFileAsync(join(tempDir, 'a.nodeoutput'), 'utf-8');
    expect(written).toBe(largeOutput);
  });

  it('writes large field value to file with field name in filename', async () => {
    const largeValue = 'y'.repeat(33_000);
    const outputs = new Map([['a', makeOutput('completed', JSON.stringify({ data: largeValue }))]]);
    const result = substituteNodeOutputRefs('echo $a.output.data', outputs, true, tempDir);
    expect(result).toContain('$(cat ');
    expect(result).toContain('a.data.nodeoutput');
    const { readFile: readFileAsync } = await import('fs/promises');
    const written = await readFileAsync(join(tempDir, 'a.data.nodeoutput'), 'utf-8');
    expect(written).toBe(largeValue);
  });

  it('does not write to file when escapedForBash=false even for large output', () => {
    const largeOutput = 'x'.repeat(33_000);
    const outputs = new Map([['a', makeOutput('completed', largeOutput)]]);
    const result = substituteNodeOutputRefs('echo $a.output', outputs, false, tempDir);
    expect(result).toBe(`echo ${largeOutput}`);
    expect(result).not.toContain('$(cat ');
  });

  it('falls back to shell-quoting when file write fails', () => {
    const largeOutput = 'x'.repeat(33_000);
    const outputs = new Map([['a', makeOutput('completed', largeOutput)]]);
    // Use a non-existent directory to trigger writeFileSync failure
    const badDir = '/nonexistent-path-that-does-not-exist';
    const result = substituteNodeOutputRefs('echo $a.output', outputs, true, badDir);
    // Should fall back to inline shell-quoting instead of crashing
    expect(result).not.toContain('$(cat ');
    expect(result).toBe(`echo '${largeOutput}'`);
  });
});

describe('substituteNodeOutputRefs -- structuredOutput preference', () => {
  it('prefers structuredOutput.field over JSON.parse(output)', () => {
    // Pi-shape: prose output text with structuredOutput populated by tryParseStructuredOutput.
    const outputs = new Map([
      [
        'classify',
        makeOutput('completed', 'Here is the classification: {"type":"WRONG"}', {
          type: 'BUG',
          confidence: 0.9,
        }),
      ],
    ]);
    expect(substituteNodeOutputRefs('Fix $classify.output.type issue', outputs)).toBe(
      'Fix BUG issue'
    );
  });

  it('falls back to JSON.parse(output) when structuredOutput is absent', () => {
    // Claude/Codex backward-compat regression: no structuredOutput, JSON in `output`.
    const outputs = new Map([
      ['classify', makeOutput('completed', JSON.stringify({ type: 'BUG' }))],
    ]);
    expect(substituteNodeOutputRefs('Fix $classify.output.type issue', outputs)).toBe(
      'Fix BUG issue'
    );
  });

  it('coerces structuredOutput numeric field to string', () => {
    const outputs = new Map([['score', makeOutput('completed', '', { confidence: 0.95 })]]);
    expect(substituteNodeOutputRefs('score=$score.output.confidence', outputs)).toBe('score=0.95');
  });

  it('coerces structuredOutput boolean field to string', () => {
    const outputs = new Map([['n', makeOutput('completed', '', { ok: true })]]);
    expect(substituteNodeOutputRefs('[ $n.output.ok ]', outputs)).toBe('[ true ]');
  });

  it('JSON-stringifies object structuredOutput field', () => {
    const outputs = new Map([['n', makeOutput('completed', '', { nested: { x: 1 } })]]);
    expect(substituteNodeOutputRefs('$n.output.nested', outputs)).toBe('{"x":1}');
  });

  it('JSON-stringifies array structuredOutput field', () => {
    const outputs = new Map([['n', makeOutput('completed', '', { items: ['todo', 'fix'] })]]);
    expect(substituteNodeOutputRefs('$n.output.items', outputs)).toBe('["todo","fix"]');
  });

  it('works with empty output text (Pi-only-structured case)', () => {
    // structuredOutput populated, output text empty → dot-access still works.
    const outputs = new Map([['classify', makeOutput('completed', '', { type: 'BUG' })]]);
    expect(substituteNodeOutputRefs('Fix $classify.output.type issue', outputs)).toBe(
      'Fix BUG issue'
    );
  });

  it('null structuredOutput falls through to JSON.parse fallback', () => {
    const outputs = new Map([
      ['n', makeOutput('completed', JSON.stringify({ type: 'BUG' }), null)],
    ]);
    expect(substituteNodeOutputRefs('$n.output.type', outputs)).toBe('BUG');
  });

  it('top-level-array structuredOutput falls through to JSON.parse fallback', () => {
    const outputs = new Map([
      ['n', makeOutput('completed', JSON.stringify({ type: 'BUG' }), [1, 2, 3])],
    ]);
    expect(substituteNodeOutputRefs('$n.output.type', outputs)).toBe('BUG');
  });

  it('primitive structuredOutput falls through to JSON.parse fallback', () => {
    const outputs = new Map([
      ['n', makeOutput('completed', JSON.stringify({ type: 'BUG' }), 'just-a-string')],
    ]);
    expect(substituteNodeOutputRefs('$n.output.type', outputs)).toBe('BUG');
  });

  it('missing field in structuredOutput resolves to empty string (no JSON.parse retry)', () => {
    // structuredOutput is authoritative; if the field is missing, do not retry output.
    const outputs = new Map([
      ['classify', makeOutput('completed', JSON.stringify({ type: 'BUG' }), { confidence: 0.9 })],
    ]);
    expect(substituteNodeOutputRefs('Fix $classify.output.type issue', outputs)).toBe('Fix  issue');
  });

  it('bare $node.output reference (no field) uses output text, not structuredOutput', () => {
    const outputs = new Map([['n', makeOutput('completed', 'prose text', { type: 'BUG' })]]);
    expect(substituteNodeOutputRefs('Got: $n.output', outputs)).toBe('Got: prose text');
  });

  it('structuredOutput field is shell-quoted when escapedForBash=true', () => {
    const outputs = new Map([['n', makeOutput('completed', '', { cmd: 'foo; bar' })]]);
    expect(substituteNodeOutputRefs('echo $n.output.cmd', outputs, true)).toBe("echo 'foo; bar'");
  });
});

describe('checkTriggerRule -- missing upstream treated as failed', () => {
  it('none_failed_min_one_success: skips when all deps skipped (no success)', () => {
    const n = node('implement', ['a', 'b'], { trigger_rule: 'none_failed_min_one_success' });
    const outputs = new Map([
      ['a', makeOutput('skipped')],
      ['b', makeOutput('skipped')],
    ]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });

  it('all_success: node with skipped dep is skipped, so anyCompleted stays false', () => {
    const n = node('b', ['a']);
    const outputs = new Map([['a', makeOutput('skipped')]]);
    expect(checkTriggerRule(n, outputs)).toBe('skip');
  });
});

describe('executeDagWorkflow -- tool restrictions', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
  });

  afterEach(async () => {
    // Restore default claude client
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('passes allowed_tools to sendQuery options for Claude node', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-tool-restriction',
        nodes: [{ id: 'review', command: 'my-cmd', allowed_tools: ['Read', 'Grep'] }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.allowed_tools).toEqual(['Read', 'Grep']);
  });

  it('passes settingSources to sendQuery nodeConfig for Claude node', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-setting-sources',
        nodes: [{ id: 'lean-review', command: 'my-cmd', settingSources: ['project'] }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.settingSources).toEqual(['project']);
    // Claude supports settingSources — no ignored-capability warning
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warnings = sendMessage.mock.calls
      .map(call => call[1] as string)
      .filter(msg => typeof msg === 'string' && msg.includes('settingSources'));
    expect(warnings).toEqual([]);
  });

  it('warns that settingSources is ignored on a Codex node', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-setting-sources-codex',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'codex', settingSources: ['project'] }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Capability gate: codex declares settingSources: false, so the executor
    // must surface a visible "will be ignored" warning instead of a silent no-op.
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warnings = sendMessage.mock.calls
      .map(call => call[1] as string)
      .filter(msg => typeof msg === 'string' && msg.includes('settingSources'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("doesn't support");
  });

  it('passes a raw Codex tier effort through nodeConfig', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude', {
      repoTiers: {
        medium: { provider: 'codex', model: 'gpt-5.5', effort: '  ultra  ' },
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'codex-tier-effort-test',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'medium' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockGetAgentProviderDag.mock.calls[0][0]).toBe('codex');
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg.model).toBe('gpt-5.5');
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBe('  ultra  ');
  });

  it('passes Qoder tier effort through nodeConfig and node-start metadata', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'qodercli',
      getCapabilities: () => ({
        ...mockCodexCapabilities(),
        structuredOutput: 'best-effort' as const,
        effortControl: true,
        thinkingControl: true,
        toolRestrictions: true,
      }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude', {
      repoTiers: {
        large: { provider: 'qodercli', model: 'qoder-pro', effort: 'future-qoder' },
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'qoder-tier-effort-test',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'large' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockGetAgentProviderDag.mock.calls[0][0]).toBe('qodercli');
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg.model).toBe('qoder-pro');
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBe('future-qoder');

    const nodeStartedCall = store.createWorkflowEvent.mock.calls.find(
      call => call[0].event_type === 'node_started'
    );
    expect(nodeStartedCall?.[0].data).toMatchObject({
      provider: 'qodercli',
      model: 'qoder-pro',
      tier: 'large',
      effort: 'future-qoder',
    });
  });

  it('applies inherited workflow tier effort to nodes without model overrides', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const workflowPreset = { provider: 'codex', model: 'gpt-5.5', effort: 'high' };
    const aiProfile = buildAiProfile('claude', {
      repoTiers: {
        large: workflowPreset,
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'inherited-workflow-tier-test',
        nodes: [{ id: 'step1', command: 'my-cmd' }],
      },
      workflowRun,
      'codex',
      'gpt-5.5',
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile,
      workflowPreset
    );

    expect(mockGetAgentProviderDag.mock.calls[0][0]).toBe('codex');
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg.model).toBe('gpt-5.5');
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBe('high');
  });

  it('routes Claude tier effort to nodeConfig.effort', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude', {
      repoTiers: {
        large: { provider: 'claude', model: 'opus', effort: 'max' },
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'claude-tier-effort-test',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'large' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg.model).toBe('opus');
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBe('max');

    // Verify that the node_started event carries the resolved tier and model.
    const createEventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as Array<[{ event_type: string; data?: Record<string, unknown> }]>;
    const nodeStartedCall = createEventCalls.find(([arg]) => arg.event_type === 'node_started');
    expect(nodeStartedCall).toBeDefined();
    expect(nodeStartedCall?.[0].data?.tier).toBe('large');
    expect(nodeStartedCall?.[0].data?.model).toBe('opus');
    expect(nodeStartedCall?.[0].data?.effort).toBe('max');
  });

  it('surfaces the workflow-level tier on nodes that inherit the workflow model', async () => {
    // Regression guard for #2036: the bundled default workflows set the tier at
    // the WORKFLOW level (e.g. `model: medium`), and their nodes have no own
    // `model`. The node_started event must still carry the inherited tier.
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude');

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'workflow-level-tier-test',
        model: 'medium',
        nodes: [{ id: 'step1', command: 'my-cmd' }],
      },
      workflowRun,
      'claude',
      'sonnet', // executor resolves the workflow-level `medium` -> `sonnet`
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    const createEventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as Array<[{ event_type: string; data?: Record<string, unknown> }]>;
    const nodeStartedCall = createEventCalls.find(([arg]) => arg.event_type === 'node_started');
    expect(nodeStartedCall).toBeDefined();
    expect(nodeStartedCall?.[0].data?.tier).toBe('medium');
    expect(nodeStartedCall?.[0].data?.model).toBe('sonnet');
  });

  it('passes literal node model through unchanged', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude');

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'literal-model-test',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'claude', model: 'opus' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockGetAgentProviderDag.mock.calls[0][0]).toBe('claude');
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg.model).toBe('opus');
  });

  it('warns when explicit node provider conflicts with alias provider and alias wins', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();
    const aiProfile = buildAiProfile('claude', {
      repoAliases: {
        '@fast': { provider: 'codex', model: 'gpt-5.5', effort: 'minimal' },
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'alias-provider-conflict-test',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'claude', model: '@fast' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockGetAgentProviderDag.mock.calls[0][0]).toBe('codex');
    expect(
      platform.sendMessage.mock.calls.some(call =>
        String(call[1]).includes(
          "sets provider 'claude' but model '@fast' resolves to provider 'codex'"
        )
      )
    ).toBe(true);
  });

  it('warns once when loop_group provider conflicts with alias model (no-ENV)', async () => {
    // US-037: group dispatch must emit dag.model_provider_conflict. Body nodes
    // inherit the already-resolved provider and cannot recover the conflict.
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 'lg-conflict-sid' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('claude', {
      repoAliases: {
        '@fast': { provider: 'codex', model: 'gpt-5.5', effort: 'minimal' },
      },
    });

    const logBaseline = mockLogFn.mock.calls.length;
    const sendBaseline = (platform.sendMessage as Mock).mock.calls.length;

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg-conflict',
      testDir,
      {
        name: 'dag-loopgroup-provider-conflict',
        nodes: [
          {
            id: 'grp',
            provider: 'claude',
            model: '@fast',
            loop_group: {
              until: 'DONE',
              max_iterations: 1,
              nodes: [{ id: 'body', prompt: 'body work' }],
            },
          },
        ],
      },
      makeWorkflowRun('dag-loopgroup-provider-conflict'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockGetAgentProviderDag.mock.calls.some(c => c[0] === 'codex')).toBe(true);
    const bodyCall = mockSendQueryDag.mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('body work')
    );
    expect(bodyCall).toBeDefined();
    expect((bodyCall?.[3] as SendQueryOptions).model).toBe('gpt-5.5');

    const conflictMsgs = (platform.sendMessage as Mock).mock.calls
      .slice(sendBaseline)
      .map(c => String(c[1]))
      .filter(m =>
        m.includes("sets provider 'claude' but model '@fast' resolves to provider 'codex'")
      );
    expect(conflictMsgs).toHaveLength(1);
    expect(conflictMsgs[0]).toContain("Node 'grp'");

    const logConflicts = (mockLogFn.mock.calls as unknown[][])
      .slice(logBaseline)
      .filter(args => args[1] === 'dag.model_provider_conflict');
    expect(logConflicts).toHaveLength(1);
    expect(logConflicts[0]?.[0]).toMatchObject({
      nodeId: 'grp',
      configuredProvider: 'claude',
      resolvedProvider: 'codex',
      modelRef: '@fast',
    });

    // Group container still has no provider-turn node_started.
    const events = (store.createWorkflowEvent as Mock).mock.calls.map(c => c[0]);
    expect(
      events.some(
        (e: { event_type: string; step_name?: string }) =>
          e.event_type === 'node_started' && e.step_name === 'grp'
      )
    ).toBe(false);
    const bodyStarted = events.find(
      (e: { event_type: string; step_name?: string }) =>
        e.event_type === 'node_started' && e.step_name === 'grp.body'
    );
    expect(bodyStarted?.data).toMatchObject({ provider: 'codex', model: 'gpt-5.5' });
  });

  it('warns once for ENV-overlaid loop_group provider/model conflict', async () => {
    // US-037 ENV path: overlay supplies the conflicting group fields; warning
    // still fires exactly once and body turns use the alias-won provider/model.
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 'lg-env-conflict-sid' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('claude', {
      repoAliases: {
        '@fast': { provider: 'codex', model: 'gpt-5.5' },
      },
    });

    const baseNodes: DagNode[] = [
      {
        id: 'grp',
        // YAML baseline has no conflict; ENV patches introduce it.
        loop_group: {
          until: 'DONE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'env body' }],
        },
      },
    ];
    const { workflow: patched } = applyEnvOverlay(
      { name: 'dag-loopgroup-env-conflict', nodes: baseNodes },
      { grp: { provider: 'claude', model: '@fast' } }
    );

    const logBaseline = mockLogFn.mock.calls.length;
    const sendBaseline = (platform.sendMessage as Mock).mock.calls.length;

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg-env-conflict',
      testDir,
      patched,
      makeWorkflowRun('dag-loopgroup-env-conflict'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    const conflictMsgs = (platform.sendMessage as Mock).mock.calls
      .slice(sendBaseline)
      .map(c => String(c[1]))
      .filter(m =>
        m.includes("sets provider 'claude' but model '@fast' resolves to provider 'codex'")
      );
    expect(conflictMsgs).toHaveLength(1);

    const logConflicts = (mockLogFn.mock.calls as unknown[][])
      .slice(logBaseline)
      .filter(args => args[1] === 'dag.model_provider_conflict');
    expect(logConflicts).toHaveLength(1);

    const bodyCall = mockSendQueryDag.mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('env body')
    );
    expect(bodyCall).toBeDefined();
    expect((bodyCall?.[3] as SendQueryOptions).model).toBe('gpt-5.5');
    expect(mockGetAgentProviderDag.mock.calls.some(c => c[0] === 'codex')).toBe(true);
  });

  it('warns user when Codex DAG node has denied_tools only', async () => {
    mockGetAgentProviderDag.mockReturnValue({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-codex-denied',
        nodes: [
          { id: 'review', command: 'my-cmd', provider: 'codex', denied_tools: ['WebSearch'] },
        ],
      },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const warning = messages.find(
      m => m.includes('allowed_tools/denied_tools') && m.includes('codex')
    );
    expect(warning).toBeDefined();
  });

  it('passes empty allowed_tools: [] (disable all tools) to sendQuery', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-empty-tools', nodes: [{ id: 'review', command: 'my-cmd', allowed_tools: [] }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.allowed_tools).toEqual([]);
  });

  it('passes hooks to sendQuery options for Claude node', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-hooks',
        nodes: [
          {
            id: 'review',
            command: 'my-cmd',
            hooks: {
              PreToolUse: [{ matcher: 'Bash', response: { decision: 'block' } }],
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.hooks).toBeDefined();
    const hooks = nodeConfig?.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it('warns user when Codex DAG node has hooks', async () => {
    mockGetAgentProviderDag.mockReturnValue({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-codex-hooks',
        nodes: [
          {
            id: 'review',
            command: 'my-cmd',
            provider: 'codex',
            hooks: {
              PreToolUse: [{ response: { decision: 'block' } }],
            },
          },
        ],
      },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const warning = messages.find(m => m.includes('hooks') && m.includes('codex'));
    expect(warning).toBeDefined();
  });
});

describe('executeDagWorkflow -- AI node prompt substitution failure', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-subst-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('records a node_failed event when $BASE_BRANCH cannot be resolved (not a silent skip)', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('subst-fail-run-id', {
      workflow_name: 'subst-fail',
      conversation_id: 'conv-subst',
      user_message: 'test',
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-subst',
      testDir,
      {
        name: 'subst-fail',
        nodes: [{ id: 'needs-base', prompt: 'Diff the branch against $BASE_BRANCH and review.' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      '', // base branch unresolved — the prompt references $BASE_BRANCH so substitution throws
      'docs/',
      minimalConfig
    );

    // The substitution throw must surface as a node_failed event. Previously the
    // catch returned state:'failed' silently — the node emitted node_started and
    // then vanished with no terminal event, so downstream all_success rules
    // skipped instead of the run reporting the failure.
    const eventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'needs-base'
    );
    expect(failedEvent).toBeDefined();
    const errorMsg = (failedEvent![0] as { data: { error: string } }).data.error;
    expect(errorMsg).toContain('No base branch could be resolved');
    // The provider must never have been reached — the failure precedes the query.
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });
});

describe('executeDagWorkflow -- bash nodes', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-bash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('bash node executes and captures stdout as output', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-test-run-id', {
      workflow_name: 'bash-test',
      conversation_id: 'conv-bash',
      user_message: 'bash test message',
    });

    const bashNode: BashNode = {
      id: 'stats',
      bash: 'echo "hello world"',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash',
      testDir,
      { name: 'bash-exec-test', nodes: [bashNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Bash node should NOT invoke AI client
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('bash node stdout is available for downstream $nodeId.output substitution', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-test-run-id', {
      workflow_name: 'bash-test',
      conversation_id: 'conv-bash',
      user_message: 'bash test message',
    });

    // Write a command file for the downstream AI node
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Process: $stats.output');

    const nodes: DagNode[] = [
      { id: 'stats', bash: 'echo "42 files"' },
      { id: 'process', command: 'my-cmd', depends_on: ['stats'] },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash',
      testDir,
      { name: 'bash-subst-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI client should have been called for the downstream node
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    // The prompt should contain the substituted bash output
    const prompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(prompt).toContain('42 files');
  });

  it('non-zero exit code results in failed state', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-test-run-id', {
      workflow_name: 'bash-test',
      conversation_id: 'conv-bash',
      user_message: 'bash test message',
    });

    const bashNode: BashNode = {
      id: 'fail',
      bash: 'exit 1',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash',
      testDir,
      { name: 'bash-fail-test', nodes: [bashNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The workflow should complete (it handles failures) but the node failed
    // The mock platform should have received a failure message about the failed node
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const failMsg = messages.find((m: string) => m.includes('failed') && m.includes('fail'));
    expect(failMsg).toBeDefined();
  });

  it('failure message surfaces stderr and does not leak the "Command failed: bash -c <body>" prefix', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-1389-run-id', {
      workflow_name: 'bash-1389',
      conversation_id: 'conv-1389b',
      user_message: 'test',
    });

    // Marker is echoed to stdout only (so it lands in the command line embedded
    // in err.message but never in stderr). If it shows up in errorMsg the
    // prefix line was not stripped.
    const bashNode: BashNode = {
      id: 'fail-bash-1389',
      bash: 'echo UNIQUE_CMDLINE_MARKER_1389; echo "diagnostic from stderr" >&2; exit 1',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-1389b',
      testDir,
      { name: 'bash-1389', nodes: [bashNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'fail-bash-1389'
    );
    expect(failedEvent).toBeDefined();
    const errorMsg = (failedEvent![0] as { data: { error: string } }).data.error;
    expect(errorMsg).toContain("Bash node 'fail-bash-1389' failed");
    expect(errorMsg).toContain('[exit 1]');
    expect(errorMsg).not.toContain('Command failed:');
    expect(errorMsg).not.toContain('UNIQUE_CMDLINE_MARKER_1389');
    expect(errorMsg).toContain('diagnostic from stderr');
  });

  it('variable substitution works in bash scripts', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-test-run-id', {
      workflow_name: 'bash-test',
      conversation_id: 'conv-bash',
      user_message: 'bash test message',
    });

    const bashNode: BashNode = {
      id: 'vars',
      bash: 'echo "$ARGUMENTS"',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash',
      testDir,
      { name: 'bash-vars-test', nodes: [bashNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Should complete without error (no AI calls)
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('bash node in parallel layer executes correctly', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-test-run-id', {
      workflow_name: 'bash-test',
      conversation_id: 'conv-bash',
      user_message: 'bash test message',
    });

    // Write a command file for the AI node
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Do something');

    const nodes: DagNode[] = [
      { id: 'bash-a', bash: 'echo "from bash"' },
      { id: 'ai-b', command: 'my-cmd' },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash',
      testDir,
      { name: 'bash-parallel-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI client called only for the AI node, not the bash node
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
  });

  it('passes config.envVars to bash subprocesses', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-env-run-id');

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash-env',
      testDir,
      { name: 'bash-env-test', nodes: [{ id: 'stats', bash: 'echo ok' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, prRemote: 'upstream', envVars: { MY_SECRET: 'abc123' } }
    );

    const bashCall = execSpy.mock.calls.find(call => call[0] === git.resolveBashPath());
    expect(bashCall?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({ MY_SECRET: 'abc123', PR_REMOTE: 'upstream' }),
      })
    );
    execSpy.mockRestore();
  });

  it('bash node output with shell metacharacters does not inject into downstream bash script', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-injection-run-id', {
      workflow_name: 'bash-injection-test',
      conversation_id: 'conv-injection',
      user_message: 'test',
    });

    // upstream: outputs a value containing shell metacharacters
    // downstream: embeds $upstream.output literally in a bash script
    // If injection were present, the semicolon would split into two commands and INJECTED would print
    const nodes: DagNode[] = [
      { id: 'upstream', bash: 'printf "%s" "safe; echo INJECTED"' },
      {
        id: 'downstream',
        bash: 'result=$upstream.output; echo "got: $result"',
        depends_on: ['upstream'],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-injection',
      testDir,
      { name: 'bash-injection-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // No AI calls
    expect(mockSendQueryDag.mock.calls.length).toBe(0);

    // The downstream node ran without injection: stdout should contain the literal value, not a separate INJECTED line
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    // 'INJECTED' as a standalone result of injection must not appear
    const injectedMessage = messages.find((m: string) => m === 'INJECTED');
    expect(injectedMessage).toBeUndefined();
  });

  it('passes user message through env vars, not string substitution, preventing shell injection', async () => {
    let executedScript: string | undefined;
    const execSpy = spyOn(git, 'execFileAsync').mockImplementation(
      async (cmd: string, args: string[]) => {
        if (cmd === git.resolveBashPath()) {
          executedScript = args[0] === '-c' ? args[1] : await readFile(args[0] as string, 'utf8');
        }
        return { stdout: 'ok\n', stderr: '' };
      }
    );
    try {
      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('bash-shell-safe-run-id', {
        workflow_name: 'bash-shell-safe',
        conversation_id: 'conv-shell-safe',
        user_message: '$(rm -rf /)',
      });

      const bashNode: BashNode = {
        id: 'safe',
        bash: 'echo $USER_MESSAGE',
      };

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-shell-safe',
        testDir,
        { name: 'bash-shell-safe-test', nodes: [bashNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const bashCall = execSpy.mock.calls.find(call => call[0] === git.resolveBashPath());
      expect(bashCall).toBeDefined();

      // The executed script must contain literal $USER_MESSAGE (not substituted).
      expect(executedScript).toBe('echo $USER_MESSAGE');

      // The env must contain the user message
      const envArg = (bashCall?.[2] as { env: NodeJS.ProcessEnv }).env;
      expect(envArg?.USER_MESSAGE).toBe('$(rm -rf /)');
      expect(envArg?.ARGUMENTS).toBe('$(rm -rf /)');
    } finally {
      execSpy.mockRestore();
    }
  });
});

describe('executeDagWorkflow -- script node injection hardening (#2115)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-script-hardening-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
  });

  afterEach(async () => {
    // force: true already no-ops on a missing dir — any other failure (EBUSY/EPERM)
    // should surface, not be swallowed.
    await rm(testDir, { recursive: true, force: true });
  });

  it('bun script delivers the user message via env var, never spliced into source', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const workflowRun = makeWorkflowRun('script-inject-bun', {
        workflow_name: 'script-inject',
        conversation_id: 'conv-script-inject',
        // If this were text-substituted into TS source the string literal would close
        // and execSync would run; delivered as an env var it stays inert data.
        user_message: '"); require("child_process").execSync("touch pwned"); //',
      });

      const scriptNode: ScriptNode = {
        id: 'safe',
        script: 'console.log(process.env.ARGUMENTS)',
        runtime: 'bun',
      };

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-script-inject',
        testDir,
        { name: 'script-inject-test', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(execSpy).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = execSpy.mock.calls[0] as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(cmd).toBe('bun');
      // Source is byte-identical to the author's body — the payload never appears in it.
      expect(args).toEqual(['--no-env-file', '-e', 'console.log(process.env.ARGUMENTS)']);
      expect(args.join(' ')).not.toContain('execSync');
      // The value reaches the script via env vars instead.
      expect(opts.env.ARGUMENTS).toBe(workflowRun.user_message);
      expect(opts.env.USER_MESSAGE).toBe(workflowRun.user_message);
    } finally {
      execSpy.mockRestore();
    }
  });

  it('leaves a literal $ARGUMENTS in the script body inert (not substituted)', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const workflowRun = makeWorkflowRun('script-literal', {
        workflow_name: 'script-literal',
        conversation_id: 'conv-script-literal',
        user_message: '$(rm -rf /)',
      });

      const scriptNode: ScriptNode = {
        id: 'legacy',
        script: 'console.log("value: $ARGUMENTS")',
        runtime: 'bun',
      };

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-script-literal',
        testDir,
        { name: 'script-literal-test', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const [, args] = execSpy.mock.calls[0] as [string, string[], unknown];
      // The dangerous payload is NOT interpolated into the source; $ARGUMENTS stays literal.
      expect(args[2]).toBe('console.log("value: $ARGUMENTS")');
      expect(args[2]).not.toContain('rm -rf');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('uv/python script delivers the user message and issue context via env vars', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const workflowRun = makeWorkflowRun('script-inject-uv', {
        workflow_name: 'script-inject-uv',
        conversation_id: 'conv-script-uv',
        user_message: 'py-message',
      });

      const scriptNode: ScriptNode = {
        id: 'py',
        script: "import os; print(os.environ['ARGUMENTS'])",
        runtime: 'uv',
      };

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-script-uv',
        testDir,
        { name: 'script-uv-test', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig,
        undefined, // configuredCommandFolder
        'ISSUE #42 body text' // issueContext
      );

      const [cmd, args, opts] = execSpy.mock.calls[0] as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(cmd).toBe('uv');
      expect(args).toEqual(['run', 'python', '-c', "import os; print(os.environ['ARGUMENTS'])"]);
      expect(opts.env.ARGUMENTS).toBe('py-message');
      expect(opts.env.CONTEXT).toBe('ISSUE #42 body text');
      expect(opts.env.EXTERNAL_CONTEXT).toBe('ISSUE #42 body text');
      expect(opts.env.ISSUE_CONTEXT).toBe('ISSUE #42 body text');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('a configured project env var cannot shadow an engine-reserved value (#2115)', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const workflowRun = makeWorkflowRun('script-env-collision', {
        workflow_name: 'script-env-collision',
        conversation_id: 'conv-script-collision',
        user_message: 'the-real-arguments',
      });

      const scriptNode: ScriptNode = {
        id: 'collide',
        script: 'console.log(process.env.ARGUMENTS)',
        runtime: 'bun',
      };

      // A codebase env var that (maliciously or by accident) reuses a reserved name,
      // alongside a legitimate non-reserved var that must still pass through.
      const configWithEnv: WorkflowConfig = {
        ...minimalConfig,
        envVars: { ARGUMENTS: 'PROJECT_OVERRIDE', CONTEXT: 'PROJECT_CTX', MY_VAR: 'keep-me' },
      };

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-script-collision',
        testDir,
        { name: 'script-env-collision', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        configWithEnv,
        undefined, // configuredCommandFolder
        'ENGINE_CONTEXT' // issueContext
      );

      const [, , opts] = execSpy.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
      // Reserved workflow vars win over the colliding configured vars — the delivery
      // channel this PR establishes can't be shadowed by a project env var.
      expect(opts.env.ARGUMENTS).toBe('the-real-arguments');
      expect(opts.env.CONTEXT).toBe('ENGINE_CONTEXT');
      // Non-reserved configured vars still reach the subprocess.
      expect(opts.env.MY_VAR).toBe('keep-me');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('still substitutes $nodeId.output raw into the script source (item 3 preserved)', async () => {
    // upstream bash → 'UPSTREAM_RAW'; downstream bun script assigns $upstream.output directly.
    const execSpy = spyOn(git, 'execFileAsync').mockImplementation(
      async (cmd: string) =>
        cmd === git.resolveBashPath()
          ? { stdout: 'UPSTREAM_RAW\n', stderr: '' } // bash upstream
          : { stdout: '', stderr: '' } // bun downstream
    );
    try {
      const workflowRun = makeWorkflowRun('script-nodeoutput', {
        workflow_name: 'script-nodeoutput',
        conversation_id: 'conv-script-nodeoutput',
        user_message: 'msg',
      });

      const nodes: DagNode[] = [
        { id: 'upstream', bash: 'printf UPSTREAM_RAW' },
        {
          id: 'downstream',
          script: 'const v = "$upstream.output"; console.log(v)',
          runtime: 'bun',
          depends_on: ['upstream'],
        },
      ];

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-script-nodeoutput',
        testDir,
        { name: 'script-nodeoutput-test', nodes },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const scriptCall = execSpy.mock.calls.find(
        c => (c[0] as string) === 'bun' && (c[1] as string[]).includes('-e')
      ) as [string, string[], unknown] | undefined;
      expect(scriptCall).toBeDefined();
      // Raw (unquoted) node-output splice is intact — the direct-assignment pattern.
      expect(scriptCall?.[1][2]).toBe('const v = "UPSTREAM_RAW"; console.log(v)');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('warns when a script body still uses a literal user-controlled variable', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('script-warn', {
        workflow_name: 'script-warn',
        conversation_id: 'conv-script-warn',
        user_message: 'hi',
      });

      const scriptNode: ScriptNode = {
        id: 'legacy',
        script: 'console.log("$ARGUMENTS and $CONTEXT")',
        runtime: 'bun',
      };

      await executeDagWorkflow(
        createMockDeps(),
        platform,
        'conv-script-warn',
        testDir,
        { name: 'script-warn-test', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const messages = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => c[1] as string
      );
      const warn = messages.find(m => m.includes('no longer') && m.includes('#2115'));
      expect(warn).toBeDefined();
      // Language-appropriate accessor is suggested for both referenced vars.
      expect(warn).toContain('process.env.ARGUMENTS');
      expect(warn).toContain('process.env.CONTEXT');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('does not warn when the script reads values from the environment (correct form)', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    try {
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('script-nowarn', {
        workflow_name: 'script-nowarn',
        conversation_id: 'conv-script-nowarn',
        user_message: 'hi',
      });

      const scriptNode: ScriptNode = {
        id: 'modern',
        // Contains the substring "ARGUMENTS" but not the literal $ARGUMENTS ref.
        script: 'console.log(process.env.ARGUMENTS ?? "")',
        runtime: 'bun',
      };

      await executeDagWorkflow(
        createMockDeps(),
        platform,
        'conv-script-nowarn',
        testDir,
        { name: 'script-nowarn-test', nodes: [scriptNode] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const messages = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => c[1] as string
      );
      expect(messages.find(m => m.includes('no longer substituted'))).toBeUndefined();
    } finally {
      execSpy.mockRestore();
    }
  });
});

describe('executeDagWorkflow -- output_format structured output', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-output-fmt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'classify.md'), 'Classify this: $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('uses structuredOutput from result when output_format is set', async () => {
    const structuredJson = { run_code_review: 'true', run_tests: 'false' };

    // Mock yields prose + JSON as assistant text, then result with structuredOutput
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Let me analyze the PR scope...\n' };
      yield { type: 'assistant', content: JSON.stringify(structuredJson) };
      yield { type: 'result', sessionId: 'sid-1', structuredOutput: structuredJson };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('output-fmt-run', {
      user_message: 'classify this PR',
    });

    const nodes: DagNode[] = [
      {
        id: 'classify',
        command: 'classify',
        output_format: {
          type: 'object',
          properties: {
            run_code_review: { type: 'string', enum: ['true', 'false'] },
            run_tests: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
      {
        id: 'review',
        prompt: 'Review the code',
        depends_on: ['classify'],
        when: "$classify.output.run_code_review == 'true'",
      },
      {
        id: 'test',
        prompt: 'Run tests',
        depends_on: ['classify'],
        when: "$classify.output.run_tests == 'true'",
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-output-fmt',
      testDir,
      { name: 'output-fmt-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The review node's when condition should evaluate to true (run_code_review == 'true')
    // The test node's when condition should evaluate to false (run_tests == 'false', not 'true')
    // So sendQuery should be called for classify + review = 2 times (not 3)
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
  });

  it('does NOT override nodeOutputText with structuredOutput when output_format is absent', async () => {
    // Even if the SDK returns structuredOutput, nodes without output_format use concatenated text
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'prose analysis text' };
      yield { type: 'result', sessionId: 'sid-no-fmt', structuredOutput: { type: 'BUG' } };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('no-output-fmt-run', {
      user_message: 'test guard',
    });

    const nodes: DagNode[] = [
      { id: 'a', command: 'classify' },
      {
        id: 'b',
        prompt: 'Got: $a.output',
        depends_on: ['a'],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-no-fmt',
      testDir,
      { name: 'no-fmt-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);

    // Second node's prompt should contain the concatenated prose, not the JSON
    const secondCallPrompt = mockSendQueryDag.mock.calls[1][0] as string;
    expect(secondCallPrompt).toContain('prose analysis text');
    expect(secondCallPrompt).not.toContain('"type"');
  });

  it('falls back to concatenated text when structuredOutput is absent', async () => {
    // Mock without structuredOutput on result — backward compatible
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'plain text response' };
      yield { type: 'result', sessionId: 'sid-2' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('no-structured-run', {
      user_message: 'test fallback',
    });

    const nodes: DagNode[] = [
      { id: 'a', command: 'classify' },
      {
        id: 'b',
        prompt: 'Use output: $a.output',
        depends_on: ['a'],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-fallback',
      testDir,
      { name: 'fallback-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Both nodes should execute (no output_format, no when conditions)
    expect(mockSendQueryDag.mock.calls.length).toBe(2);

    // Second node's prompt should contain the concatenated text from node a
    const secondCallPrompt = mockSendQueryDag.mock.calls[1][0] as string;
    expect(secondCallPrompt).toContain('plain text response');
  });

  it('passes outputFormat to Codex nodes and uses inline JSON response', async () => {
    // Codex provider normalizes inline JSON into structuredOutput on the result chunk
    const classifyJson = { run_code_review: 'true', run_tests: 'false' };
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: JSON.stringify(classifyJson) };
      yield { type: 'result', sessionId: 'codex-sid-1', structuredOutput: classifyJson };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('codex-output-fmt-run', {
      user_message: 'classify this PR',
    });

    const nodes: DagNode[] = [
      {
        id: 'classify',
        command: 'classify',
        output_format: {
          type: 'object',
          properties: {
            run_code_review: { type: 'string', enum: ['true', 'false'] },
            run_tests: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
      {
        id: 'review',
        prompt: 'Review the code',
        depends_on: ['classify'],
        when: "$classify.output.run_code_review == 'true'",
      },
      {
        id: 'test',
        prompt: 'Run tests',
        depends_on: ['classify'],
        when: "$classify.output.run_tests == 'true'",
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-codex-fmt',
      testDir,
      { name: 'codex-output-fmt', nodes },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // classify + review = 2 calls (test node skipped because run_tests == 'false')
    expect(mockSendQueryDag.mock.calls.length).toBe(2);

    // Verify outputFormat was passed to the Codex client (4th arg = options)
    const classifyOptions = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(classifyOptions.outputFormat).toEqual({
      type: 'json_schema',
      schema: nodes[0].output_format,
    });
  });

  it('does not warn about missing structuredOutput for Codex nodes', async () => {
    // Codex provider normalizes inline JSON into structuredOutput on the result chunk
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '{"status":"ok"}' };
      yield { type: 'result', sessionId: 'codex-sid-2', structuredOutput: { status: 'ok' } };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('codex-no-warn-run', {
      user_message: 'check it',
    });

    const nodes: DagNode[] = [
      {
        id: 'check',
        command: 'classify',
        output_format: { type: 'object', properties: { status: { type: 'string' } } },
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-codex-no-warn',
      testDir,
      { name: 'codex-no-warn', nodes },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Verify no "structured output missing" warning was sent to the user
    const sendCalls = (platform.sendMessage as Mock<(...args: unknown[]) => Promise<void>>).mock
      .calls;
    const warningMessages = sendCalls
      .map(call => call[1] as string)
      .filter(msg => typeof msg === 'string' && msg.includes('did not return structured output'));
    expect(warningMessages).toHaveLength(0);
  });

  it('keeps a one-string structured result an object and hands the string to downstream refs', async () => {
    const report = '# Report\n\nFindings **bold**';
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: JSON.stringify({ report }) };
      yield { type: 'result', sessionId: 'sid-report', structuredOutput: { report } };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('one-string-report-run', {
      user_message: 'write the report',
    });

    const nodes: DagNode[] = [
      {
        id: 'producer',
        command: 'classify',
        output_format: { type: 'object', properties: { report: { type: 'string' } } },
      },
      {
        id: 'consumer',
        prompt: 'Report body: $producer.output.report',
        depends_on: ['producer'],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-report',
      testDir,
      { name: 'one-string-report', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const consumerPrompt = mockSendQueryDag.mock.calls[1][0] as string;
    expect(consumerPrompt).toContain(`Report body: ${report}`);
    expect(consumerPrompt).not.toContain('"report"');
  });
});

describe('executeDagWorkflow -- when condition parse errors (fail-closed)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-parse-err-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Do something for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'AI response' };
      yield { type: 'result', sessionId: 'sess-parse-err' };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('skips node (does not run it) when when: expression is unparseable', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('parse-err-skip-run');

    const nodes: DagNode[] = [
      { id: 'unconditional', command: 'my-cmd' },
      // Single = is not valid syntax — will fail to parse
      {
        id: 'guarded',
        command: 'my-cmd',
        depends_on: ['unconditional'],
        when: "$unconditional.output = 'yes'",
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-parse-err-skip',
      testDir,
      { name: 'parse-err-skip-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Only the unconditional node should have triggered an AI call.
    // The guarded node must be skipped (fail-closed), not executed.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
  });

  it('sends a platform warning message naming the node and stating it was skipped', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('parse-err-warn-run');

    const nodes: DagNode[] = [{ id: 'gate', command: 'my-cmd', when: 'not a valid condition' }];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-parse-err-warn',
      testDir,
      { name: 'parse-warn-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const warning = messages.find(m => m.includes('gate') && m.includes('skipped'));
    expect(warning).toBeDefined();
    // Must NOT indicate the node ran (the old fail-open behavior)
    expect(warning).not.toMatch(/node ran/i);
  });

  it('workflow completes without throwing when all nodes are skipped via parse error', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('parse-err-all-skip-run');

    const nodes: DagNode[] = [{ id: 'only', command: 'my-cmd', when: 'bad expression' }];

    await expect(
      executeDagWorkflow(
        mockDeps,
        platform,
        'conv-all-skipped',
        testDir,
        { name: 'all-skipped-test', nodes },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      )
    ).resolves.toBeUndefined();
  });
});

describe('executeDagWorkflow -- node-level retry for transient errors', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-retry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Do something for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('node succeeds on retry after a transient error', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount === 1) {
        throw new Error('Claude Code crash: process exited with code 1');
      }
      yield { type: 'assistant', content: 'Recovered' };
      yield { type: 'result', sessionId: 'retry-sess' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-retry-succeed-run');

    const nodes: DagNode[] = [
      { id: 'my-node', command: 'my-cmd', retry: { max_attempts: 2, delay_ms: 1 } },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-retry-succeed',
      testDir,
      { name: 'dag-retry-succeed', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Node was called at least twice (first fails transiently, second succeeds)
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
  }, 5_000);

  it('workflow fails after exhausting all node retries', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      throw new Error('Claude Code crash: process exited with code 1');
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-retry-exhaust-run');

    const nodes: DagNode[] = [
      { id: 'my-node', command: 'my-cmd', retry: { max_attempts: 2, delay_ms: 1 } },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-retry-exhaust',
      testDir,
      { name: 'dag-retry-exhaust', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // max_attempts: 2 = 2 retries → 3 total attempts (delay_ms: 1 keeps test fast)
    expect(callCount).toBe(3);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  }, 5_000);

  it('node with FATAL error does not retry (call count = 1)', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      throw new Error('Claude Code auth error: unauthorized');
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-retry-fatal-run');

    const nodes: DagNode[] = [
      { id: 'my-node', command: 'my-cmd', retry: { max_attempts: 2, delay_ms: 1 } },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-retry-fatal',
      testDir,
      { name: 'dag-retry-fatal', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // FATAL error must not be retried — exactly 1 attempt
    expect(callCount).toBe(1);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  });

  it('sends retry notification to platform before each delay', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount === 1) {
        throw new Error('Claude Code crash: process exited with code 1');
      }
      yield { type: 'assistant', content: 'OK' };
      yield { type: 'result', sessionId: 'ok-sess' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-retry-notify-run');

    const nodes: DagNode[] = [
      { id: 'my-node', command: 'my-cmd', retry: { max_attempts: 2, delay_ms: 1 } },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-retry-notify',
      testDir,
      { name: 'dag-retry-notify', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendCalls = (platform.sendMessage as ReturnType<typeof mock>).mock.calls;
    const retryMessages = sendCalls.filter(
      (call: unknown[]) =>
        typeof call[1] === 'string' && (call[1] as string).includes('transient error')
    );
    expect(retryMessages.length).toBeGreaterThan(0);
  }, 5_000);
});

describe('executeDagWorkflow -- retry on deterministic (bash/script) nodes (#2088)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-det-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Deterministic nodes run real subprocesses, so a side-effect counter file is
  // the most direct way to observe how many attempts actually happened.
  async function runNodes(
    nodes: DagNode[]
  ): Promise<{ mockDeps: WorkflowDeps; platform: IWorkflowPlatform }> {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('det-retry-run', {
      workflow_name: 'det-retry',
      conversation_id: 'conv-det-retry',
      user_message: 'det retry message',
    });
    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-det-retry',
      testDir,
      { name: 'det-retry', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
    return { mockDeps, platform };
  }

  it('bash node with retry re-runs until it succeeds', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const marker = join(testDir, 'marker');
    const nodes: DagNode[] = [
      {
        id: 'flaky',
        // Attempt 1: no marker → create it, fail. Attempt 2: marker present → succeed.
        bash: `printf 'a' >> '${attempts}'; if [ -e '${marker}' ]; then echo ok; else printf x > '${marker}'; echo 'boom' >&2; exit 1; fi`,
        retry: { max_attempts: 3, delay_ms: 1, on_error: 'all' },
      },
    ];
    const { mockDeps } = await runNodes(nodes);

    const content = await readFile(attempts, 'utf8');
    // One failing attempt then one succeeding attempt → exactly 2 runs.
    expect(content.length).toBe(2);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).not.toHaveBeenCalled();
  }, 5_000);

  it('bash node with retry exhausts all attempts on persistent failure', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const nodes: DagNode[] = [
      {
        id: 'always-fails',
        bash: `printf 'a' >> '${attempts}'; echo 'boom' >&2; exit 1`,
        retry: { max_attempts: 2, delay_ms: 1, on_error: 'all' },
      },
    ];
    const { mockDeps } = await runNodes(nodes);

    const content = await readFile(attempts, 'utf8');
    // max_attempts: 2 = 2 retries → 3 total attempts. Without the fix this is 1.
    expect(content.length).toBe(3);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  }, 5_000);

  it('bash node WITHOUT a retry block runs exactly once (single-attempt default preserved)', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const nodes: DagNode[] = [
      {
        id: 'no-retry',
        bash: `printf 'a' >> '${attempts}'; echo 'boom' >&2; exit 1`,
      },
    ];
    const { mockDeps } = await runNodes(nodes);

    const content = await readFile(attempts, 'utf8');
    // Deterministic nodes never auto-retry — retry is opt-in via an explicit block.
    expect(content.length).toBe(1);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  }, 5_000);

  it('bash node with a FATAL error is never retried even with on_error: all', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const nodes: DagNode[] = [
      {
        id: 'fatal',
        bash: `printf 'a' >> '${attempts}'; echo 'unauthorized' >&2; exit 1`,
        retry: { max_attempts: 3, delay_ms: 1, on_error: 'all' },
      },
    ];
    const { mockDeps } = await runNodes(nodes);

    const content = await readFile(attempts, 'utf8');
    // FATAL classification wins over on_error: all → exactly 1 attempt.
    expect(content.length).toBe(1);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  }, 5_000);

  it('script node with retry re-runs on persistent failure', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const nodes: DagNode[] = [
      {
        id: 'flaky-script',
        script: `require('fs').appendFileSync('${attempts}', 'a'); process.exit(1)`,
        runtime: 'bun',
        retry: { max_attempts: 2, delay_ms: 1, on_error: 'all' },
      },
    ];
    const { mockDeps } = await runNodes(nodes);

    const content = await readFile(attempts, 'utf8');
    // 1 initial + 2 retries = 3. Without the fix this is 1.
    expect(content.length).toBe(3);
    expect(mockDeps.store.failWorkflowRun as ReturnType<typeof mock>).toHaveBeenCalled();
  }, 10_000);

  it('bash retry sends a platform notification before each retry', async () => {
    // Forward-slashed for safe embedding in inline bash AND JS string literals
    // (Windows join() yields backslashes; '\a' is an escape in JS strings).
    const attempts = join(testDir, 'attempts.log').replace(/\\/g, '/');
    const nodes: DagNode[] = [
      {
        id: 'notify',
        bash: `printf 'a' >> '${attempts}'; echo 'boom' >&2; exit 1`,
        retry: { max_attempts: 2, delay_ms: 1, on_error: 'all' },
      },
    ];
    const { platform } = await runNodes(nodes);

    const sendCalls = (platform.sendMessage as ReturnType<typeof mock>).mock.calls;
    const retryMessages = sendCalls.filter(
      (call: unknown[]) =>
        typeof call[1] === 'string' && (call[1] as string).includes('Retrying in')
    );
    // 2 retries → 2 retry notifications.
    expect(retryMessages.length).toBe(2);
  }, 5_000);
});

describe('executeDagWorkflow -- tool_called event persistence', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should persist tool_called event during DAG node execution', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Reading file...' };
      yield { type: 'tool', toolName: 'read_file', toolInput: { path: '/tmp/test.ts' } };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'tool-test-dag',
        nodes: [node('my-cmd')],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const toolCalledEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'tool_called'
    );
    expect(toolCalledEvents.length).toBe(1);
    const eventData = toolCalledEvents[0][0] as Record<string, unknown>;
    expect(eventData.step_name).toBe('my-cmd');
    expect((eventData.data as Record<string, unknown>).tool_name).toBe('read_file');
    expect((eventData.data as Record<string, unknown>).tool_input).toEqual({
      path: '/tmp/test.ts',
    });
    expect((eventData.data as Record<string, unknown>).tool_call_id).toBe('anonymous-1');
  });

  it('calls sendStructuredEvent for tool messages in streaming mode during DAG', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    (platform.getStreamingMode as Mock).mockReturnValue('stream');
    const workflowRun = makeWorkflowRun();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'tool', toolName: 'Write', toolInput: { path: '/bar', content: 'x' } };
      yield { type: 'result', sessionId: 'dag-session-tool' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-tool',
      testDir,
      { name: 'dag-tool-test', nodes: [node('my-cmd')] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(platform.sendStructuredEvent).toHaveBeenCalledWith('conv-dag-tool', {
      type: 'tool',
      toolName: 'Write',
      toolInput: { path: '/bar', content: 'x' },
    });
  });
});

describe('executeDagWorkflow -- tool_completed event emission', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-toolcomplete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should emit tool_completed with duration_ms when next tool starts in DAG node', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'tool', toolName: 'read_file', toolInput: { path: '/a' } };
      yield { type: 'tool', toolName: 'write_file', toolInput: { path: '/b', content: 'x' } };
      yield { type: 'result', sessionId: 'dag-sess-1' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-complete',
      testDir,
      { name: 'dag-complete-test', nodes: [node('my-cmd')] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const createEventCalls = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as Array<[{ event_type: string; data?: Record<string, unknown> }]>;
    const completedEvents = createEventCalls.filter(([arg]) => arg.event_type === 'tool_completed');

    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    const readFileComplete = completedEvents.find(([arg]) => arg.data?.tool_name === 'read_file');
    expect(readFileComplete).toBeDefined();
    expect(typeof readFileComplete?.[0].data?.duration_ms).toBe('number');
    expect((readFileComplete?.[0].data?.duration_ms as number) >= 0).toBe(true);
    expect(readFileComplete?.[0].data).toMatchObject({
      tool_call_id: 'anonymous-1',
      tool_outcome: 'unknown',
    });
  });

  it('should emit tool_completed for last tool on result in DAG node', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'tool', toolName: 'read_file', toolInput: { path: '/a' } };
      yield { type: 'result', sessionId: 'dag-sess-2' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-last',
      testDir,
      { name: 'dag-last-test', nodes: [node('my-cmd')] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const createEventCalls = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as Array<[{ event_type: string; data?: Record<string, unknown> }]>;
    const completedEvents = createEventCalls.filter(([arg]) => arg.event_type === 'tool_completed');

    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0][0].data?.tool_name).toBe('read_file');
    expect(typeof completedEvents[0][0].data?.duration_ms).toBe('number');
    expect(completedEvents[0][0].data).toMatchObject({
      tool_call_id: 'anonymous-1',
      tool_outcome: 'unknown',
    });
  });

  it('emits a DAG tool_completed duration at tool_result, excluding later assistant time', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'tool', toolName: 'read_file', toolInput: { path: '/a' } };
      setSystemTime(new Date('2026-01-01T00:00:00.050Z'));
      yield {
        type: 'tool_result',
        toolName: 'read_file',
        toolOutput: 'contents',
        toolOutcome: 'error',
        exitCode: 1,
      };
      setSystemTime(new Date('2026-01-01T00:01:00.050Z'));
      yield { type: 'assistant', content: 'post-tool reasoning' };
      yield { type: 'result', sessionId: 'dag-sess-tool-result' };
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag-tool-result',
        testDir,
        { name: 'dag-tool-result-test', nodes: [node('my-cmd')] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      setSystemTime();
    }

    const completedEvents = (
      mockStore.createWorkflowEvent as ReturnType<typeof mock>
    ).mock.calls.filter(
      ([event]: [{ event_type: string }]) => event.event_type === 'tool_completed'
    );
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0][0].data).toMatchObject({
      tool_name: 'read_file',
      duration_ms: 50,
      tool_call_id: 'anonymous-1',
      tool_outcome: 'error',
      exit_code: 1,
    });
    const toolRows = (await mockStore.listNodeMessages(workflowRun.id, 'my-cmd')).filter(
      row => row.kind === 'tool'
    );
    expect(toolRows).toHaveLength(2);
    expect(toolRows[0]?.payload).toMatchObject({ name: 'read_file', id: 'anonymous-1' });
    expect(toolRows[0]?.payload).not.toHaveProperty('output');
    expect(toolRows[1]?.payload).toMatchObject({
      name: 'read_file',
      id: 'anonymous-1',
      output: 'contents',
    });
  });

  it('correlates interleaved DAG tool lifecycles by toolCallId', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'tool', toolName: 'read_file', toolCallId: 'id-a' };
      setSystemTime(new Date('2026-01-01T00:00:00.010Z'));
      yield { type: 'tool', toolName: 'write_file', toolCallId: 'id-b' };
      setSystemTime(new Date('2026-01-01T00:00:00.040Z'));
      yield {
        type: 'tool_result',
        toolName: 'read_file',
        toolCallId: 'id-a',
        toolOutcome: 'success',
      };
      setSystemTime(new Date('2026-01-01T00:00:00.070Z'));
      yield {
        type: 'tool_result',
        toolName: 'write_file',
        toolCallId: 'id-b',
        toolOutcome: 'error',
        exitCode: 2,
      };
      yield { type: 'result', sessionId: 'dag-sess-interleaved-tools' };
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag-interleaved-tools',
        testDir,
        { name: 'dag-interleaved-tools', nodes: [node('my-cmd')] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      setSystemTime();
    }

    const completedEvents = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock.calls
      .filter(([event]: [{ event_type: string }]) => event.event_type === 'tool_completed')
      .map(([event]: [{ data: Record<string, unknown> }]) => event.data);
    expect(completedEvents).toEqual(
      expect.arrayContaining([
        {
          tool_name: 'read_file',
          duration_ms: 40,
          tool_call_id: 'id-a',
          tool_outcome: 'success',
        },
        {
          tool_name: 'write_file',
          duration_ms: 60,
          tool_call_id: 'id-b',
          tool_outcome: 'error',
          exit_code: 2,
        },
      ])
    );
  });

  it('should not emit tool_completed when no tools were called in DAG node', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-sess-3' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag-notools',
      testDir,
      { name: 'dag-notools-test', nodes: [node('my-cmd')] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const createEventCalls = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as Array<[{ event_type: string; data?: Record<string, unknown> }]>;
    const completedEvents = createEventCalls.filter(([arg]) => arg.event_type === 'tool_completed');

    expect(completedEvents.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadMcpConfig — per-node MCP server config loading (#445)
// ---------------------------------------------------------------------------

describe('loadMcpConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('loads and parses a valid MCP config JSON', async () => {
    const config = { github: { command: 'npx', args: ['-y', '@mcp/server-github'] } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    expect(result.serverNames).toEqual(['github']);
    expect(result.servers).toEqual(config);
    expect(result.missingVars).toEqual([]);
  });

  it('loads standard mcpServers-wrapped config JSON', async () => {
    const servers = { figma: { url: 'http://127.0.0.1:3845/mcp' } };
    await writeFile(join(testDir, 'wrapped.json'), JSON.stringify({ mcpServers: servers }));

    const result = await loadMcpConfig('wrapped.json', testDir);
    expect(result.serverNames).toEqual(['figma']);
    expect(result.servers).toEqual(servers);
  });

  it('rejects mixed mcpServers wrapper and top-level metadata', async () => {
    const servers = { figma: { url: 'http://127.0.0.1:3845/mcp' } };
    await writeFile(
      join(testDir, 'mixed-wrapper.json'),
      JSON.stringify({ $schema: 'https://example.com/schema.json', mcpServers: servers })
    );

    await expect(loadMcpConfig('mixed-wrapper.json', testDir)).rejects.toThrow(
      'cannot mix top-level "mcpServers" with other keys'
    );
  });

  it('loads multiple servers from one config', async () => {
    const config = {
      github: { command: 'npx', args: ['-y', '@mcp/server-github'] },
      postgres: { command: 'npx', args: ['-y', '@mcp/server-postgres'] },
    };
    await writeFile(join(testDir, 'multi.json'), JSON.stringify(config));

    const result = await loadMcpConfig('multi.json', testDir);
    expect(result.serverNames).toEqual(['github', 'postgres']);
  });

  it('expands $VAR_NAME in env values from process.env', async () => {
    process.env.TEST_MCP_TOKEN_445 = 'secret123';
    const config = { github: { command: 'npx', env: { TOKEN: '$TEST_MCP_TOKEN_445' } } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.github as Record<string, unknown>;
    expect(server.env).toEqual({ TOKEN: 'secret123' });

    delete process.env.TEST_MCP_TOKEN_445;
  });

  it('expands $VAR_NAME in headers values', async () => {
    process.env.TEST_API_KEY_445 = 'key456';
    const config = {
      api: {
        type: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer $TEST_API_KEY_445' },
      },
    };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.api as Record<string, unknown>;
    expect(server.headers).toEqual({ Authorization: 'Bearer key456' });

    delete process.env.TEST_API_KEY_445;
  });

  it('replaces undefined env vars with empty string and reports them', async () => {
    delete process.env.NONEXISTENT_VAR_445;
    const config = { svc: { command: 'npx', env: { KEY: '$NONEXISTENT_VAR_445' } } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.svc as Record<string, unknown>;
    expect(server.env).toEqual({ KEY: '' });
    expect(result.missingVars).toContain('NONEXISTENT_VAR_445');
  });

  it('does not expand vars in command or args fields', async () => {
    process.env.TEST_CMD_445 = 'should-not-expand';
    const config = { svc: { command: '$TEST_CMD_445', args: ['$TEST_CMD_445'] } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.svc as Record<string, unknown>;
    expect(server.command).toBe('$TEST_CMD_445');
    expect(server.args).toEqual(['$TEST_CMD_445']);

    delete process.env.TEST_CMD_445;
  });

  it('resolves absolute paths as-is', async () => {
    const config = { svc: { command: 'npx' } };
    const absPath = join(testDir, 'abs.json');
    await writeFile(absPath, JSON.stringify(config));

    const result = await loadMcpConfig(absPath, '/some/other/dir');
    expect(result.serverNames).toEqual(['svc']);
  });

  it('throws on missing file', async () => {
    await expect(loadMcpConfig('nonexistent.json', testDir)).rejects.toThrow(
      'MCP config file not found'
    );
  });

  it('throws on invalid JSON', async () => {
    await writeFile(join(testDir, 'bad.json'), 'not json');
    await expect(loadMcpConfig('bad.json', testDir)).rejects.toThrow('not valid JSON');
  });

  it('throws on non-object JSON (array)', async () => {
    await writeFile(join(testDir, 'arr.json'), '[]');
    await expect(loadMcpConfig('arr.json', testDir)).rejects.toThrow('must be a JSON object');
  });

  it('throws on non-object JSON (string)', async () => {
    await writeFile(join(testDir, 'str.json'), '"hello"');
    await expect(loadMcpConfig('str.json', testDir)).rejects.toThrow('must be a JSON object');
  });

  it('throws on array-valued server config', async () => {
    await writeFile(join(testDir, 'server-array.json'), JSON.stringify({ figma: [] }));

    await expect(loadMcpConfig('server-array.json', testDir)).rejects.toThrow(
      'MCP server "figma" must be a JSON object'
    );
  });

  it('throws on non-string env values', async () => {
    await writeFile(
      join(testDir, 'env-number.json'),
      JSON.stringify({ figma: { command: 'figma-mcp', env: { TOKEN: 123 } } })
    );

    await expect(loadMcpConfig('env-number.json', testDir)).rejects.toThrow(
      'MCP config figma.env.TOKEN must be a string'
    );
  });

  it('throws on non-string header values', async () => {
    await writeFile(
      join(testDir, 'header-array.json'),
      JSON.stringify({
        figma: {
          type: 'http',
          url: 'http://127.0.0.1:3845/mcp',
          headers: { Authorization: ['Bearer token'] },
        },
      })
    );

    await expect(loadMcpConfig('header-array.json', testDir)).rejects.toThrow(
      'MCP config figma.headers.Authorization must be a string'
    );
  });

  it('expands ${VAR_NAME} brace-form in env values', async () => {
    process.env.TEST_MCP_TOKEN_1612 = 'braced-secret';
    const config = { github: { command: 'npx', env: { TOKEN: '${TEST_MCP_TOKEN_1612}' } } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.github as Record<string, unknown>;
    expect(server.env).toEqual({ TOKEN: 'braced-secret' });

    delete process.env.TEST_MCP_TOKEN_1612;
  });

  it('expands ${VAR_NAME} brace-form in headers values', async () => {
    process.env.TEST_API_KEY_1612 = 'braced-key';
    const config = {
      api: {
        type: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer ${TEST_API_KEY_1612}' },
      },
    };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.api as Record<string, unknown>;
    expect(server.headers).toEqual({ Authorization: 'Bearer braced-key' });

    delete process.env.TEST_API_KEY_1612;
  });

  it('replaces undefined brace-form vars with empty string and reports them', async () => {
    delete process.env.NONEXISTENT_VAR_1612;
    const config = { svc: { command: 'npx', env: { KEY: '${NONEXISTENT_VAR_1612}' } } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.svc as Record<string, unknown>;
    expect(server.env).toEqual({ KEY: '' });
    expect(result.missingVars).toContain('NONEXISTENT_VAR_1612');
  });

  it('expands mixed bare and brace-form vars in the same string', async () => {
    process.env.TEST_HOST_1612 = 'db.example.com';
    process.env.TEST_PORT_1612 = '5432';
    const config = {
      db: {
        command: 'npx',
        env: { DSN: 'postgres://$TEST_HOST_1612:${TEST_PORT_1612}/mydb' },
      },
    };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.db as Record<string, unknown>;
    expect(server.env).toEqual({ DSN: 'postgres://db.example.com:5432/mydb' });

    delete process.env.TEST_HOST_1612;
    delete process.env.TEST_PORT_1612;
  });

  it('does not expand brace-form vars in command or args fields', async () => {
    process.env.TEST_CMD_1612 = 'should-not-expand';
    const config = { svc: { command: '${TEST_CMD_1612}', args: ['${TEST_CMD_1612}'] } };
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify(config));

    const result = await loadMcpConfig('mcp.json', testDir);
    const server = result.servers.svc as Record<string, unknown>;
    expect(server.command).toBe('${TEST_CMD_1612}');
    expect(server.args).toEqual(['${TEST_CMD_1612}']);

    delete process.env.TEST_CMD_1612;
  });
});

// ---------------------------------------------------------------------------
// Skills — executor-level behavior (#446)
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- skills options', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('passes agents/agent/allowedTools to sendQuery when node has skills', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-skills',
        nodes: [{ id: 'review', command: 'my-cmd', skills: ['codebase-search', 'test-runner'] }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    // skills are passed in nodeConfig — provider translates to agents internally
    expect(nodeConfig?.skills).toEqual(['codebase-search', 'test-runner']);
  });

  it('appends Skill to existing allowed_tools list when node has both', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-skills-tools',
        nodes: [
          {
            id: 'review',
            command: 'my-cmd',
            skills: ['codebase-search'],
            allowed_tools: ['Read', 'Grep'],
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    // skills and allowed_tools are both in nodeConfig — provider merges internally
    expect(nodeConfig?.skills).toEqual(['codebase-search']);
    expect(nodeConfig?.allowed_tools).toEqual(['Read', 'Grep']);
  });

  it('warns that Codex ignores the YAML skills list', async () => {
    mockGetAgentProviderDag.mockReturnValue({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-codex-skills',
        nodes: [
          { id: 'review', command: 'my-cmd', provider: 'codex', skills: ['codebase-search'] },
        ],
      },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    // Codex workflow nodes suppress the ambient catalog. Authors invoke installed
    // native skills explicitly in the command/prompt with `$skill-name` instead.
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const warning = messages.find(m => m.includes('skills') && m.includes('codex'));
    expect(warning).toBeDefined();
  });

  it('passes agents to sendQuery nodeConfig when node has inline agents', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const agentsMap = {
      'brief-gen': {
        description: 'Summarises an issue',
        prompt: 'You are concise.',
        model: 'haiku',
        tools: ['Bash', 'Read'],
      },
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-agents',
        nodes: [{ id: 'review', command: 'my-cmd', agents: agentsMap }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.agents).toEqual(agentsMap);
  });

  it('warns user when Codex DAG node has inline agents', async () => {
    mockGetAgentProviderDag.mockReturnValue({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-codex-agents',
        nodes: [
          {
            id: 'review',
            command: 'my-cmd',
            provider: 'codex',
            agents: {
              'brief-gen': { description: 'd', prompt: 'p' },
            },
          },
        ],
      },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const warning = messages.find(m => m.includes('agents') && m.includes('codex'));
    expect(warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Skills — loader validation via discoverWorkflows (#446)
// ---------------------------------------------------------------------------

describe('skills field validation via parseWorkflow', () => {
  it('parses valid skills array on a DAG node', () => {
    const yaml = `
name: test-skills
description: test
nodes:
  - id: review
    prompt: "Review the code"
    skills:
      - codebase-search
      - test-runner
`;
    const result = parseWorkflow(yaml, 'test.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes).toBeDefined();
    expect(wf.nodes[0].skills).toEqual(['codebase-search', 'test-runner']);
  });

  it('rejects non-string skills array entries', () => {
    const yaml = `
name: bad-skills
description: test
nodes:
  - id: review
    prompt: "Review"
    skills:
      - 123
`;
    const result = parseWorkflow(yaml, 'bad.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toContain('skills');
  });

  it('accepts empty skills array', () => {
    const yaml = `
name: empty-skills
description: test
nodes:
  - id: review
    prompt: "Review"
    skills: []
`;
    const result = parseWorkflow(yaml, 'empty.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow?.nodes[0].skills).toEqual([]);
  });

  it('ignores skills on bash nodes with warning', () => {
    const yaml = `
name: bash-skills
description: test
nodes:
  - id: lint
    bash: "echo lint"
    skills:
      - should-be-ignored
`;
    const result = parseWorkflow(yaml, 'bash-skills.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes).toBeDefined();
    // Bash nodes don't get the skills field
    expect(wf.nodes[0].skills).toBeUndefined();
  });

  it('node with no skills has undefined skills field', () => {
    const yaml = `
name: no-skills
description: test
nodes:
  - id: basic
    prompt: "Do something"
`;
    const result = parseWorkflow(yaml, 'no-skills.yaml');
    expect(result.error).toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes).toBeDefined();
    expect(wf.nodes[0].skills).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Inline agents — field validation via parseWorkflow
// ---------------------------------------------------------------------------

describe('agents field validation via parseWorkflow', () => {
  it('parses a valid agents map on a DAG node', () => {
    const yaml = `
name: test-agents
description: test
nodes:
  - id: triage
    prompt: "Spawn a brief-gen sub-agent"
    agents:
      brief-gen:
        description: Summarises an issue
        prompt: "You are concise. Return JSON { summary }."
        model: haiku
        tools: [Bash, Read]
`;
    const result = parseWorkflow(yaml, 'agents.yaml');
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
    const wf = result.workflow!;
    const node = wf.nodes[0];
    expect(node.agents).toBeDefined();
    expect(node.agents!['brief-gen'].description).toBe('Summarises an issue');
    expect(node.agents!['brief-gen'].model).toBe('haiku');
    expect(node.agents!['brief-gen'].tools).toEqual(['Bash', 'Read']);
  });

  it('rejects an agent missing description', () => {
    const yaml = `
name: missing-desc
description: test
nodes:
  - id: triage
    prompt: "p"
    agents:
      brief-gen:
        prompt: "You are concise."
`;
    const result = parseWorkflow(yaml, 'missing-desc.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toContain('agents');
  });

  it('rejects an agent missing prompt', () => {
    const yaml = `
name: missing-prompt
description: test
nodes:
  - id: triage
    prompt: "p"
    agents:
      brief-gen:
        description: "A brief generator"
`;
    const result = parseWorkflow(yaml, 'missing-prompt.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toContain('agents');
  });

  it('rejects empty agents map', () => {
    const yaml = `
name: empty-agents
description: test
nodes:
  - id: triage
    prompt: "p"
    agents: {}
`;
    const result = parseWorkflow(yaml, 'empty-agents.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toContain('agents');
  });

  it('rejects agent ID that is not kebab-case', () => {
    const yaml = `
name: bad-id
description: test
nodes:
  - id: triage
    prompt: "p"
    agents:
      BriefGen:
        description: "d"
        prompt: "p"
`;
    const result = parseWorkflow(yaml, 'bad-id.yaml');
    expect(result.error).not.toBeNull();
    expect(result.error!.error).toContain('kebab-case');
  });

  it('ignores agents on bash nodes (field stripped, no error)', () => {
    const yaml = `
name: bash-agents
description: test
nodes:
  - id: lint
    bash: "echo lint"
    agents:
      helper:
        description: "d"
        prompt: "p"
`;
    const result = parseWorkflow(yaml, 'bash-agents.yaml');
    expect(result.error).toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes[0].agents).toBeUndefined();
  });

  it('ignores agents on script nodes (field stripped, no error)', () => {
    const yaml = `
name: script-agents
description: test
nodes:
  - id: run
    script: 'console.log("hi")'
    runtime: bun
    agents:
      helper:
        description: "d"
        prompt: "p"
`;
    const result = parseWorkflow(yaml, 'script-agents.yaml');
    expect(result.error).toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes[0].agents).toBeUndefined();
  });

  it('ignores agents on loop nodes (field stripped, no error)', () => {
    const yaml = `
name: loop-agents
description: test
nodes:
  - id: iterate
    loop:
      prompt: "Do the work"
      until: "DONE"
      max_iterations: 2
    agents:
      helper:
        description: "d"
        prompt: "p"
`;
    const result = parseWorkflow(yaml, 'loop-agents.yaml');
    expect(result.error).toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes[0].agents).toBeUndefined();
  });

  it('node with no agents field is undefined', () => {
    const yaml = `
name: no-agents
description: test
nodes:
  - id: basic
    prompt: "Do something"
`;
    const result = parseWorkflow(yaml, 'no-agents.yaml');
    expect(result.error).toBeNull();
    const wf = result.workflow!;
    expect(wf.nodes[0].agents).toBeUndefined();
  });
});

describe('executeDagWorkflow -- resume with priorCompletedNodes', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-resume-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'step1.md'), 'Step 1 prompt');
    await writeFile(join(commandsDir, 'step2.md'), 'Step 2 prompt using $step1.output');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'AI response' };
      yield { type: 'result', sessionId: 'session-id' };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('skips nodes that appear in priorCompletedNodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const priorCompletedNodes = new Map([['step1', 'prior step1 output']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'two-step',
        nodes: [
          { id: 'step1', command: 'step1' },
          { id: 'step2', command: 'step2', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // Only step2 should have been executed (step1 was skipped)
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
  });

  it('pre-populates nodeOutputs so downstream nodes can use $nodeId.output', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    let capturedPrompt = '';
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      capturedPrompt = prompt;
      yield { type: 'assistant', content: 'step2 result' };
      yield { type: 'result', sessionId: 'session-id' };
    });

    const priorCompletedNodes = new Map([['step1', 'hello from prior run']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'two-step',
        nodes: [
          { id: 'step1', command: 'step1' },
          { id: 'step2', prompt: 'Use this: $step1.output', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // The prompt sent to AI should contain the prior run's output
    expect(capturedPrompt).toContain('hello from prior run');
  });

  it('emits node_skipped_prior_success event for resumed nodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('resume-run-id');

    const priorCompletedNodes = new Map([['step1', 'prior output']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'two-step',
        nodes: [
          { id: 'step1', command: 'step1' },
          { id: 'step2', command: 'step2', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const skippedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_skipped_prior_success' &&
        (call[0] as { step_name: string }).step_name === 'step1'
    );
    expect(skippedEvent).toBeDefined();
    expect(skippedEvent[0].data.node_output).toBe('prior output');
  });

  it('emits node_skipped_prior_success with empty output when node ID not in map', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('resume-empty-output');

    // priorCompletedNodes has step1 but with undefined value to test the ?? '' fallback
    const priorCompletedNodes = new Map<string, string>([
      ['step1', undefined as unknown as string],
    ]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'two-step',
        nodes: [
          { id: 'step1', command: 'step1' },
          { id: 'step2', command: 'step2', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const skippedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_skipped_prior_success' &&
        (call[0] as { step_name: string }).step_name === 'step1'
    );
    expect(skippedEvent).toBeDefined();
    // The ?? '' fallback kicks in when the map value is undefined
    expect(skippedEvent[0].data.node_output).toBe('');
  });

  it('runs all nodes when priorCompletedNodes is empty', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'two-step',
        nodes: [
          { id: 'step1', command: 'step1' },
          { id: 'step2', command: 'step2', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map()
    );

    // Both nodes should execute
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
  });

  it('reconciles total tokens across a failed run and its resume', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('resume-token-reconciliation');
    const workflow = {
      name: 'resume-token-reconciliation',
      nodes: [
        { id: 'step1', command: 'step1' },
        { id: 'step2', command: 'step2', depends_on: ['step1'] },
      ],
    };

    let firstInvocationCall = 0;
    mockSendQueryDag.mockImplementation(function* () {
      firstInvocationCall++;
      if (firstInvocationCall === 1) {
        yield { type: 'assistant', content: 'first execution output' };
        yield {
          type: 'result',
          sessionId: 'first-execution-session',
          tokens: { input: 40, output: 4 },
        };
        return;
      }
      // A result without assistant output fails step2 after step1 has persisted
      // its node_completed event.
      yield { type: 'result', sessionId: 'failed-step-session' };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume-tokens',
      testDir,
      workflow,
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.failWorkflowRun).toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();

    const firstExecutionEvents = (
      store.createWorkflowEvent as ReturnType<typeof mock>
    ).mock.calls.map(
      (call: unknown[]) =>
        call[0] as {
          event_type: string;
          step_name?: string;
          data?: Record<string, unknown>;
        }
    );
    const priorCompletedNodes = new Map<string, string>();
    const priorTokenUsage = { input: 0, output: 0 };
    for (const event of firstExecutionEvents) {
      if (event.event_type !== 'node_completed' || !event.step_name) continue;
      if (typeof event.data?.node_output === 'string') {
        priorCompletedNodes.set(event.step_name, event.data.node_output);
      }
      const eventTokens = event.data?.tokens as { input?: unknown; output?: unknown } | undefined;
      if (
        typeof eventTokens?.input === 'number' &&
        typeof eventTokens.output === 'number' &&
        Number.isFinite(eventTokens.input) &&
        Number.isFinite(eventTokens.output)
      ) {
        priorTokenUsage.input += eventTokens.input;
        priorTokenUsage.output += eventTokens.output;
      }
    }
    expect(priorCompletedNodes).toEqual(new Map([['step1', 'first execution output']]));
    expect(priorTokenUsage).toEqual({ input: 40, output: 4 });

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'resumed execution output' };
      yield {
        type: 'result',
        sessionId: 'resumed-execution-session',
        tokens: { input: 60, output: 6 },
      };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume-tokens',
      testDir,
      workflow,
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      priorTokenUsage
    );

    const completionCalls = (store.completeWorkflowRun as ReturnType<typeof mock>).mock.calls;
    expect(completionCalls).toHaveLength(1);
    expect(completionCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        total_tokens_in: 100,
        total_tokens_out: 10,
      })
    );

    const completedEvents = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls
      .map(
        (call: unknown[]) =>
          call[0] as {
            event_type: string;
            data?: { tokens?: { input: number; output: number } };
          }
      )
      .filter(event => event.event_type === 'node_completed' && event.data?.tokens !== undefined);
    const eventTokenTotal = completedEvents.reduce(
      (total, event) => ({
        input: total.input + (event.data?.tokens?.input ?? 0),
        output: total.output + (event.data?.tokens?.output ?? 0),
      }),
      { input: 0, output: 0 }
    );
    expect(eventTokenTotal).toEqual({ input: 100, output: 10 });
  });

  // #2091: on resume, prior completed nodes are rehydrated from text only, so the
  // producer's output_format field set must be re-derived from the loaded definition —
  // otherwise the strict `$node.output.field` contract downgrades to the schemaless
  // path and a resumed run gets different semantics than a fresh one.
  it("re-derives declaredFields on resume so a declared-optional-absent field resolves to ''", async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('resume-declared-optional');

    let capturedPrompt = '';
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      capturedPrompt = prompt;
      yield { type: 'assistant', content: 'step2 result' };
      yield { type: 'result', sessionId: 'session-id' };
    });

    // Prior JSON output omits the declared-optional `note` field.
    const priorCompletedNodes = new Map([['step1', '{"type":"BUG"}']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'declared-optional',
        nodes: [
          {
            id: 'step1',
            prompt: 'produce json',
            output_format: {
              type: 'object',
              properties: { type: { type: 'string' }, note: { type: 'string' } },
              required: ['type'],
            },
          },
          { id: 'step2', prompt: 'note=[$step1.output.note]', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // The consumer must run (step1 was skipped, so exactly one AI call = step2),
    // and the declared-but-absent `note` resolves to '' — not a missing-key throw.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(capturedPrompt).toBe('note=[]');
  });

  it('re-derives declaredFields on resume so an undeclared key fails the consumer (not-in-schema)', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('resume-undeclared-key');

    // Prior JSON output carries an `extra` key that the schema does NOT declare.
    const priorCompletedNodes = new Map([['step1', '{"type":"BUG","extra":"x"}']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-resume',
      testDir,
      {
        name: 'undeclared-key',
        nodes: [
          {
            id: 'step1',
            prompt: 'produce json',
            output_format: {
              type: 'object',
              properties: { type: { type: 'string' } },
              required: ['type'],
            },
          },
          { id: 'step2', prompt: 'extra=[$step1.output.extra]', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // The undeclared `extra` must fail the consumer before the AI runs (0 calls),
    // matching fresh-run behavior instead of silently resolving via the schemaless path.
    expect(mockSendQueryDag.mock.calls.length).toBe(0);

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'step2'
    );
    expect(failedEvent).toBeDefined();
    expect((failedEvent[0].data as { error: string }).error).toContain('is not declared in node');
  });

  it('stores node_output in node_completed event data for bash nodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('bash-output-persist-run');

    const bashNode: BashNode = { id: 'stats', bash: 'echo "bash output"' };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-bash-output',
      testDir,
      { name: 'bash-output-test', nodes: [bashNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'stats'
    );
    expect(completedEvent).toBeDefined();
    expect((completedEvent![0] as { data: { node_output: string } }).data.node_output).toContain(
      'bash output'
    );
  });

  it('persists bash output at or below the byte cap unchanged without truncation metadata', async () => {
    for (const [nodeId, byteCount] of [
      ['below-cap', 32_767],
      ['exact-cap', 32_768],
    ] as const) {
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const workflowRun = makeWorkflowRun(`bash-output-${nodeId}`);

      await executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        `conv-${nodeId}`,
        testDir,
        {
          name: `bash-output-${nodeId}`,
          nodes: [{ id: nodeId, bash: `printf '%${String(byteCount)}s' '' | tr ' ' x` }],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const completedEvent = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as { event_type: string }).event_type === 'node_completed' &&
          (call[0] as { step_name: string }).step_name === nodeId
      );
      const data = (
        completedEvent![0] as {
          data: Record<string, unknown> & { node_output: string };
        }
      ).data;
      expect(data.node_output).toBe('x'.repeat(byteCount));
      expect(data.node_output_truncated).toBeUndefined();
      expect(data.node_output_original_bytes).toBeUndefined();
    }
  });

  it('caps over-limit persisted bash output with a marker and byte metadata', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const workflowRun = makeWorkflowRun('bash-output-over-cap');

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-over-cap',
      testDir,
      {
        name: 'bash-output-over-cap',
        nodes: [{ id: 'over-cap', bash: "printf '%32769s' '' | tr ' ' x" }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'over-cap'
    );
    const data = (
      completedEvent![0] as {
        data: {
          node_output: string;
          node_output_truncated: boolean;
          node_output_original_bytes: number;
        };
      }
    ).data;
    expect(Buffer.byteLength(data.node_output, 'utf8')).toBeLessThanOrEqual(32_768);
    expect(data.node_output).toEndWith('\n\n… [truncated; original output was 32769 bytes]');
    expect(data.node_output_truncated).toBe(true);
    expect(data.node_output_original_bytes).toBe(32_769);
    // Resume deliberately rehydrates this bounded node_output preview; preserving
    // complete cross-process output requires a separately managed artifact.
  });

  it('keeps a persisted UTF-8 preview valid when the byte cap splits a code point', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const workflowRun = makeWorkflowRun('bash-output-utf8-cap');

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-utf8-cap',
      testDir,
      {
        name: 'bash-output-utf8-cap',
        nodes: [{ id: 'utf8-cap', bash: `bun -e "process.stdout.write('🙂'.repeat(8193))"` }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'utf8-cap'
    );
    const data = (completedEvent![0] as { data: { node_output: string } }).data;
    expect(Buffer.byteLength(data.node_output, 'utf8')).toBeLessThanOrEqual(32_768);
    expect(data.node_output).not.toContain('\ufffd');
    expect(data.node_output).toEndWith('\n\n… [truncated; original output was 32772 bytes]');
  });

  it('uses full bash output for same-run when and downstream substitution despite persistence cap', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const workflowRun = makeWorkflowRun('bash-output-live-full');
    const paddingBytes = 33_000;

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-live-full',
      testDir,
      {
        name: 'bash-output-live-full',
        nodes: [
          {
            id: 'producer',
            bash: `printf '{"status":"PASS","padding":"'; printf '%${String(paddingBytes)}s' '' | tr ' ' x; printf '"}'`,
          },
          {
            id: 'consumer',
            bash: 'value=$producer.output; printf %s "${#value}"',
            depends_on: ['producer'],
            when: "$producer.output.status == 'PASS'",
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const producerEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'producer'
    );
    const consumerEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'consumer'
    );
    expect(
      (producerEvent![0] as { data: { node_output_truncated: boolean } }).data.node_output_truncated
    ).toBe(true);
    expect((consumerEvent![0] as { data: { node_output: string } }).data.node_output).toBe(
      String(paddingBytes + 30)
    );
  });

  it('stores node_output in node_completed event data for AI nodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('output-persist-run');

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'the node output text' };
      yield {
        type: 'result',
        sessionId: 'sid',
        resolvedModel: { id: 'claude-opus-5' },
        tokens: { input: 100, output: 10 },
      };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-output',
      testDir,
      {
        name: 'single-node',
        nodes: [{ id: 'step1', command: 'step1', model: 'requested-model' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'step1'
    );
    expect(completedEvent).toBeDefined();
    expect((completedEvent![0] as { data: { node_output: string } }).data.node_output).toBe(
      'the node output text'
    );
    expect(
      (completedEvent![0] as { data: { model_usage: { requested: string; resolved: string } } })
        .data.model_usage
    ).toEqual({ requested: 'requested-model', resolved: 'claude-opus-5' });
    expect(
      (completedEvent![0] as { data: { tokens: { input: number; output: number } } }).data.tokens
    ).toEqual({ input: 100, output: 10 });
  });

  it('omits tokens from a direct AI node_completed event when the provider reports no usage', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'the node output text' };
      yield { type: 'result', sessionId: 'no-usage-sid' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-no-usage',
      testDir,
      { name: 'no-usage', nodes: [{ id: 'step1', command: 'step1' }] },
      makeWorkflowRun('no-usage-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    const completedEvent = eventCalls.find(
      ([event]) => event.event_type === 'node_completed' && event.step_name === 'step1'
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.[0].data).not.toHaveProperty('tokens');
  });

  it('persists only {input, output} — provider-defined total/cost are not part of the shape', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'out' };
      // Pi/OpenCode shape: `total` folds in cache/reasoning tokens, so it is NOT
      // input + output. Persisting it would hand consumers a field they cannot
      // interpret without knowing the provider; `cost` duplicates cost_usd.
      yield {
        type: 'result',
        sessionId: 'shape-sid',
        tokens: { input: 100, output: 10, total: 900, cost: 0.5 },
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-shape',
      testDir,
      { name: 'token-shape', nodes: [{ id: 'step1', command: 'step1' }] },
      makeWorkflowRun('token-shape-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    const completedEvent = eventCalls.find(
      ([event]) => event.event_type === 'node_completed' && event.step_name === 'step1'
    );
    expect(completedEvent?.[0].data?.tokens).toEqual({ input: 100, output: 10 });
  });

  it('drops non-finite provider token counts instead of persisting them', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'out' };
      yield { type: 'result', sessionId: 'nan-sid', tokens: { input: NaN, output: 10 } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-nan',
      testDir,
      { name: 'nan-tokens', nodes: [{ id: 'step1', command: 'step1' }] },
      makeWorkflowRun('nan-tokens-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    const completedEvent = eventCalls.find(
      ([event]) => event.event_type === 'node_completed' && event.step_name === 'step1'
    );
    expect(completedEvent).toBeDefined();
    // A NaN would serialize to `{input: null, output: 10}` — a wrong number that
    // gets believed. Absence is the honest answer.
    expect(completedEvent?.[0].data).not.toHaveProperty('tokens');
  });

  // ─── Per-pass usage recording (node cost tracking) ──────────────────────
  describe('executeDagWorkflow -- usage recording per AI pass', () => {
    const sampleEntry = (overrides?: Record<string, unknown>) => ({
      provider: 'anthropic',
      model: 'claude-test',
      modelSource: 'reported' as const,
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.012,
      ...overrides,
    });

    const runSimple = async (opts: {
      store?: ReturnType<typeof createMockStore>;
      deps?: WorkflowDeps;
      runId?: string;
      workflow?: WorkflowDefinition;
      workflowRun?: WorkflowRun;
      provider?: string;
      config?: WorkflowConfig;
    }) => {
      const store = opts.store ?? createMockStore();
      const mockDeps = opts.deps ?? createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = opts.workflowRun ?? makeWorkflowRun(opts.runId ?? 'usage-run');
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-usage',
        testDir,
        opts.workflow ?? {
          name: 'usage-wf',
          nodes: [{ id: 'ai', prompt: 'do work' }],
        },
        workflowRun,
        opts.provider ?? 'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        opts.config ?? minimalConfig
      );
      return { store, mockDeps, workflowRun };
    };

    const usageCalls = (deps: WorkflowDeps) =>
      (deps.usageRecorder.recordWorkflowUsage as Mock).mock.calls.map(
        (c: unknown[]) => c[0] as Record<string, unknown>
      );

    it('records once on standard AI success', async () => {
      const breakdown = [sampleEntry()];
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'ok' };
        yield { type: 'result', sessionId: 's1', usageBreakdown: breakdown };
      });
      const { mockDeps, workflowRun } = await runSimple({});
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        runId: workflowRun.id,
        stepName: 'ai',
        agentProvider: 'claude',
        retryEpoch: 0,
        reaskAttempt: 0,
        terminalError: false,
        errorSubtype: null,
        iteration: null,
      });
      expect(calls[0].usageBreakdown).toEqual(breakdown);
    });

    it('records once before failing on SDK error result with usage', async () => {
      const breakdown = [sampleEntry({ costUsd: 0.05 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'result',
          sessionId: 'err',
          isError: true,
          errorSubtype: 'error_during_execution',
          usageBreakdown: breakdown,
        };
      });
      const { mockDeps, store } = await runSimple({});
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        terminalError: true,
        errorSubtype: 'error_during_execution',
        reaskAttempt: 0,
      });
      expect(calls[0].usageBreakdown).toEqual(breakdown);
      const failed = (store.createWorkflowEvent as Mock).mock.calls.find(
        (c: unknown[]) => (c[0] as { event_type: string }).event_type === 'node_failed'
      );
      expect(failed).toBeDefined();
    });

    it('records nothing when the generator throws without a terminal usage result', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'partial' };
        throw new Error('stream exploded');
      });
      const { mockDeps } = await runSimple({});
      expect(usageCalls(mockDeps)).toHaveLength(0);
    });

    it('records only the latest usageBreakdown when one pass yields two cumulative results', async () => {
      const first = [sampleEntry({ inputTokens: 1, costUsd: 0.001 })];
      const latest = [sampleEntry({ inputTokens: 99, costUsd: 0.09 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: first };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'done after bg' };
        yield { type: 'result', sessionId: 's1', usageBreakdown: latest };
      });
      const { mockDeps } = await runSimple({});
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0].usageBreakdown).toEqual(latest);
    });

    it('keeps valid siblings when one usage entry is invalid on a standard node', async () => {
      mockLogFn.mockClear();
      const validA = sampleEntry({ model: 'a', inputTokens: 11, costUsd: 0.011 });
      const invalid = {
        provider: 'anthropic',
        model: 'b',
        modelSource: 'reported',
        // missing numeric measure → rejected
      };
      const validC = sampleEntry({ model: 'c', inputTokens: 33, costUsd: 0.033 });
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'ok' };
        yield {
          type: 'result',
          sessionId: 's1',
          usageBreakdown: [validA, invalid, validC],
        };
      });
      const { mockDeps } = await runSimple({});
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0].usageBreakdown).toEqual([validA, validC]);
      const rejectedWarns = mockLogFn.mock.calls.filter(
        (c: unknown[]) => c[1] === 'workflow.usage_entry_rejected'
      );
      expect(rejectedWarns).toHaveLength(1);
      const payload = rejectedWarns[0][0] as {
        rejected: Array<{ index: number; issue: string }>;
        retainedCount: number;
      };
      expect(payload.retainedCount).toBe(2);
      expect(payload.rejected).toEqual([{ index: 1, issue: expect.any(String) }]);
      expect(payload.rejected[0].issue).not.toContain('anthropic');
      expect(JSON.stringify(payload)).not.toContain('"b"');
    });

    it('keeps valid siblings when one usage entry is invalid on a direct loop', async () => {
      mockLogFn.mockClear();
      const validA = sampleEntry({ model: 'loop-a', inputTokens: 5, costUsd: 0.005 });
      const invalid = { estimatedCostUsd: 1 };
      const validC = sampleEntry({ model: 'loop-c', outputTokens: 7, costUsd: 0.007 });
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'result',
          sessionId: 'loop',
          usageBreakdown: [validA, invalid, validC],
        };
        yield { type: 'assistant', content: 'DONE' };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'loop-mixed-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 2,
              },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        stepName: 'work',
        iteration: 1,
        terminalError: false,
      });
      expect(calls[0].usageBreakdown).toEqual([validA, validC]);
      const rejectedWarns = mockLogFn.mock.calls.filter(
        (c: unknown[]) => c[1] === 'workflow.usage_entry_rejected'
      );
      expect(rejectedWarns.length).toBeGreaterThanOrEqual(1);
      const payload = rejectedWarns[0][0] as {
        rejected: Array<{ index: number; issue: string }>;
      };
      expect(payload.rejected.map(r => r.index)).toEqual([1]);
      expect(JSON.stringify(payload)).not.toContain('estimatedCostUsd');
    });

    it('clears earlier cumulative usage when the latest terminal result is empty', async () => {
      const earlier = [sampleEntry({ inputTokens: 40, costUsd: 0.04 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'done' };
        yield { type: 'result', sessionId: 's1', usageBreakdown: [] };
      });
      const { mockDeps } = await runSimple({});
      expect(usageCalls(mockDeps)).toHaveLength(0);
    });

    it('clears earlier cumulative usage when the latest terminal result is all-invalid', async () => {
      mockLogFn.mockClear();
      const earlier = [sampleEntry({ inputTokens: 50, costUsd: 0.05 })];
      const allInvalid = [
        { provider: '', model: 'x', modelSource: 'reported', inputTokens: 1 },
        { estimatedCostUsd: 9 },
      ];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'result', sessionId: 's1', usageBreakdown: allInvalid };
      });
      const { mockDeps } = await runSimple({});
      expect(usageCalls(mockDeps)).toHaveLength(0);
      const rejectedWarns = mockLogFn.mock.calls.filter(
        (c: unknown[]) => c[1] === 'workflow.usage_entry_rejected'
      );
      expect(rejectedWarns.length).toBeGreaterThanOrEqual(1);
      for (const call of rejectedWarns) {
        const payload = call[0] as { rejected: Array<{ index: number; issue: string }> };
        expect(JSON.stringify(payload)).not.toContain('estimatedCostUsd');
        for (const r of payload.rejected) {
          expect(r).toEqual({ index: expect.any(Number), issue: expect.any(String) });
        }
      }
    });

    it('clears earlier loop usage when the latest attempt result is empty', async () => {
      const earlier = [sampleEntry({ costUsd: 0.02 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'DONE' };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: [] };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'loop-clear-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 2,
              },
            },
          ],
        },
      });
      expect(usageCalls(mockDeps)).toHaveLength(0);
    });

    it('clears earlier standard usage when the latest terminal result omits usageBreakdown', async () => {
      const earlier = [sampleEntry({ inputTokens: 41, costUsd: 0.041 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'done' };
        // Final result deliberately omits usageBreakdown — stale earlier usage must not survive.
        yield { type: 'result', sessionId: 's1' };
      });
      const { mockDeps } = await runSimple({});
      expect(usageCalls(mockDeps)).toHaveLength(0);
    });

    it('clears earlier loop usage when the latest attempt result omits usageBreakdown', async () => {
      const earlier = [sampleEntry({ costUsd: 0.021 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'DONE' };
        yield { type: 'result', sessionId: 'loop' };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'loop-omit-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 2,
              },
            },
          ],
        },
      });
      expect(usageCalls(mockDeps)).toHaveLength(0);
    });

    it('fail-closes non-array usageBreakdown on standard nodes without retaining earlier usage', async () => {
      mockLogFn.mockClear();
      const earlier = [sampleEntry({ inputTokens: 60, costUsd: 0.06 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield {
          type: 'result',
          sessionId: 's1',
          // Runtime-malformed: providers must send an array; object must not preserve earlier usage.
          usageBreakdown: { provider: 'anthropic', inputTokens: 9 },
        } as never;
      });
      const { mockDeps } = await runSimple({});
      expect(usageCalls(mockDeps)).toHaveLength(0);
      const rejectedWarns = mockLogFn.mock.calls.filter(
        (c: unknown[]) => c[1] === 'workflow.usage_entry_rejected'
      );
      expect(rejectedWarns.length).toBeGreaterThanOrEqual(1);
      for (const call of rejectedWarns) {
        const payload = call[0] as { rejected: Array<{ index: number; issue: string }> };
        expect(JSON.stringify(payload)).not.toContain('anthropic');
        expect(JSON.stringify(payload)).not.toContain('inputTokens');
        for (const r of payload.rejected) {
          expect(r).toEqual({ index: expect.any(Number), issue: expect.any(String) });
        }
      }
    });

    it('fail-closes non-array usageBreakdown on direct loops without retaining earlier usage', async () => {
      mockLogFn.mockClear();
      const earlier = [sampleEntry({ costUsd: 0.022 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'assistant', content: 'DONE' };
        yield {
          type: 'result',
          sessionId: 'loop',
          usageBreakdown: 'not-an-array',
        } as never;
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'loop-malformed-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 2,
              },
            },
          ],
        },
      });
      expect(usageCalls(mockDeps)).toHaveLength(0);
      const rejectedWarns = mockLogFn.mock.calls.filter(
        (c: unknown[]) => c[1] === 'workflow.usage_entry_rejected'
      );
      expect(rejectedWarns.length).toBeGreaterThanOrEqual(1);
      for (const call of rejectedWarns) {
        expect(JSON.stringify(call[0])).not.toContain('not-an-array');
      }
    });

    it('pairs terminalError metadata with the latest standard result that owns the breakdown', async () => {
      const successUsage = [sampleEntry({ costUsd: 0.01 })];
      const errorUsage = [sampleEntry({ costUsd: 0.09 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield {
          type: 'result',
          sessionId: 's1',
          usageBreakdown: successUsage,
        };
        yield { type: 'background_tasks', tasks: [] };
        yield {
          type: 'result',
          sessionId: 's1',
          isError: true,
          errorSubtype: 'error_during_execution',
          usageBreakdown: errorUsage,
        };
      });
      const { mockDeps } = await runSimple({});
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        terminalError: true,
        errorSubtype: 'error_during_execution',
      });
      expect(calls[0].usageBreakdown).toEqual(errorUsage);
    });

    it('clears standard usage when a later error result omits breakdown', async () => {
      const earlier = [sampleEntry({ costUsd: 0.08 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 's1', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield {
          type: 'result',
          sessionId: 's1',
          isError: true,
          errorSubtype: 'error_during_execution',
        };
      });
      const { mockDeps, store } = await runSimple({});
      // Latest terminal result owns accounting and provided no breakdown — no stale success usage.
      expect(usageCalls(mockDeps)).toHaveLength(0);
      expect(store.failWorkflowRun).toHaveBeenCalled();
    });

    it('pairs loop terminalError metadata with the latest attempt result that owns the breakdown', async () => {
      const successUsage = [sampleEntry({ costUsd: 0.011 })];
      const errorUsage = [sampleEntry({ costUsd: 0.044 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: successUsage };
        yield { type: 'background_tasks', tasks: [] };
        yield {
          type: 'result',
          sessionId: 'loop',
          isError: true,
          errorSubtype: 'error_during_execution',
          usageBreakdown: errorUsage,
        };
      });
      const { mockDeps, store } = await runSimple({
        workflow: {
          name: 'loop-error-owns-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 3,
              },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        stepName: 'work',
        iteration: 1,
        terminalError: true,
        errorSubtype: 'error_during_execution',
      });
      expect(calls[0].usageBreakdown).toEqual(errorUsage);
      expect(store.failWorkflowRun).toHaveBeenCalled();
    });

    it('clears loop usage when a later error result omits breakdown', async () => {
      const earlier = [sampleEntry({ costUsd: 0.033 })];
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't1', taskType: 'local_agent', description: 'bg' }],
        };
        yield { type: 'result', sessionId: 'loop', usageBreakdown: earlier };
        yield { type: 'background_tasks', tasks: [] };
        yield {
          type: 'result',
          sessionId: 'loop',
          isError: true,
          errorSubtype: 'error_during_execution',
        };
      });
      const { mockDeps, store } = await runSimple({
        workflow: {
          name: 'loop-error-omit-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 3,
              },
            },
          ],
        },
      });
      expect(usageCalls(mockDeps)).toHaveLength(0);
      expect(store.failWorkflowRun).toHaveBeenCalled();
    });

    it('records each structured-output reask independently', async () => {
      const u1 = [sampleEntry({ costUsd: 0.01 })];
      const u2 = [sampleEntry({ costUsd: 0.02 })];
      mockSendQueryDag.mockImplementationOnce(function* () {
        yield {
          type: 'result',
          sessionId: 's1',
          structuredOutput: { other: 'x' },
          usageBreakdown: u1,
        };
      });
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'result',
          sessionId: 's2',
          structuredOutput: { verdict: 'ok' },
          usageBreakdown: u2,
        };
      });
      const { mockDeps } = await runSimple({
        provider: 'pi',
        config: { ...minimalConfig, assistant: 'pi' },
        workflow: {
          name: 'reask-usage',
          nodes: [
            {
              id: 'classify',
              prompt: 'decide',
              provider: 'pi',
              output_format: {
                type: 'object',
                properties: { verdict: { type: 'string' } },
                required: ['verdict'],
              },
              retry: { max_attempts: 0 },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        stepName: 'classify',
        agentProvider: 'pi',
        reaskAttempt: 0,
        terminalError: false,
      });
      expect(calls[0].usageBreakdown).toEqual(u1);
      expect(calls[1]).toMatchObject({ reaskAttempt: 1, terminalError: false });
      expect(calls[1].usageBreakdown).toEqual(u2);
    });

    it('records each outer node-level retry independently', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          throw new Error('Claude Code crash: process exited with code 1');
        }
        yield { type: 'assistant', content: 'recovered' };
        yield {
          type: 'result',
          sessionId: 'retry-ok',
          usageBreakdown: [sampleEntry({ costUsd: 0.03 })],
        };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'outer-retry-usage',
          nodes: [
            {
              id: 'flaky',
              prompt: 'try',
              retry: { max_attempts: 2, delay_ms: 0, backoff: 'fixed' },
            },
          ],
        },
      });
      // First attempt threw with no usage; second attempt recorded once.
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ stepName: 'flaky', reaskAttempt: 0, terminalError: false });
    });

    it('records each direct-loop iteration/reask with iteration metadata', async () => {
      let n = 0;
      mockSendQueryDag.mockImplementation(function* () {
        n++;
        if (n === 1) {
          yield {
            type: 'assistant',
            content: 'still going',
          };
          yield {
            type: 'result',
            sessionId: 'loop-1',
            usageBreakdown: [sampleEntry({ costUsd: 0.01 })],
          };
          return;
        }
        yield {
          type: 'assistant',
          content: 'DONE',
        };
        yield {
          type: 'result',
          sessionId: 'loop-2',
          usageBreakdown: [sampleEntry({ costUsd: 0.02 })],
        };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'loop-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'Do the work until DONE.',
                until: 'DONE',
                max_iterations: 5,
              },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        stepName: 'work',
        iteration: 1,
        reaskAttempt: 0,
        terminalError: false,
      });
      expect(calls[1]).toMatchObject({
        stepName: 'work',
        iteration: 2,
        reaskAttempt: 0,
        terminalError: false,
      });
    });

    it('loop-group body nodes use namespaced stepName with no group-level duplicate', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'COMPLETE' };
        yield {
          type: 'result',
          sessionId: 'lg',
          usageBreakdown: [sampleEntry()],
        };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'lg-usage',
          nodes: [
            {
              id: 'group',
              loop_group: {
                until: 'COMPLETE',
                max_iterations: 2,
                nodes: [{ id: 'body', prompt: 'emit COMPLETE' }],
              },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        stepName: 'group.body',
        // Loop-group body uses standard path — iteration is null on the usage record
        // (group iteration lives on lifecycle events only).
        iteration: null,
        reaskAttempt: 0,
      });
      // No group-level stepName 'group' usage row.
      expect(calls.every(c => c.stepName === 'group.body')).toBe(true);
    });

    it('pause/resume and retry_epoch append rather than replace', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'ok' };
        yield {
          type: 'result',
          sessionId: 'epoch',
          usageBreakdown: [sampleEntry({ costUsd: 0.07 })],
        };
      });
      // First pass epoch 0
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      await runSimple({
        store,
        deps: mockDeps,
        runId: 'epoch-run',
        workflowRun: makeWorkflowRun('epoch-run', { metadata: { retry_epoch: 0 } }),
      });
      // Second pass (manual retry-node style) epoch 2 — same recorder mock accumulates.
      await runSimple({
        store,
        deps: mockDeps,
        runId: 'epoch-run',
        workflowRun: makeWorkflowRun('epoch-run', { metadata: { retry_epoch: 2 } }),
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(2);
      expect(calls[0].retryEpoch).toBe(0);
      expect(calls[1].retryEpoch).toBe(2);
    });

    it('does not record for bash/script/non-AI nodes', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'should not run' };
        yield { type: 'result', sessionId: 'x', usageBreakdown: [sampleEntry()] };
      });
      const { mockDeps } = await runSimple({
        workflow: {
          name: 'non-ai',
          nodes: [
            { id: 'b', bash: 'echo hi' },
            {
              id: 's',
              runtime: 'bun',
              script: 'console.log("hi")',
              depends_on: ['b'],
            },
          ],
        },
      });
      expect(usageCalls(mockDeps)).toHaveLength(0);
      expect(mockSendQueryDag.mock.calls.length).toBe(0);
    });

    it('recorder rejection never changes the node outcome', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'ok' };
        yield {
          type: 'result',
          sessionId: 's',
          usageBreakdown: [sampleEntry()],
        };
      });
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      (mockDeps.usageRecorder.recordWorkflowUsage as Mock).mockImplementation(() =>
        Promise.reject(new Error('recorder blew up'))
      );
      await runSimple({ store, deps: mockDeps });
      const completed = (store.createWorkflowEvent as Mock).mock.calls.find(
        (c: unknown[]) => (c[0] as { event_type: string }).event_type === 'node_completed'
      );
      expect(completed).toBeDefined();
      expect(store.completeWorkflowRun).toHaveBeenCalled();
      expect(store.failWorkflowRun).not.toHaveBeenCalled();
    });

    it('records loop SDK error usage with terminalError before fail', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'result',
          isError: true,
          errorSubtype: 'error_during_execution',
          usageBreakdown: [sampleEntry({ costUsd: 0.04 })],
        };
      });
      const { mockDeps, store } = await runSimple({
        workflow: {
          name: 'loop-err-usage',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'go',
                until: 'DONE',
                max_iterations: 3,
              },
            },
          ],
        },
      });
      const calls = usageCalls(mockDeps);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        stepName: 'work',
        iteration: 1,
        terminalError: true,
        errorSubtype: 'error_during_execution',
      });
      expect(store.failWorkflowRun).toHaveBeenCalled();
    });
  });

  // ─── Background Agent Task Gating (#2083) ───────────────────────────────

  describe('background task completion gating (#2083)', () => {
    const runSingleNode = async (
      store: ReturnType<typeof createMockStore>,
      platform: IWorkflowPlatform,
      runId: string
    ): Promise<void> => {
      const mockDeps = createMockDeps(store);
      const workflowRun = makeWorkflowRun(runId);
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-bg-tasks',
        testDir,
        { name: 'bg-task-test', nodes: [{ id: 'step1', command: 'step1' }] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    };

    const findCompletedEvent = (
      store: ReturnType<typeof createMockStore>
    ): { data: Record<string, unknown> } | undefined => {
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const call = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_completed' &&
          (c[0] as { step_name: string }).step_name === 'step1'
      );
      return call?.[0] as { data: Record<string, unknown> } | undefined;
    };

    it('waits past a result with live background tasks and captures the follow-up output', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-1', taskType: 'local_agent', description: 'bg research' }],
        };
        yield { type: 'assistant', content: 'spawned agents' };
        // Turn-level result while t-1 is still live — must NOT complete the node
        yield { type: 'result', sessionId: 'sid', cost: 0.1 };
        // Post-result: task drains, follow-up turn integrates its output
        yield { type: 'assistant', content: ' + integrated task output' };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'result', sessionId: 'sid', cost: 0.3 };
      });

      const store = createMockStore();
      const platform = createMockPlatform();
      await runSingleNode(store, platform, 'bg-wait-run');

      const completed = findCompletedEvent(store);
      expect(completed).toBeDefined();
      // Output includes the post-result follow-up turn (the wait actually happened)
      expect(completed!.data.node_output).toBe('spawned agents + integrated task output');
      // Cost is the LAST result's session-cumulative value, not a sum
      expect(completed!.data.cost_usd).toBe(0.3);
      // Clean drain → no incompleteness recorded
      expect(completed!.data.background_tasks_incomplete).toBeUndefined();
      // The wait was announced to the user once
      const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(c =>
        String(c[1])
      );
      expect(sent.some(m => m.includes('background agent task(s) still running'))).toBe(true);
    });

    it('records background_tasks_incomplete and warns when the stream ends with live tasks', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-orphan', taskType: 'local_agent', description: 'never drains' }],
        };
        yield { type: 'assistant', content: 'partial work' };
        yield { type: 'result', sessionId: 'sid' };
        // Generator ends without the set draining (subprocess death analog)
      });

      const store = createMockStore();
      const platform = createMockPlatform();
      await runSingleNode(store, platform, 'bg-incomplete-run');

      const completed = findCompletedEvent(store);
      expect(completed).toBeDefined();
      expect(completed!.data.background_tasks_incomplete).toEqual(['t-orphan']);
      const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(c =>
        String(c[1])
      );
      expect(sent.some(m => m.includes('output may be missing'))).toBe(true);
    });

    it('suppresses the incompleteness warning when the node is genuinely cancelled with live tasks', async () => {
      // The run is cancelled mid-stream (caught by the throttled status check)
      // while a background task is still live. The stream ends with the task
      // dangling, but the node already returns 'failed — Cancelled by user',
      // so the incompleteness warning must be suppressed as noise.
      // setSystemTime jumps past CANCEL_CHECK_INTERVAL_MS between chunks so the
      // second status check fires deterministically (no real waiting).
      let tasksDelivered = false;
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-live', taskType: 'local_agent', description: 'still running' }],
        };
        tasksDelivered = true;
        setSystemTime(new Date(Date.now() + 11_000));
        yield { type: 'assistant', content: 'partial work' };
        yield { type: 'assistant', content: 'MUST NOT BE REACHED' };
      });

      const store = createMockStore();
      // 'running' until the task set has been delivered, 'cancelled' after —
      // guarantees the abort happens with the task registered as live.
      (store.getWorkflowRunStatus as Mock<() => Promise<string | null>>).mockImplementation(() =>
        Promise.resolve(tasksDelivered ? 'cancelled' : 'running')
      );
      const platform = createMockPlatform();
      try {
        await runSingleNode(store, platform, 'bg-cancelled-run');
      } finally {
        setSystemTime(); // restore the real clock
      }

      // The node failed as cancelled — it never completed
      expect(findCompletedEvent(store)).toBeUndefined();
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failedEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_failed' &&
          (c[0] as { step_name: string }).step_name === 'step1'
      );
      expect(failedEvent).toBeDefined();
      expect((failedEvent![0] as { data: { error: string } }).data.error).toBe('Cancelled by user');
      // Cancellation exemption: no user-facing incompleteness warning
      const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(c =>
        String(c[1])
      );
      expect(sent.some(m => m.includes('output may be missing'))).toBe(false);
      expect(sent.some(m => m.includes('background agent'))).toBe(false);
    });

    it('breaks at the first result when no background_tasks chunk was seen (unchanged behavior)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'normal output' };
        yield { type: 'result', sessionId: 'sid' };
        // Anything after the result must NOT be consumed
        yield { type: 'assistant', content: ' MUST NOT APPEAR' };
      });

      const store = createMockStore();
      const platform = createMockPlatform();
      await runSingleNode(store, platform, 'bg-none-run');

      const completed = findCompletedEvent(store);
      expect(completed).toBeDefined();
      expect(completed!.data.node_output).toBe('normal output');
      expect(completed!.data.background_tasks_incomplete).toBeUndefined();
    });

    it('persists output_file on task_notification task_activity events', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'delegating' };
        yield {
          type: 'task_notification',
          taskId: 't-9',
          status: 'completed',
          summary: 'wrote the report',
          outputFile: '/tmp/task-9-output.md',
        };
        yield { type: 'result', sessionId: 'sid' };
      });

      const store = createMockStore();
      const platform = createMockPlatform();
      await runSingleNode(store, platform, 'bg-output-file-run');

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const taskEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'task_activity' &&
          (c[0] as { data: { task_id?: string } }).data.task_id === 't-9'
      );
      expect(taskEvent).toBeDefined();
      expect((taskEvent![0] as { data: { output_file?: string } }).data.output_file).toBe(
        '/tmp/task-9-output.md'
      );
    });
  });

  // ─── Loop Node Tests ─────────────────────────────────────────────────────

  describe('loop node execution', () => {
    async function executeLoopProgressFixture(
      emitBash: string,
      store: IWorkflowStore
    ): Promise<void> {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'DONE' };
        yield { type: 'result', sessionId: 'loop-progress-done' };
      });
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-loop-progress',
        testDir,
        {
          name: 'loop-progress-fixture',
          nodes: [
            { id: 'emit-progress', bash: emitBash },
            {
              id: 'progress-loop',
              depends_on: ['emit-progress'],
              loop: {
                prompt: 'Do the work until DONE.',
                until: 'DONE',
                max_iterations: 2,
              },
            },
          ],
        },
        makeWorkflowRun('loop-progress-run'),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    }

    it('parses a loop_progress payload from a bash node onto its node_completed event', async () => {
      const store = createMockStore();
      await executeLoopProgressFixture(
        `printf '{"type":"loop_progress","targetNodeId":"progress-loop","expectedIterations":3}\\n'`,
        store
      );

      const withProgress = store.createWorkflowEvent.mock.calls
        .map(call => call[0])
        .filter(
          e =>
            e.event_type === 'node_completed' &&
            (e.data as Record<string, unknown>).loop_progress !== undefined
        );
      expect(withProgress).toHaveLength(1);
      expect((withProgress[0].data as Record<string, unknown>).loop_progress).toEqual({
        targetNodeId: 'progress-loop',
        expectedIterations: 3,
      });
    });

    it('ignores a non-positive loop_progress payload (no projection, run succeeds)', async () => {
      const store = createMockStore();
      await executeLoopProgressFixture(
        `printf '{"type":"loop_progress","targetNodeId":"progress-loop","expectedIterations":0}\\n'`,
        store
      );

      const withProgress = store.createWorkflowEvent.mock.calls
        .map(call => call[0])
        .filter(
          e =>
            e.event_type === 'node_completed' &&
            (e.data as Record<string, unknown>).loop_progress !== undefined
        );
      expect(withProgress).toHaveLength(0);
      expect(store.completeWorkflowRun).toHaveBeenCalled();
    });

    it('skips a Ralph loop when the PRD has no pending userStories', async () => {
      const sourceRoot = join(import.meta.dir, '..', '..', '..');
      await git.execFileAsync('git', ['init', '--quiet'], { cwd: testDir });
      const cmdPath = join(
        sourceRoot,
        '.archon',
        'commands',
        'defaults',
        'archon-speckit-ralph-iteration.md'
      );
      const parsed = parseWorkflow(
        `name: ralph-skip-fixture
description: Test-only Ralph loop skip fixture.
nodes:
  - id: ralph-native-preflight
    bash: |
      set -euo pipefail
      RLN_PRD=$(jq -r '.ralph_prd_file' .specify/feature.json)
      RLN_PENDING=$(jq '[.userStories[] | select(.completed == false)] | length' "$RLN_PRD")
      if [ "$RLN_PENDING" -gt 0 ]; then RLN_HAS=true; else RLN_HAS=false; fi
      printf '{"type":"loop_progress","targetNodeId":"ralph-loop-run","expectedIterations":%d,"hasPending":%s}\\n' "$RLN_PENDING" "$RLN_HAS"
  - id: ralph-loop-run
    loop:
      command: archon-speckit-ralph-iteration
      max_iterations: 2
      until_bash: exit 0
    depends_on: [ralph-native-preflight]
    when: "$ralph-native-preflight.output.hasPending == 'true'"
`,
        'ralph-skip-fixture.yaml'
      );
      if (parsed.error || !parsed.workflow) {
        throw new Error(
          parsed.error ? JSON.stringify(parsed.error) : 'Ralph skip fixture did not load'
        );
      }

      const commandsDir = join(testDir, '.archon', 'commands');
      const extensionDir = join(testDir, '.specify', 'extensions', 'ralph-loop');
      const ralphDir = join(testDir, '.specify', 'ralph');
      await mkdir(commandsDir, { recursive: true });
      await mkdir(extensionDir, { recursive: true });
      await mkdir(ralphDir, { recursive: true });
      await writeFile(
        join(commandsDir, 'archon-speckit-ralph-iteration.md'),
        await readFile(cmdPath, 'utf8')
      );
      await writeFile(join(extensionDir, 'AGENTS.md'), '# Ralph iteration rules\n');
      // Every userStory already complete → preflight emits hasPending:false → the
      // loop's `when` gate skips it (no iterations), and the run still completes.
      await writeFile(
        join(ralphDir, 'prd.json'),
        JSON.stringify({
          userStories: [{ id: 'US-001', completed: true, tasks: [{ id: 'T001', passes: true }] }],
        })
      );
      await writeFile(join(ralphDir, 'progress.txt'), 'done\n');
      await writeFile(
        join(testDir, '.specify', 'feature.json'),
        JSON.stringify({
          ralph_prd_file: '.specify/ralph/prd.json',
          ralph_progress_file: '.specify/ralph/progress.txt',
        })
      );

      const store = createMockStore();
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-ralph-skip',
        testDir,
        parsed.workflow,
        makeWorkflowRun('ralph-skip-run'),
        parsed.workflow.provider ?? 'codex',
        parsed.workflow.model,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag).not.toHaveBeenCalled();
      const started = store.createWorkflowEvent.mock.calls
        .map(call => call[0])
        .filter(e => e.event_type === 'loop_iteration_started');
      expect(started).toHaveLength(0);
      expect(store.completeWorkflowRun).toHaveBeenCalled();
      expect(store.failWorkflowRun).not.toHaveBeenCalled();
    });

    it('emits a loop tool_completed duration at tool_result, excluding later assistant time', async () => {
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-tool-result-run');

      setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'tool', toolName: 'read_file', toolInput: { path: '/a' } };
        setSystemTime(new Date('2026-01-01T00:00:00.050Z'));
        yield {
          type: 'tool_result',
          toolName: 'read_file',
          toolOutput: 'contents',
          toolOutcome: 'success',
        };
        setSystemTime(new Date('2026-01-01T00:01:00.050Z'));
        yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sess-tool-result' };
      });

      try {
        await executeDagWorkflow(
          mockDeps,
          platform,
          'conv-dag',
          testDir,
          {
            name: 'dag-loop-tool-result',
            nodes: [
              {
                id: 'my-loop',
                loop: {
                  prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                  until: 'COMPLETE',
                  max_iterations: 5,
                },
              },
            ],
          },
          workflowRun,
          'claude',
          undefined,
          join(testDir, 'artifacts'),
          join(testDir, 'state'),
          join(testDir, 'logs'),
          'main',
          'docs/',
          minimalConfig
        );
      } finally {
        setSystemTime();
      }

      const completedEvents = (
        store.createWorkflowEvent as ReturnType<typeof mock>
      ).mock.calls.filter(
        ([event]: [{ event_type: string }]) => event.event_type === 'tool_completed'
      );
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0][0].data).toMatchObject({
        tool_name: 'read_file',
        duration_ms: 50,
        tool_call_id: 'anonymous-1',
        tool_outcome: 'success',
      });
      const toolRows = (await store.listNodeMessages(workflowRun.id, 'my-loop')).filter(
        row => row.kind === 'tool'
      );
      expect(toolRows).toHaveLength(2);
      expect(toolRows[0]?.payload).toMatchObject({ name: 'read_file', id: 'anonymous-1' });
      expect(toolRows[0]?.payload).not.toHaveProperty('output');
      expect(toolRows[1]?.payload).toMatchObject({
        name: 'read_file',
        id: 'anonymous-1',
        output: 'contents',
      });
      expect(toolRows[1]?.metadata).toMatchObject({
        tool_phase: 'result',
        outcome: 'success',
      });
    });

    it('correlates interleaved loop tool lifecycles by toolCallId', async () => {
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-interleaved-tools-run');

      setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'tool', toolName: 'read_file', toolCallId: 'id-a' };
        setSystemTime(new Date('2026-01-01T00:00:00.010Z'));
        yield { type: 'tool', toolName: 'write_file', toolCallId: 'id-b' };
        setSystemTime(new Date('2026-01-01T00:00:00.040Z'));
        yield {
          type: 'tool_result',
          toolName: 'read_file',
          toolCallId: 'id-a',
          toolOutcome: 'success',
        };
        setSystemTime(new Date('2026-01-01T00:00:00.070Z'));
        yield {
          type: 'tool_result',
          toolName: 'write_file',
          toolCallId: 'id-b',
          toolOutcome: 'error',
        };
        yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sess-interleaved-tools' };
      });

      try {
        await executeDagWorkflow(
          mockDeps,
          platform,
          'conv-loop-interleaved-tools',
          testDir,
          {
            name: 'loop-interleaved-tools',
            nodes: [
              {
                id: 'my-loop',
                loop: { prompt: 'Complete the task.', until: 'COMPLETE', max_iterations: 1 },
              },
            ],
          },
          workflowRun,
          'claude',
          undefined,
          join(testDir, 'artifacts'),
          join(testDir, 'state'),
          join(testDir, 'logs'),
          'main',
          'docs/',
          minimalConfig
        );
      } finally {
        setSystemTime();
      }

      const completedEvents = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls
        .filter(([event]: [{ event_type: string }]) => event.event_type === 'tool_completed')
        .map(([event]: [{ data: Record<string, unknown> }]) => event.data);
      expect(completedEvents).toEqual(
        expect.arrayContaining([
          {
            tool_name: 'read_file',
            duration_ms: 40,
            tool_call_id: 'id-a',
            tool_outcome: 'success',
          },
          {
            tool_name: 'write_file',
            duration_ms: 60,
            tool_call_id: 'id-b',
            tool_outcome: 'error',
          },
        ])
      );
    });

    it('completes on <promise>COMPLETE</promise> signal in first iteration', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Did the task. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-session-1' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-test',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have called sendQuery exactly once (completed on iteration 1)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // Workflow should be marked completed with node counts metadata
      const completeCalls = (
        mockDeps.store.completeWorkflowRun as Mock<
          (id: string, metadata?: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(completeCalls.length).toBe(1);
      expect(completeCalls[0][1]).toEqual({
        node_counts: { completed: 1, failed: 0, skipped: 0, total: 1 },
      });
    });

    it('records requested model/tier on node_started and the resolved model on node_completed (#2314)', async () => {
      // Loop nodes own their sendQuery loop, so they need their own half of the
      // #2314 record: the requested alias on node_started, the concrete model
      // the provider reported on node_completed.
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Did the task. <promise>COMPLETE</promise>' };
        yield {
          type: 'result',
          sessionId: 'loop-model-sid',
          resolvedModel: { id: 'claude-opus-5-20260501' },
          tokens: { input: 100, output: 10 },
        };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-model-run');
      const aiProfile = buildAiProfile('claude', {
        repoTiers: { large: { provider: 'claude', model: 'opus', effort: 'max' } },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-model-usage',
          nodes: [
            {
              id: 'my-loop',
              model: 'large',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig,
        undefined,
        undefined,
        undefined,
        undefined,
        aiProfile
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
        [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
      >;
      const startedEvent = eventCalls.find(
        ([arg]) => arg.event_type === 'node_started' && arg.step_name === 'my-loop'
      );
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.[0].data?.provider).toBe('claude');
      expect(startedEvent?.[0].data?.model).toBe('opus');
      expect(startedEvent?.[0].data?.tier).toBe('large');
      expect(startedEvent?.[0].data?.effort).toBe('max');

      const completedEvent = eventCalls.find(
        ([arg]) => arg.event_type === 'node_completed' && arg.step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.[0].data?.model_usage).toEqual({
        requested: 'opus',
        resolved: 'claude-opus-5-20260501',
      });
      expect(completedEvent?.[0].data?.tokens).toEqual({ input: 100, output: 10 });
    });

    it('omits model_usage on node_completed when the provider reports no resolved model (#2314)', async () => {
      // Codex cannot report a concrete model — absence must stay absent rather
      // than being back-filled with the requested alias.
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Did the task. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-no-model-sid' };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-no-model-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-no-model-usage',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
        [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
      >;
      const completedEvent = eventCalls.find(
        ([arg]) => arg.event_type === 'node_completed' && arg.step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.[0].data).not.toHaveProperty('model_usage');
      expect(completedEvent?.[0].data).not.toHaveProperty('tokens');
    });

    it('clears a resolved model when a later result omits it, rather than reporting the stale one', async () => {
      // Pi/Copilot reask loops emit several result chunks and Pi omits resolvedModel
      // when its later assistant message carries no responseModel. A guarded
      // assignment would leave the FIRST chunk's model recorded as the node's answer
      // -- fabricated attribution, which is the defect #2314 exists to prevent.
      // Two results in ONE iteration, via the background-task wait (same shape as the
      // #2083 cost test): the first reports a model, the final one does not.
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-1', taskType: 'local_agent', description: 'bg work' }],
        };
        yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'stale-sid', resolvedModel: { id: 'claude-haiku-4-5' } };
        yield { type: 'background_tasks', tasks: [] };
        // Final result reports NO model, so the node must record none -- not
        // 'claude-haiku-4-5' retained from the earlier chunk.
        yield { type: 'result', sessionId: 'stale-sid' };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-stale-model-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-stale-model',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
        [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
      >;
      const completedEvent = eventCalls.find(
        ([arg]) => arg.event_type === 'node_completed' && arg.step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.[0].data).not.toHaveProperty('model_usage');
    });

    it('does not double-count cost when an iteration sees two results (background-task wait, #2083)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-1', taskType: 'local_agent', description: 'bg work' }],
        };
        yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
        // Session-cumulative cost: 0.1 at the first result, 0.3 at the final one
        yield { type: 'result', sessionId: 'loop-sid', cost: 0.1 };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'result', sessionId: 'loop-sid', cost: 0.3 };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-bg-cost-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-bg-cost',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const completedEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_completed' &&
          (c[0] as { step_name: string }).step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      // 0.3 (last session-cumulative value), NOT 0.4 (0.1 + 0.3 double-count)
      expect((completedEvent![0] as { data: { cost_usd?: number } }).data.cost_usd).toBe(0.3);
    });

    it('records the cross-iteration union of dangling background tasks on node_completed (#2083)', async () => {
      // Iterations 1 and 2 each end with a different task still live (subprocess
      // death analog); iteration 3 finishes cleanly and signals completion. The
      // node_completed event must carry the UNION of dangling ids — last-iteration
      // reporting would hide t-a and t-b behind the clean final iteration.
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'background_tasks',
            tasks: [{ taskId: 't-a', taskType: 'local_agent', description: 'never drains' }],
          };
          yield { type: 'assistant', content: 'first pass' };
          yield { type: 'result', sessionId: 'sid-1' };
          // Generator ends with t-a live
        } else if (callCount === 2) {
          yield {
            type: 'background_tasks',
            tasks: [{ taskId: 't-b', taskType: 'local_agent', description: 'never drains' }],
          };
          yield { type: 'assistant', content: 'second pass' };
          yield { type: 'result', sessionId: 'sid-2' };
          // Generator ends with t-b live
        } else {
          yield { type: 'assistant', content: 'All done! <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: 'sid-3' };
        }
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-bg-union-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-bg-union',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(3);
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const completedEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_completed' &&
          (c[0] as { step_name: string }).step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      const data = (completedEvent![0] as { data: Record<string, unknown> }).data;
      expect(data.background_tasks_incomplete).toEqual(['t-a', 't-b']);
      // Each incomplete iteration also warned the user
      const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(c =>
        String(c[1])
      );
      expect(sent.filter(m => m.includes('output may be missing')).length).toBe(2);
    });

    it('omits background_tasks_incomplete from node_completed when every iteration drains cleanly', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-1', taskType: 'local_agent', description: 'bg work' }],
        };
        yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'sid-clean' };
        yield { type: 'background_tasks', tasks: [] };
        yield { type: 'result', sessionId: 'sid-clean' };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-bg-clean-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-bg-clean',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do a task. When done, output <promise>COMPLETE</promise>.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const completedEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_completed' &&
          (c[0] as { step_name: string }).step_name === 'my-loop'
      );
      expect(completedEvent).toBeDefined();
      expect(
        (completedEvent![0] as { data: Record<string, unknown> }).data.background_tasks_incomplete
      ).toBeUndefined();
    });

    it('cancellation mid-stream aborts the iteration and suppresses the incompleteness warning', async () => {
      // Mirrors the AI-node cancellation-exemption test: the run is cancelled
      // while an iteration is streaming with a live background task. The new
      // mid-stream status check must abort the iteration (previously the loop
      // only noticed cancellation BETWEEN iterations), fail the node with the
      // observed status, and suppress the incompleteness warning.
      let tasksDelivered = false;
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 't-loop', taskType: 'local_agent', description: 'still running' }],
        };
        tasksDelivered = true;
        setSystemTime(new Date(Date.now() + 11_000));
        yield { type: 'assistant', content: 'working' };
        yield { type: 'assistant', content: 'MUST NOT BE REACHED' };
      });

      const store = createMockStore();
      // 'running' for the between-iteration check, 'cancelled' once the task
      // set has been delivered mid-stream.
      (store.getWorkflowRunStatus as Mock<() => Promise<string | null>>).mockImplementation(() =>
        Promise.resolve(tasksDelivered ? 'cancelled' : 'running')
      );
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('loop-bg-cancel-run');

      try {
        await executeDagWorkflow(
          mockDeps,
          platform,
          'conv-dag',
          testDir,
          {
            name: 'dag-loop-bg-cancel',
            nodes: [
              {
                id: 'my-loop',
                loop: {
                  prompt: 'Do tasks.',
                  until: 'COMPLETE',
                  max_iterations: 5,
                },
              },
            ],
          },
          workflowRun,
          'claude',
          undefined,
          join(testDir, 'artifacts'),
          join(testDir, 'state'),
          join(testDir, 'logs'),
          'main',
          'docs/',
          minimalConfig
        );
      } finally {
        setSystemTime(); // restore the real clock
      }

      // Aborted during iteration 1 — no second iteration
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // The loop never completed
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const completedEvent = eventCalls.find(
        (c: unknown[]) =>
          (c[0] as { event_type: string }).event_type === 'node_completed' &&
          (c[0] as { step_name: string }).step_name === 'my-loop'
      );
      expect(completedEvent).toBeUndefined();
      const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(c =>
        String(c[1])
      );
      // The stop is surfaced with the observed status…
      expect(sent.some(m => m.includes('stopped during iteration 1 (cancelled)'))).toBe(true);
      // …and the incompleteness warning is suppressed as noise
      expect(sent.some(m => m.includes('output may be missing'))).toBe(false);
    });

    it('completes after multiple iterations', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount < 3) {
          yield { type: 'assistant', content: `Iteration ${String(callCount)} progress` };
          yield { type: 'result', sessionId: `loop-session-${String(callCount)}` };
        } else {
          yield { type: 'assistant', content: 'All done! <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: `loop-session-${String(callCount)}` };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-multi',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do next task.',
                until: 'COMPLETE',
                max_iterations: 10,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(3);
    });

    it('substitutes $LOOP_PREV_OUTPUT with previous iteration output (empty on iter 1)', async () => {
      // Iteration 1 emits a distinctive output, iteration 2 emits the completion signal.
      // We then assert the prompt sent to the AI: iteration 1 strips $LOOP_PREV_OUTPUT
      // to empty, iteration 2 receives iteration 1's cleaned output.
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: 'assistant', content: 'Iter1 output: 2 type errors in users.ts' };
          yield { type: 'result', sessionId: 'loop-session-1' };
        } else {
          yield { type: 'assistant', content: 'All fixed. <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: 'loop-session-2' };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-prev-output',
          nodes: [
            {
              id: 'fix-loop',
              loop: {
                prompt: 'Previous output: <<$LOOP_PREV_OUTPUT>>. Fix and emit COMPLETE.',
                until: 'COMPLETE',
                max_iterations: 5,
                fresh_context: true,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      const promptIter1 = mockSendQueryDag.mock.calls[0][0] as string;
      const promptIter2 = mockSendQueryDag.mock.calls[1][0] as string;
      // Iteration 1: $LOOP_PREV_OUTPUT substitutes to empty string.
      expect(promptIter1).toContain('Previous output: <<>>.');
      // Iteration 2: receives iteration 1's cleaned output.
      expect(promptIter2).toContain(
        'Previous output: <<Iter1 output: 2 type errors in users.ts>>.'
      );
    });

    it('strips <promise> tags from $LOOP_PREV_OUTPUT (uses cleaned output)', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          // Iteration 1 includes a non-completion XML tag in its output. The cleaned
          // output (after stripCompletionTags) drops <promise>...</promise> blocks.
          // We use a non-matching signal here so iteration 1 does NOT complete.
          yield {
            type: 'assistant',
            content: 'Real work output. <promise>NOT_DONE_YET</promise>',
          };
          yield { type: 'result', sessionId: 'loop-session-1' };
        } else {
          yield { type: 'assistant', content: 'Done. <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: 'loop-session-2' };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-prev-clean',
          nodes: [
            {
              id: 'fix-loop',
              loop: {
                prompt: 'PREV=[$LOOP_PREV_OUTPUT]',
                until: 'COMPLETE',
                max_iterations: 5,
                fresh_context: true,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      const promptIter2 = mockSendQueryDag.mock.calls[1][0] as string;
      // The previous-output payload must be the *cleaned* output — no <promise> tags.
      expect(promptIter2).toContain('PREV=[Real work output.');
      expect(promptIter2).not.toContain('<promise>');
    });

    it('$LOOP_PREV_OUTPUT is empty on the first iteration after interactive resume', async () => {
      // Regression guard for the resume-from-approval path: when an interactive
      // loop pauses at the approval gate, the prior `lastIterationOutput` lives
      // in a separate process and is not persisted. On resume, the executor must
      // substitute $LOOP_PREV_OUTPUT to '' on the first resumed iteration —
      // never to whatever the paused run produced.
      //
      // Wirasm-suggested shape (PR #1367 review): two executeDagWorkflow calls.
      // The first call pauses at the gate after iteration 1; the second call
      // resumes with metadata.approval populated and runs iteration 2.

      // ---- Call 1: fresh run, iteration 1 emits no completion → pauses at gate
      mockSendQueryDag.mockImplementationOnce(function* () {
        yield { type: 'assistant', content: 'Iter1 output: 2 type errors in users.ts' };
        yield { type: 'result', sessionId: 'loop-session-1' };
      });
      const mockDeps1 = createMockDeps();
      const platform1 = createMockPlatform();
      const freshRun = makeWorkflowRun('resume-prev-fresh-run');

      await executeDagWorkflow(
        mockDeps1,
        platform1,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-resume-prev-output',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt:
                  'User: $LOOP_USER_INPUT. PREV=<<$LOOP_PREV_OUTPUT>>. Continue or emit COMPLETE.',
                until: 'COMPLETE',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review and provide feedback.',
              },
            },
          ],
        },
        freshRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // First iteration of a fresh interactive loop: $LOOP_PREV_OUTPUT empty;
      // $LOOP_USER_INPUT empty (no user has spoken yet).
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      const promptIter1 = mockSendQueryDag.mock.calls[0][0] as string;
      expect(promptIter1).toContain('PREV=<<>>.');
      expect(promptIter1).toContain('User: .');
      // Fresh interactive loop must pause at the gate, not return early.
      const pauseCalls1 = (
        mockDeps1.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls1.length).toBe(1);
      expect(pauseCalls1[0][1]).toMatchObject({
        type: 'interactive_loop',
        nodeId: 'refine',
        iteration: 1,
      });

      // ---- Call 2: resumed run — metadata carries iter 1 + user input.
      // iter 2 emits the completion signal so the loop exits cleanly.
      mockSendQueryDag.mockImplementationOnce(function* () {
        yield { type: 'assistant', content: 'All clear. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-session-2' };
      });
      const mockDeps2 = createMockDeps();
      const platform2 = createMockPlatform();
      const resumedRun = makeWorkflowRun('resume-prev-resume-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'loop-session-1',
            message: 'Review and provide feedback.',
          },
          loop_user_input: 'looks good, ship it',
        },
      });

      await executeDagWorkflow(
        mockDeps2,
        platform2,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-resume-prev-output',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt:
                  'User: $LOOP_USER_INPUT. PREV=<<$LOOP_PREV_OUTPUT>>. Continue or emit COMPLETE.',
                until: 'COMPLETE',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review and provide feedback.',
              },
            },
          ],
        },
        resumedRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Second executeDagWorkflow call started a fresh sendQuery generator (mock
      // call index 1 across the two runs). The resumed iteration must NOT carry
      // the prior process's iter-1 output through $LOOP_PREV_OUTPUT — it must
      // substitute to ''.
      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      const promptResumeIter = mockSendQueryDag.mock.calls[1][0] as string;
      expect(promptResumeIter).toContain('PREV=<<>>.');
      expect(promptResumeIter).not.toContain('Iter1 output: 2 type errors');
      // The resume's user input flows through on the first resumed iteration.
      expect(promptResumeIter).toContain('User: looks good, ship it.');
      // Resume call exits via completion, not via a second pause at the gate.
      const pauseCalls2 = (
        mockDeps2.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls2.length).toBe(0);
    });

    it('fails when max_iterations exceeded', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Still working...' };
        yield { type: 'result', sessionId: 'loop-session' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-max',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do task.',
                until: 'COMPLETE',
                max_iterations: 2,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have called sendQuery exactly 2 times (max_iterations)
      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      // Workflow should be marked failed (no completion signal)
      expect(
        (mockDeps.store.failWorkflowRun as Mock<(id: string, error: string) => Promise<void>>).mock
          .calls.length
      ).toBe(1);
    });

    it('completes on final iteration with XML-wrapped signal (<COMPLETE>SIGNAL</COMPLETE>)', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount < 3) {
          yield { type: 'assistant', content: `Iteration ${String(callCount)} progress` };
          yield { type: 'result', sessionId: `loop-session-${String(callCount)}` };
        } else {
          // Final iteration uses <COMPLETE> tag instead of <promise>
          yield { type: 'assistant', content: 'All clean! <COMPLETE>ALL_CLEAN</COMPLETE>' };
          yield { type: 'result', sessionId: `loop-session-${String(callCount)}` };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-xml-tag',
          nodes: [
            {
              id: 'fix-and-review',
              loop: {
                prompt: 'Fix and review. When done, output <COMPLETE>ALL_CLEAN</COMPLETE>.',
                until: 'ALL_CLEAN',
                max_iterations: 3,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // 3 iterations run, signal found on iteration 3 → completed, NOT failed
      expect(mockSendQueryDag.mock.calls.length).toBe(3);
      expect(
        (
          mockDeps.store.completeWorkflowRun as Mock<
            (id: string, metadata?: Record<string, unknown>) => Promise<void>
          >
        ).mock.calls.length
      ).toBe(1);
      expect(
        (mockDeps.store.failWorkflowRun as Mock<(id: string, error: string) => Promise<void>>).mock
          .calls.length
      ).toBe(0);
      // Verify stripping: raw XML completion tags must not appear in user-visible output
      const allSentMessages = (
        platform.sendMessage as Mock<(...args: unknown[]) => Promise<void>>
      ).mock.calls
        .map((call: unknown[]) => call[1] as string)
        .join('');
      expect(allSentMessages).not.toContain('<COMPLETE>');
      expect(allSentMessages).not.toContain('</COMPLETE>');
    });

    it('loop node output available to downstream nodes via $nodeId.output', async () => {
      let loopCallCount = 0;
      mockSendQueryDag.mockImplementation(function* (prompt: string) {
        if (prompt.includes('Do task')) {
          loopCallCount++;
          if (loopCallCount >= 2) {
            yield {
              type: 'assistant',
              content: 'Loop result: all tasks done <promise>COMPLETE</promise>',
            };
          } else {
            yield { type: 'assistant', content: 'Working on task 1' };
          }
          yield { type: 'result', sessionId: 'loop-sid' };
        } else {
          // downstream node
          yield { type: 'assistant', content: 'Got upstream: ' + prompt.slice(0, 50) };
          yield { type: 'result', sessionId: 'downstream-sid' };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-output',
          nodes: [
            {
              id: 'impl',
              loop: {
                prompt: 'Do task. Output <promise>COMPLETE</promise> when done.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
            {
              id: 'report',
              prompt: 'Summarize: $impl.output',
              depends_on: ['impl'],
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Loop ran 2 iterations + downstream ran once = 3 calls
      expect(mockSendQueryDag.mock.calls.length).toBe(3);
    });

    it('fresh_context: true gives each iteration fresh session', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount >= 2) {
          yield { type: 'assistant', content: '<promise>DONE</promise>' };
        } else {
          yield { type: 'assistant', content: 'Progress' };
        }
        yield { type: 'result', sessionId: `session-${String(callCount)}` };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-fresh',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do stuff.',
                until: 'DONE',
                max_iterations: 5,
                fresh_context: true,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Both calls should have undefined resumeSessionId (fresh context)
      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      // First call: fresh (iteration 1 always fresh)
      expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
      // Second call: also fresh (fresh_context: true)
      expect(mockSendQueryDag.mock.calls[1][2]).toBeUndefined();
    });

    it('fresh_context: false threads session between iterations', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount >= 2) {
          yield { type: 'assistant', content: '<promise>DONE</promise>' };
        } else {
          yield { type: 'assistant', content: 'Progress' };
        }
        yield { type: 'result', sessionId: `session-${String(callCount)}` };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-stateful',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do stuff.',
                until: 'DONE',
                max_iterations: 5,
                fresh_context: false,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      // First call: fresh (iteration 1 always fresh)
      expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
      // Second call: should have session-1 from first iteration
      expect(mockSendQueryDag.mock.calls[1][2]).toBe('session-1');
    });

    it('strips <promise> tags from platform output', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Done! <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sid' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-strip',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Task.',
                until: 'COMPLETE',
                max_iterations: 3,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // In batch mode, accumulated clean output is sent
      const sendCalls = (platform.sendMessage as Mock<() => Promise<void>>).mock.calls;
      const contentMessages = sendCalls
        .map((call: unknown[]) => call[1] as string)
        .filter((msg: string) => msg.includes('Done'));
      // Should have stripped <promise> tags
      for (const msg of contentMessages) {
        expect(msg).not.toContain('<promise>');
      }
    });

    it('cancellation between iterations stops the loop', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        yield { type: 'assistant', content: `Iteration ${String(callCount)}` };
        yield { type: 'result', sessionId: `sid-${String(callCount)}` };
      });

      const store = createMockStore();
      let statusCallCount = 0;
      (store.getWorkflowRunStatus as Mock<() => Promise<string | null>>).mockImplementation(() => {
        statusCallCount++;
        // Return 'cancelled' on second status check (before iteration 2)
        if (statusCallCount >= 2) return Promise.resolve('cancelled');
        return Promise.resolve('running');
      });
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-cancel',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do tasks.',
                until: 'COMPLETE',
                max_iterations: 10,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have only done 1 iteration (cancelled before iteration 2)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
    });

    it('AI error mid-iteration returns failed NodeOutput', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        throw new Error('Claude Code auth error: unauthorized');
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-ai-error',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do task.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have run exactly 1 iteration (failed on first)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // Workflow should be marked failed
      expect(
        (mockDeps.store.failWorkflowRun as Mock<(id: string, error: string) => Promise<void>>).mock
          .calls.length
      ).toBe(1);
    });

    it('detects plain completion signal (non-<promise> format)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'All tasks done!\nCOMPLETE' };
        yield { type: 'result', sessionId: 'plain-sid' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-plain-signal',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do task.',
                until: 'COMPLETE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should complete on first iteration (plain signal on own line)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      const completeCalls = (
        mockDeps.store.completeWorkflowRun as Mock<
          (id: string, metadata?: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(completeCalls.length).toBe(1);
      expect(completeCalls[0][1]).toEqual({
        node_counts: { completed: 1, failed: 0, skipped: 0, total: 1 },
      });
    });

    it('does NOT detect false positive plain signal in middle of text', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'The task is not COMPLETE yet, more work needed.' };
        yield { type: 'result', sessionId: 'false-pos-sid' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-loop-false-positive',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Work.',
                until: 'COMPLETE',
                max_iterations: 2,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have run max_iterations times (NOT detected as complete)
      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      // Should have FAILED (not completed)
      expect(
        (mockDeps.store.failWorkflowRun as Mock<(id: string, error: string) => Promise<void>>).mock
          .calls.length
      ).toBe(1);
    });

    // ─── Interactive Loop Tests ────────────────────────────────────────────

    it('interactive loop with gate_message pauses after first iteration', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Here is the plan. Please review.' };
        yield { type: 'result', sessionId: 'loop-session-1' };
      });

      const store = createMockStore();
      let pauseCommitted = false;
      let pauseCommittedAtApprovalRequest = false;
      store.pauseWorkflowRun = mock(async (): Promise<void> => {
        pauseCommitted = true;
      });
      store.createWorkflowEvent = mock(async event => {
        if (event.event_type === 'approval_requested') {
          pauseCommittedAtApprovalRequest = pauseCommitted;
        }
      });
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-test',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine the plan.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review the plan and provide feedback.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have called sendQuery exactly once (paused after iteration 1)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // Should have called pauseWorkflowRun with interactive_loop type
      const pauseCalls = (
        mockDeps.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls.length).toBe(1);
      expect(pauseCalls[0][1]).toMatchObject({
        type: 'interactive_loop',
        nodeId: 'refine',
        iteration: 1,
        // No signal this iteration — the engine-generated status line says so (#2074)
        // and the author's gate text is preserved at the end.
        completionSignaled: false,
        signaledOutput: null,
      });
      const pausedMessage = (pauseCalls[0][1] as { message: string }).message;
      expect(pausedMessage).toContain('No completion signal');
      expect(pausedMessage).toContain('Review the plan and provide feedback.');
      expect(pauseCommittedAtApprovalRequest).toBe(true);
      expect(store.createWorkflowEvent).toHaveBeenCalledWith({
        workflow_run_id: workflowRun.id,
        event_type: 'approval_requested',
        step_name: 'refine',
        data: {
          gateType: 'interactive_loop',
          nodeId: 'refine',
          message: pausedMessage,
          iteration: 1,
          completionSignaled: false,
        },
      });
    });

    it('interactive loop first iteration always gates even if AI emits signal', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'assistant',
          content: 'Plan approved. Proceeding. <promise>APPROVED</promise>',
        };
        yield { type: 'result', sessionId: 'loop-session-2', tokens: { input: 40, output: 4 } };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-signal',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review and provide feedback.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // On first iteration (fresh start, no user input), the loop MUST pause
      // at the gate even if the AI emits the completion signal. The user hasn't
      // seen anything yet — they must review before the loop can exit.
      const pauseCalls = (
        mockDeps.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls.length).toBe(1);
      expect(pauseCalls[0][1]).toMatchObject({
        type: 'interactive_loop',
        nodeId: 'refine',
        iteration: 1,
        // The gate persists the signal state (#2074) so a bare approve can
        // finalize at resume instead of re-running the iteration.
        completionSignaled: true,
        // ...and the usage consumed up to the gate (#2333), so the finalize path
        // does not report a silent zero for iterations that really ran.
        signaledTokens: { input: 40, output: 4 },
      });
      const signaledOutput = (pauseCalls[0][1] as { signaledOutput: string }).signaledOutput;
      expect(signaledOutput).toContain('Plan approved');
      const gateMessage = (pauseCalls[0][1] as { message: string }).message;
      expect(gateMessage).toContain('Completion signal detected');
      expect(gateMessage).toContain('Review and provide feedback.');
    });

    it('interactive loop exits on resume when AI emits completion signal (user approved)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'assistant',
          content: 'Plan approved. Proceeding. <promise>APPROVED</promise>',
        };
        yield { type: 'result', sessionId: 'loop-session-3' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      // Simulate a resumed run where the user said "approved"
      const workflowRun = makeWorkflowRun('resume-signal-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'loop-session-2',
            message: 'Review and provide feedback.',
          },
          loop_user_input: 'approved',
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-resume-signal',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review and provide feedback.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // On resume with user input, the AI processes the approval and emits the
      // completion signal. The loop exits immediately without pausing at the gate.
      const pauseCalls = (
        mockDeps.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls.length).toBe(0);
    });

    it('interactive loop resumes from stored iteration with user input', async () => {
      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        yield { type: 'assistant', content: 'Updated plan. <promise>APPROVED</promise>' };
        yield { type: 'result', sessionId: `resumed-session-${String(callCount)}` };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      // Simulate a resumed run: metadata has loop gate state and user input
      const workflowRun = makeWorkflowRun('resumed-run-id', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'loop-session-1',
            message: 'Review the plan.',
          },
          loop_user_input: 'Add error handling',
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'interactive-loop-resume',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine the plan.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review the plan.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should have called sendQuery once (starting from iteration 2, completed immediately)
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // Verify the prompt contains the user input
      const promptArg = mockSendQueryDag.mock.calls[0][0] as string;
      expect(promptArg).toContain('Add error handling');
      // Should have resumed with stored session ID
      const sessionArg = mockSendQueryDag.mock.calls[0][2] as string | undefined;
      expect(sessionArg).toBe('loop-session-1');
    });

    it('signal_completes: true completes the loop on a first-iteration signal without gating (#2074 B)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Validation PASS. <promise>VALIDATED</promise>' };
        yield { type: 'result', sessionId: 'sc-session-1' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('signal-completes-run');

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'signal-completes-test',
          nodes: [
            {
              id: 'validate',
              loop: {
                prompt: 'Validate. Emit VALIDATED on pass.',
                until: 'VALIDATED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review the validation result.',
                signal_completes: true,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // No gate: the node completed autonomously on the signal.
      const pauseCalls = (mockDeps.store.pauseWorkflowRun as Mock<() => Promise<void>>).mock.calls;
      expect(pauseCalls.length).toBe(0);
      const eventCalls = (
        mockDeps.store.createWorkflowEvent as Mock<
          (e: {
            event_type: string;
            step_name: string;
            data: Record<string, unknown>;
          }) => Promise<void>
        >
      ).mock.calls;
      const completed = eventCalls.filter(
        c => c[0].event_type === 'node_completed' && c[0].step_name === 'validate'
      );
      expect(completed.length).toBe(1);
      expect(String(completed[0][0].data.node_output)).toContain('Validation PASS');
    });

    it('finalizes at resume from persisted signaledOutput on a bare approve — no re-run (#2074 C)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'should never run' };
        yield { type: 'result', sessionId: 'never' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('finalize-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: true,
            signaledOutput: 'REPORT',
            signaledTokens: { input: 40, output: 4 },
          },
          loop_user_input: 'Approved',
          loop_feedback_given: false,
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'finalize-on-approve',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // No new iteration ran — the node finalized from the persisted output.
      expect(mockSendQueryDag.mock.calls.length).toBe(0);
      const eventCalls = (
        mockDeps.store.createWorkflowEvent as Mock<
          (e: {
            event_type: string;
            step_name: string;
            data: Record<string, unknown>;
          }) => Promise<void>
        >
      ).mock.calls;
      const completed = eventCalls.filter(
        c => c[0].event_type === 'node_completed' && c[0].step_name === 'refine'
      );
      expect(completed.length).toBe(1);
      expect(completed[0][0].data.node_output).toBe('REPORT');
      // The finalize row reports the usage the pausing invocation consumed (#2333).
      // Without this it persists duration_ms: 0 and no tokens for iterations that
      // really ran — a silent zero, not an absence.
      expect(completed[0][0].data.tokens).toEqual({ input: 40, output: 4 });
    });

    it('finalize omits tokens when the gate persisted none (legacy pause / no usage) (#2333)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'should never run' };
        yield { type: 'result', sessionId: 'never' };
      });

      const mockDeps = createMockDeps();
      const workflowRun = makeWorkflowRun('finalize-no-tokens-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: true,
            signaledOutput: 'REPORT',
            // No signaledTokens key at all — a run paused by a build predating #2333.
          },
          loop_user_input: 'Approved',
          loop_feedback_given: false,
        },
      });

      await executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'finalize-on-approve',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(0);
      const eventCalls = (
        mockDeps.store.createWorkflowEvent as Mock<
          (e: {
            event_type: string;
            step_name: string;
            data: Record<string, unknown>;
          }) => Promise<void>
        >
      ).mock.calls;
      const completed = eventCalls.filter(
        c => c[0].event_type === 'node_completed' && c[0].step_name === 'refine'
      );
      expect(completed.length).toBe(1);
      expect(completed[0][0].data).not.toHaveProperty('tokens');
    });

    it('warns and omits malformed persisted gate token usage on bare approval', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'should never run' };
        yield { type: 'result', sessionId: 'never' };
      });

      const mockDeps = createMockDeps();
      const workflowRun = makeWorkflowRun('finalize-invalid-tokens-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: true,
            signaledOutput: 'REPORT',
            signaledTokens: { input: Number.NaN, output: 4 },
          },
          loop_user_input: 'Approved',
          loop_feedback_given: false,
        },
      });

      await executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'finalize-invalid-tokens',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const warnCalls = mockLogFn.mock.calls.filter(
        (call: unknown[]) => call[1] === 'dag_loop.signaled_tokens_invalid_ignored'
      );
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]?.[0]).toEqual(
        expect.objectContaining({ workflowRunId: workflowRun.id, nodeId: 'refine' })
      );
      const completed = (mockDeps.store.createWorkflowEvent as Mock).mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { event_type: string }).event_type === 'node_completed' &&
          (call[0] as { step_name: string }).step_name === 'refine'
      );
      expect((completed?.[0] as { data: Record<string, unknown> }).data).not.toHaveProperty(
        'tokens'
      );
    });

    it('iterates at resume when feedback was given, even on a signal-bearing gate (#2074 C)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Re-checked X. <promise>APPROVED</promise>' };
        yield { type: 'result', sessionId: 'iter-session-2' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('feedback-iterates-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: true,
            signaledOutput: 'REPORT',
          },
          loop_user_input: 'actually re-check X',
          loop_feedback_given: true,
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'feedback-iterates',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Feedback ⇒ a fresh iteration ran with $LOOP_USER_INPUT substituted.
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      const promptArg = mockSendQueryDag.mock.calls[0][0] as string;
      expect(promptArg).toContain('actually re-check X');
    });

    it('iterates at resume on a non-signaled gate even without feedback (#2074 C)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Another pass. <promise>APPROVED</promise>' };
        yield { type: 'result', sessionId: 'iter-session-3' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('nonsignaled-iterates-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: false,
            signaledOutput: null,
          },
          loop_user_input: 'Approved',
          loop_feedback_given: false,
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'nonsignaled-iterates',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Nothing to finalize — a normal resumed iteration ran.
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
    });

    it('LEGACY: resume with pre-#2074 approval metadata (no completionSignaled/signaledOutput keys) iterates', async () => {
      // Rows paused before #2074 have neither key in metadata.approval and no
      // loop_feedback_given — the finalize path must NOT trigger; the loop runs
      // a normal resumed iteration exactly as before.
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Legacy pass. <promise>APPROVED</promise>' };
        yield { type: 'result', sessionId: 'legacy-session-2' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('legacy-resume-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'legacy-session-1',
            message: 'Review and provide feedback.',
          },
          loop_user_input: 'approved',
        },
      });

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'legacy-loop-resume',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review and provide feedback.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // A real iteration ran (no zero-duration finalize short-circuit).
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      const promptArg = mockSendQueryDag.mock.calls[0][0] as string;
      expect(promptArg).toContain('approved');
    });

    it('loop iteration fails loudly when SDK returns error_during_execution', async () => {
      // Regression test for #1208: previously the loop silently broke on isError
      // results and kept iterating with empty output, producing "5-second crashes"
      // that masqueraded as successful iterations.
      mockSendQueryDag.mockImplementation(function* () {
        yield {
          type: 'result',
          isError: true,
          errorSubtype: 'error_during_execution',
          errors: ['Subprocess crashed mid-turn'],
          sessionId: 'bad-session',
        };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-iteration-err',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'Do the work. Say DONE.',
                until: 'DONE',
                max_iterations: 5,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Should fail after one iteration rather than burning through max_iterations
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      // The loop_iteration_failed event should carry the subtype and SDK errors detail
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const iterFailedEvents = eventCalls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'loop_iteration_failed'
      );
      expect(iterFailedEvents.length).toBeGreaterThan(0);
      const failedData = (iterFailedEvents[0][0] as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      expect(failedData.error).toContain('error_during_execution');
      expect(failedData.error).toContain('Subprocess crashed mid-turn');
    });

    it('loop iteration does NOT fail on isError: true + errorSubtype: success', async () => {
      // Regression test for #1425 (loop-branch counterpart of the main-path
      // test). Stop_sequence terminations carry is_error: true + subtype:
      // 'success' under the Claude SDK contract; previously, the loop branch
      // threw "SDK returned success" and aborted the iteration even though
      // the AI had completed its work correctly.
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Done. DONE.' };
        yield {
          type: 'result',
          isError: true,
          errorSubtype: 'success',
          stopReason: 'stop_sequence',
          sessionId: 'sid-loop-stop',
        };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-success-stop-seq-test',
          nodes: [
            {
              id: 'work',
              loop: {
                prompt: 'Do the work. Say DONE.',
                until: 'DONE',
                max_iterations: 3,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failedEvents = eventCalls.filter((call: unknown[]) => {
        const evt = (call[0] as Record<string, unknown>).event_type as string;
        return evt === 'node_failed' || evt === 'loop_iteration_failed';
      });
      expect(failedEvents).toHaveLength(0);
    });

    it('non-interactive loop is unaffected (no pause)', async () => {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'Still working...' };
        yield { type: 'result', sessionId: 'loop-session' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'non-interactive-loop',
          nodes: [
            {
              id: 'my-loop',
              loop: {
                prompt: 'Do task.',
                until: 'COMPLETE',
                max_iterations: 2,
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // pauseWorkflowRun should never be called for non-interactive loops
      const pauseCalls = (
        mockDeps.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls.length).toBe(0);
    });

    // ─── loop.command (command-file-backed loop nodes) ──────────────────────
    //
    // Hidden mechanics these tests pin down:
    //   • The command file is read ONCE per run/node — loaded at node start,
    //     reused for every iteration, and persisted across an interactive gate
    //     pause (`commandSnapshot`) so a file edited or deleted while paused
    //     cannot change the running loop's prompt.
    //   • A missing / empty / unsafe `loop.command` fails the node *before*
    //     any iteration runs — no `sendQuery` call, one `node_failed` event
    //     with an actionable error. The schema's superRefine catches unsafe
    //     names at parse, but a hand-constructed workflow can bypass parse;
    //     these tests exercise the executor's defense-in-depth branch.
    //   • Loop variable substitution (`$LOOP_PREV_OUTPUT`, `$LOOP_USER_INPUT`,
    //     and the standard workflow vars) applies to the loaded command-file
    //     text identically to inline `loop.prompt` text.

    it('reads loop.command file once at node start, not per iteration', async () => {
      // Regression guard for the "load once, reuse" invariant. We write a
      // command file, run iteration 1, delete the file synchronously inside
      // the mock generator, and confirm iteration 2 still runs successfully.
      // If the executor re-read the file per iteration, the load would fail
      // on iteration 2 and surface as `node_failed` / `loop_iteration_failed`.
      const cmdPath = join(testDir, '.archon', 'commands', 'read-once-loop.md');
      await writeFile(cmdPath, 'Command-loaded loop body. iter prev=<<$LOOP_PREV_OUTPUT>>');

      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          // Delete the source file *during* iteration 1 so it is gone by the
          // time iteration 2 begins. Synchronous unlink ensures the file is
          // removed before the next `for await` yield resumes the loop body.
          unlinkSync(cmdPath);
          yield { type: 'assistant', content: 'iter1 work output' };
          yield { type: 'result', sessionId: 'sid-once-1' };
        } else {
          yield { type: 'assistant', content: 'iter2 done. <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: 'sid-once-2' };
        }
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-read-once',
          nodes: [
            {
              id: 'read-once-loop',
              loop: {
                command: 'read-once-loop',
                until: 'COMPLETE',
                max_iterations: 5,
                fresh_context: true,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Both iterations ran — the mid-run deletion did not break iteration 2.
      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      // No failure events of any kind.
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failedEvents = eventCalls.filter((call: unknown[]) => {
        const evt = (call[0] as Record<string, unknown>).event_type as string;
        return evt === 'node_failed' || evt === 'loop_iteration_failed';
      });
      expect(failedEvents).toHaveLength(0);
      // Both iterations received the *same* file body as their prompt template
      // — proving the file contents were loaded once and reused, not re-read.
      expect(mockSendQueryDag.mock.calls[0][0] as string).toContain('Command-loaded loop body.');
      expect(mockSendQueryDag.mock.calls[1][0] as string).toContain('Command-loaded loop body.');
      // node_started carries the command name so the event stream identifies
      // command-backed loops without reading the workflow YAML.
      const started = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_started' &&
          (call[0] as Record<string, unknown>).step_name === 'read-once-loop'
      );
      expect(started).toBeDefined();
      const startedData = (started![0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(startedData.command).toBe('read-once-loop');
    });

    it('fails fast with node_failed when loop.command names a missing file', async () => {
      // Schema rejection at parse only fires when the workflow is parsed via
      // the loader; a hand-constructed workflow bypasses that. The runtime
      // guard inside `executeLoopNode` must catch the missing command and
      // fail the node before iteration 1 runs.
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-missing',
          nodes: [
            {
              id: 'missing-loop',
              loop: {
                command: 'does-not-exist-anywhere',
                until: 'COMPLETE',
                max_iterations: 3,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // sendQuery must never have been invoked — load failed pre-iteration.
      expect(mockSendQueryDag.mock.calls.length).toBe(0);
      // `node_failed` event was emitted with the actionable message.
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failed = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_failed' &&
          (call[0] as Record<string, unknown>).step_name === 'missing-loop'
      );
      expect(failed).toBeDefined();
      const data = (failed![0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(String(data.error)).toContain('not found');
      // The failing command name must travel with the event so consumers of the
      // event stream see the same context as the structured log.
      expect(data.command).toBe('does-not-exist-anywhere');

      // node_started must be paired with node_failed even when the failure is
      // pre-iteration — same lifecycle contract as bash and script nodes.
      const started = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_started' &&
          (call[0] as Record<string, unknown>).step_name === 'missing-loop'
      );
      expect(started).toBeDefined();
    });

    it('fails fast with node_failed when loop.command target file is empty', async () => {
      // An empty command file is a load-time failure in `loadCommandPrompt`
      // (same as for `command:` nodes). The loop must fail with the empty-file
      // diagnostic before iteration 1.
      await writeFile(join(testDir, '.archon', 'commands', 'empty-loop.md'), '');

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-empty',
          nodes: [
            {
              id: 'empty-loop',
              loop: {
                command: 'empty-loop',
                until: 'COMPLETE',
                max_iterations: 3,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(0);
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failed = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_failed' &&
          (call[0] as Record<string, unknown>).step_name === 'empty-loop'
      );
      expect(failed).toBeDefined();
      const data = (failed![0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(String(data.error)).toContain('empty');
      expect(data.command).toBe('empty-loop');
    });

    it('fails fast with node_failed when loop.command is an unsafe name', async () => {
      // The loop schema's superRefine rejects `'../escape'` at parse, but a
      // programmatically-constructed workflow bypasses parse. The executor
      // branch must still flag this via `isValidCommandName` inside
      // `loadCommandPrompt` rather than attempting any file resolution.
      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-unsafe',
          nodes: [
            {
              id: 'unsafe-loop',
              loop: {
                command: '../escape',
                until: 'COMPLETE',
                max_iterations: 3,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(0);
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const failed = eventCalls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_failed' &&
          (call[0] as Record<string, unknown>).step_name === 'unsafe-loop'
      );
      expect(failed).toBeDefined();
      const data = (failed![0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(String(data.error)).toContain('Invalid command name');
      expect(data.command).toBe('../escape');
    });

    it('applies $LOOP_PREV_OUTPUT and $LOOP_USER_INPUT substitution to command-loaded text', async () => {
      // Loop variable substitution applies to command-loaded prompt text
      // identically to inline prompt text: both `$LOOP_PREV_OUTPUT` and
      // `$LOOP_USER_INPUT` are embedded in the command file body, and the
      // prompt actually sent to the AI must substitute them the same way the
      // inline-prompt tests verify for `loop.prompt`. The body itself must
      // appear in the sent prompt — proof the file contents (not the YAML
      // node body) flow through `substituteWorkflowVariables`.
      await writeFile(
        join(testDir, '.archon', 'commands', 'subst-loop.md'),
        'Cmd-file body. PREV=<<$LOOP_PREV_OUTPUT>> USER=<<$LOOP_USER_INPUT>>'
      );

      let callCount = 0;
      mockSendQueryDag.mockImplementation(function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: 'assistant', content: 'iter1 result text' };
          yield { type: 'result', sessionId: 'sid-subst-1' };
        } else {
          yield { type: 'assistant', content: 'done. <promise>COMPLETE</promise>' };
          yield { type: 'result', sessionId: 'sid-subst-2' };
        }
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-subst',
          nodes: [
            {
              id: 'subst-loop',
              loop: {
                command: 'subst-loop',
                until: 'COMPLETE',
                max_iterations: 5,
                fresh_context: true,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      const promptIter1 = mockSendQueryDag.mock.calls[0][0] as string;
      const promptIter2 = mockSendQueryDag.mock.calls[1][0] as string;
      // The file body is what reached the AI — not the YAML inline-prompt path.
      expect(promptIter1).toContain('Cmd-file body.');
      expect(promptIter2).toContain('Cmd-file body.');
      // Iteration 1: PREV substitutes to empty (no prior output); USER empty
      // (non-interactive, no resume metadata).
      expect(promptIter1).toContain('PREV=<<>>');
      expect(promptIter1).toContain('USER=<<>>');
      // Iteration 2: PREV carries iteration 1's cleaned output, USER stays
      // empty (still non-interactive).
      expect(promptIter2).toContain('PREV=<<iter1 result text>>');
      expect(promptIter2).toContain('USER=<<>>');
    });

    it('reuses the pause-time command snapshot on approval resume — file mutated and deleted while paused', async () => {
      // Two-invocation contract: invocation 1 loads the command file and pauses
      // at the interactive gate, persisting the loaded body (`commandSnapshot`)
      // in the pause context. While the run sits paused, the file is rewritten
      // AND then deleted. Invocation 2 (the approval resume) must run the next
      // iteration from the SNAPSHOT — never from the mutated file, and without
      // failing on the missing file.
      const cmdPath = join(testDir, '.archon', 'commands', 'gated-loop.md');
      await writeFile(cmdPath, 'ORIGINAL gated body. USER=<<$LOOP_USER_INPUT>>');

      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'iteration output, no signal yet' };
        yield { type: 'result', sessionId: 'sid-gated-1' };
      });

      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      const gatedWorkflow = {
        name: 'loop-cmd-gated',
        nodes: [
          {
            id: 'gated-loop',
            loop: {
              command: 'gated-loop',
              until: 'COMPLETE',
              max_iterations: 5,
              interactive: true,
              gate_message: 'Review this iteration.',
            },
          } as unknown as DagNode,
        ],
      };

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        gatedWorkflow,
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // Invocation 1 paused at the gate and persisted the loaded body.
      const pauseCalls = (
        mockDeps.store.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls;
      expect(pauseCalls.length).toBe(1);
      const pausedContext = pauseCalls[0][1] as Record<string, unknown>;
      expect(pausedContext.commandSnapshot).toContain('ORIGINAL gated body.');
      expect(mockSendQueryDag.mock.calls[0][0] as string).toContain('ORIGINAL gated body.');

      // While paused: the file is rewritten, then deleted entirely.
      await writeFile(cmdPath, 'TAMPERED body that must never run');
      unlinkSync(cmdPath);

      // Invocation 2: approval resume with feedback (feedback forces a real
      // resumed iteration rather than a bare-approve finalize).
      mockSendQueryDag.mockClear();
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'refined. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'sid-gated-2' };
      });
      const resumedRun = makeWorkflowRun('gated-resume-run', {
        metadata: {
          approval: { ...pausedContext },
          loop_user_input: 'tighten the summary',
          loop_feedback_given: true,
        },
      });
      const store2 = createMockStore();
      const mockDeps2 = createMockDeps(store2);

      await executeDagWorkflow(
        mockDeps2,
        platform,
        'conv-dag',
        testDir,
        gatedWorkflow,
        resumedRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      // The resumed iteration ran from the snapshot: original body, user
      // feedback substituted, no trace of the tampered content, no failure
      // from the deleted file.
      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      const resumedPrompt = mockSendQueryDag.mock.calls[0][0] as string;
      expect(resumedPrompt).toContain('ORIGINAL gated body.');
      expect(resumedPrompt).toContain('USER=<<tighten the summary>>');
      expect(resumedPrompt).not.toContain('TAMPERED');
      const failed = (store2.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.filter(
        (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
      );
      expect(failed).toHaveLength(0);
    });

    it('closes the loop lifecycle with exactly one node_failed on max-iterations exhaustion', async () => {
      // Failure finalizer contract: every failed exit after node_started goes
      // through one finalizer — exactly one node_failed row per started loop
      // node, paired with its node_started.
      await writeFile(
        join(testDir, '.archon', 'commands', 'exhaust-loop.md'),
        'Body that never signals completion'
      );

      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'still going, no signal' };
        yield { type: 'result', sessionId: 'sid-exhaust' };
      });

      const store = createMockStore();
      const mockDeps = createMockDeps(store);
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun();

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-cmd-exhaust',
          nodes: [
            {
              id: 'exhaust-loop',
              loop: {
                command: 'exhaust-loop',
                until: 'COMPLETE',
                max_iterations: 2,
                fresh_context: true,
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
      const started = eventCalls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_started' &&
          (call[0] as Record<string, unknown>).step_name === 'exhaust-loop'
      );
      const failed = eventCalls.filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).event_type === 'node_failed' &&
          (call[0] as Record<string, unknown>).step_name === 'exhaust-loop'
      );
      expect(started).toHaveLength(1);
      expect(failed).toHaveLength(1);
      const data = (failed[0][0] as Record<string, unknown>).data as Record<string, unknown>;
      expect(String(data.error)).toContain('exceeded max iterations');
    });
  });
});

describe('executeDagWorkflow -- always_run resume opt-out', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-always-run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'producer.md'), 'Producer prompt');
    await writeFile(join(commandsDir, 'consumer.md'), 'Consumer prompt $producer.output');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'fresh output' };
      yield { type: 'result', sessionId: 'session-id' };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('re-runs node flagged always_run even when present in priorCompletedNodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const priorCompletedNodes = new Map([['producer', 'cached stale output']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-always-run',
      testDir,
      {
        name: 'always-run-producer',
        nodes: [
          { id: 'producer', command: 'producer', always_run: true },
          { id: 'consumer', command: 'consumer', depends_on: ['producer'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // Producer re-runs (instead of being skipped) AND consumer runs => 2 sendQuery calls
    expect(mockSendQueryDag.mock.calls.length).toBe(2);

    // No skip event written for the always_run node — but a reset event IS written for audit
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const skippedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_skipped_prior_success' &&
        (call[0] as { step_name: string }).step_name === 'producer'
    );
    expect(skippedEvent).toBeUndefined();

    const resetEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_always_run_reset' &&
        (call[0] as { step_name: string }).step_name === 'producer'
    );
    expect(resetEvent).toBeDefined();
    expect((resetEvent![0] as { data: { prior_output: string } }).data.prior_output).toBe(
      'cached stale output'
    );
  });

  it('still skips non-always_run nodes in the same priorCompletedNodes set', async () => {
    await writeFile(join(testDir, '.archon', 'commands', 'cached.md'), 'Cached prompt');
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const priorCompletedNodes = new Map([
      ['producer', 'cached stale output'],
      ['cached', 'cached output'],
    ]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-mixed',
      testDir,
      {
        name: 'mixed',
        nodes: [
          { id: 'producer', command: 'producer', always_run: true },
          { id: 'cached', command: 'cached' },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // Only producer re-runs; cached node stays skipped
    expect(mockSendQueryDag.mock.calls.length).toBe(1);

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const cachedSkipped = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_skipped_prior_success' &&
        (call[0] as { step_name: string }).step_name === 'cached'
    );
    expect(cachedSkipped).toBeDefined();
  });

  it('downstream consumer reads fresh producer output (not the pre-populated cached value)', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const seenPrompts: string[] = [];
    let queryCount = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      seenPrompts.push(prompt);
      queryCount++;
      // First call is the always_run producer; subsequent calls are consumers
      yield {
        type: 'assistant',
        content: queryCount === 1 ? 'fresh producer output' : 'consumer result',
      };
      yield { type: 'result', sessionId: 'session-id' };
    });

    const priorCompletedNodes = new Map([['producer', 'STALE_CACHED_VALUE']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-fresh-output',
      testDir,
      {
        name: 'always-run-fresh',
        nodes: [
          { id: 'producer', command: 'producer', always_run: true },
          { id: 'consumer', prompt: 'See: $producer.output', depends_on: ['producer'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // Consumer's prompt should contain the fresh producer output, not the stale cached value
    const consumerPrompt = seenPrompts[1];
    expect(consumerPrompt).toContain('fresh producer output');
    expect(consumerPrompt).not.toContain('STALE_CACHED_VALUE');
  });

  it('preserves always_run nodes during retry when they are outside the invalidated set', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    let capturedPrompt = '';
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      capturedPrompt = prompt;
      yield { type: 'assistant', content: 'consumer result' };
      yield { type: 'result', sessionId: 'session-id' };
    });

    const priorCompletedNodes = new Map([['producer', 'preserved retry output']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-retry-always-run',
      testDir,
      {
        name: 'retry-always-run-preserve',
        nodes: [
          { id: 'producer', command: 'producer', always_run: true },
          { id: 'consumer', prompt: 'See: $producer.output', depends_on: ['producer'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes,
      undefined,
      undefined,
      undefined,
      { targetNodeId: 'consumer', retryEpoch: 1, invalidatedNodeIds: ['consumer'] }
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(capturedPrompt).toContain('preserved retry output');

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const resetEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_always_run_reset' &&
        (call[0] as { step_name: string }).step_name === 'producer'
    );
    expect(resetEvent).toBeUndefined();
  });
});

describe('executeDagWorkflow -- static DAG execution without route_loop', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-static-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      sendOptions?: SendQueryOptions
    ) {
      const nodeId = sendOptions?.nodeConfig?.nodeId;
      if (typeof nodeId !== 'string') {
        throw new Error('missing static DAG node id');
      }
      yield { type: 'assistant' as const, content: `${nodeId} output` };
      yield { type: 'result' as const, sessionId: `${nodeId}-session` };
    });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('uses static topological execution for workflows without route_loop and records no route decisions', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('static-dag-run');
    const observedCalls: { nodeId: string; prompt: string }[] = [];

    mockSendQueryDag.mockImplementation(function* (
      prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      sendOptions?: SendQueryOptions
    ) {
      const nodeId = sendOptions?.nodeConfig?.nodeId;
      if (typeof nodeId !== 'string') {
        throw new Error('missing static DAG node id');
      }
      observedCalls.push({ nodeId, prompt });
      yield { type: 'assistant' as const, content: `${nodeId} output` };
      yield { type: 'result' as const, sessionId: `${nodeId}-session` };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-static',
      testDir,
      {
        name: 'static-fan-in',
        mutates_checkout: false,
        nodes: [
          { id: 'source', prompt: 'Create source output.' },
          { id: 'left', prompt: 'Use $source.output on the left.', depends_on: ['source'] },
          { id: 'right', prompt: 'Use $source.output on the right.', depends_on: ['source'] },
          {
            id: 'join',
            prompt: 'Join $left.output with $right.output.',
            depends_on: ['left', 'right'],
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(observedCalls.map(call => call.nodeId).at(0)).toBe('source');
    expect(
      observedCalls
        .map(call => call.nodeId)
        .slice(1, 3)
        .sort()
    ).toEqual(['left', 'right']);
    expect(observedCalls.map(call => call.nodeId).at(3)).toBe('join');

    const leftCall = observedCalls.find(call => call.nodeId === 'left');
    const rightCall = observedCalls.find(call => call.nodeId === 'right');
    const joinCall = observedCalls.find(call => call.nodeId === 'join');
    expect(leftCall?.prompt).toContain('source output');
    expect(rightCall?.prompt).toContain('source output');
    expect(joinCall?.prompt).toContain('left output');
    expect(joinCall?.prompt).toContain('right output');
    expect(store.persistRouteDecisionTransition).not.toHaveBeenCalled();
    expect(
      (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.some(
        (call: unknown[]) => (call[0] as { event_type: string }).event_type === 'node_routed'
      )
    ).toBe(false);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('keeps static resume semantics for workflows without route_loop', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('static-resume-run');
    let consumerPrompt = '';

    mockSendQueryDag.mockImplementation(function* (
      prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      sendOptions?: SendQueryOptions
    ) {
      const nodeId = sendOptions?.nodeConfig?.nodeId;
      if (nodeId === 'consumer') {
        consumerPrompt = prompt;
      }
      yield { type: 'assistant' as const, content: `${String(nodeId)} output` };
      yield { type: 'result' as const, sessionId: `${String(nodeId)}-session` };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-static-resume',
      testDir,
      {
        name: 'static-resume',
        mutates_checkout: false,
        nodes: [
          { id: 'producer', prompt: 'Produce output.' },
          { id: 'consumer', prompt: 'Consume $producer.output.', depends_on: ['producer'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([['producer', 'cached static output']])
    );

    expect(mockSendQueryDag).toHaveBeenCalledTimes(1);
    expect(consumerPrompt).toContain('cached static output');
    expect(store.persistRouteDecisionTransition).not.toHaveBeenCalled();

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const skippedPriorSuccessEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_skipped_prior_success' &&
        (call[0] as { step_name: string }).step_name === 'producer'
    );
    expect(skippedPriorSuccessEvent).toBeDefined();
    expect(
      (skippedPriorSuccessEvent![0] as { data: { node_output: string } }).data.node_output
    ).toBe('cached static output');
    expect(
      eventCalls.some(
        (call: unknown[]) => (call[0] as { event_type: string }).event_type === 'node_routed'
      )
    ).toBe(false);
  });
});

describe('executeDagWorkflow -- route_loop end-to-end TDD', () => {
  let testDir: string;
  type ReviewResult = 'negative' | 'positive';
  type RouteLoopEventCall = {
    event_type: string;
    step_name?: string;
    data?: Record<string, unknown>;
  };
  type RouteLoopRunResult = {
    store: IWorkflowStore;
    calls: { nodeId: string; prompt: string }[];
    routedEvents: RouteLoopEventCall[];
    routeDecisionCalls: Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0][];
  };

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-route-loop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function runRouteLoopWorkflow(options: {
    reviewResults: ReviewResult[];
    maxIterations?: number;
    includeUnrelatedFixDependent?: boolean;
    includeExternalPrerequisites?: boolean;
    routeTargetsAreRoots?: boolean;
    includeDoneDependent?: boolean;
    persistRouteDecisionTransition?: IWorkflowStore['persistRouteDecisionTransition'];
  }): Promise<RouteLoopRunResult> {
    const store = createMockStore();
    if (options.persistRouteDecisionTransition) {
      store.persistRouteDecisionTransition = mock(options.persistRouteDecisionTransition);
    }
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-run');
    const calls: { nodeId: string; prompt: string }[] = [];
    let reviewAttempt = 0;

    const routeLoopSendQuery = mock(function* (
      prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      sendOptions?: SendQueryOptions
    ) {
      const nodeId = sendOptions?.nodeConfig?.nodeId;
      if (typeof nodeId !== 'string') {
        throw new Error('missing node id in route-loop TDD provider');
      }
      calls.push({ nodeId, prompt });

      if (nodeId === 'review') {
        reviewAttempt++;
        const result =
          options.reviewResults[reviewAttempt - 1] ??
          options.reviewResults[options.reviewResults.length - 1] ??
          'positive';
        yield { type: 'assistant' as const, content: JSON.stringify({ result }) };
        yield {
          type: 'result' as const,
          sessionId: `review-${String(reviewAttempt)}`,
          structuredOutput: { result },
        };
        return;
      }

      yield { type: 'assistant' as const, content: `${nodeId} complete` };
      yield { type: 'result' as const, sessionId: `${nodeId}-session` };
    });

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: routeLoopSendQuery,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    const workflow = {
      name: 'route-loop-e2e',
      nodes: [
        ...(options.includeExternalPrerequisites
          ? [
              { id: 'prepare', prompt: 'Prepare stable state.' },
              { id: 'config', prompt: 'Load review config.', depends_on: ['prepare'] },
            ]
          : []),
        {
          id: 'fix',
          prompt: 'Fix the story.',
          ...(options.includeExternalPrerequisites ? { depends_on: ['prepare'] } : {}),
        },
        {
          id: 'review',
          prompt: 'Review the latest fix.',
          depends_on: options.includeExternalPrerequisites ? ['fix', 'config'] : ['fix'],
          output_format: {
            type: 'object',
            properties: {
              result: { type: 'string', enum: ['positive', 'negative'] },
            },
            required: ['result'],
          },
        },
        ...(options.includeUnrelatedFixDependent
          ? [{ id: 'audit', prompt: 'Audit unrelated fix output.', depends_on: ['fix'] }]
          : []),
        {
          id: 'review-router',
          depends_on: ['review'],
          route_loop: {
            condition: "$review.output.result == 'positive'",
            max_iterations: options.maxIterations ?? 10,
            routes: {
              positive: 'done',
              negative: 'fix',
              exhausted: 'escalation',
            },
          },
        },
        {
          id: 'done',
          prompt: 'Summarize success.',
          ...(options.routeTargetsAreRoots ? {} : { depends_on: ['review-router'] }),
        },
        ...(options.includeDoneDependent
          ? [{ id: 'publish', prompt: 'Publish success.', depends_on: ['done'] }]
          : []),
        {
          id: 'escalation',
          prompt: 'Escalate failure.',
          ...(options.routeTargetsAreRoots ? {} : { depends_on: ['review-router'] }),
        },
      ],
    } as unknown as Parameters<typeof executeDagWorkflow>[4];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop',
      testDir,
      workflow,
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const routeDecisionCalls = (
      store.persistRouteDecisionTransition as ReturnType<typeof mock>
    ).mock.calls.map(
      call => call[0] as Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0]
    );
    const routedEvents = routeDecisionCalls.map(
      call =>
        ({
          event_type: 'node_routed',
          step_name: call.event.step_name,
          data: call.event.data,
        }) satisfies RouteLoopEventCall
    );

    return {
      store,
      calls,
      routedEvents,
      routeDecisionCalls,
    };
  }

  it('reruns a negative route path until the route_loop condition passes', async () => {
    const { store, calls, routedEvents, routeDecisionCalls } = await runRouteLoopWorkflow({
      reviewResults: ['negative', 'positive'],
    });

    expect(calls.map(call => call.nodeId)).toEqual(['fix', 'review', 'fix', 'review', 'done']);
    expect(calls.some(call => call.nodeId === 'escalation')).toBe(false);

    expect(routedEvents.map(event => event.data?.outcome)).toEqual(['negative', 'positive']);
    expect(routedEvents[0]?.data).toMatchObject({
      sources: ['review'],
      to: 'fix',
      condition: "$review.output.result == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 10,
      attempt: 1,
      execution_seq: 1,
    });
    expect(routedEvents[1]?.data).toMatchObject({
      sources: ['review'],
      to: 'done',
      condition: "$review.output.result == '<redacted>'",
      condition_result: true,
      negative_count: 1,
      max_iterations: 10,
      attempt: 2,
      execution_seq: 2,
    });
    expect(routeDecisionCalls.map(call => call.expected_execution_seq)).toEqual([0, 1]);
    expect(routeDecisionCalls[1]?.workflow_run_id).toBe('route-loop-run');
    expect(routeDecisionCalls[1]?.metadata).toEqual(
      expect.objectContaining({
        loopCounters: { 'review-router': 0 },
        nodeAttempts: { 'review-router': 2 },
        executionSeq: 2,
        routeActivations: expect.objectContaining({
          fix: expect.objectContaining({
            route_loop_node_id: 'review-router',
            outcome: 'negative',
            target_node_id: 'fix',
            attempt: 1,
            execution_seq: 1,
          }),
          done: expect.objectContaining({
            route_loop_node_id: 'review-router',
            outcome: 'positive',
            target_node_id: 'done',
            attempt: 2,
            execution_seq: 2,
          }),
        }),
      })
    );
    expect(store.persistRouteDecisionTransition).toHaveBeenCalledTimes(2);
    expect(store.updateWorkflowRun).not.toHaveBeenCalledWith('route-loop-run', expect.anything());
    expect(
      (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.some(
        call => (call[0] as RouteLoopEventCall).event_type === 'node_routed'
      )
    ).toBe(false);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('skips a bootstrap approval when its known route source has not run yet', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const workflowRun = makeWorkflowRun('route-loop-bootstrap-approval-run');
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') throw new Error('missing node id');
        calls.push(nodeId);
        if (nodeId === 'converge') {
          yield { type: 'assistant' as const, content: '{"gate":"FAIL","tasks_added":1}' };
          yield {
            type: 'result' as const,
            sessionId: 'converge-session',
            structuredOutput: { gate: 'FAIL', tasks_added: 1 },
          };
          return;
        }
        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-route-loop-bootstrap-approval',
      testDir,
      {
        name: 'route-loop-bootstrap-approval',
        nodes: [
          { id: 'bootstrap', prompt: 'Bootstrap.' },
          {
            id: 'work',
            prompt: 'Do the work.',
            depends_on: ['bootstrap', 'review-gate'],
            trigger_rule: 'one_success',
          },
          {
            id: 'converge',
            prompt: 'Check convergence.',
            depends_on: ['work'],
            output_format: {
              type: 'object',
              properties: {
                gate: { type: 'string', enum: ['PASS', 'FAIL'] },
                tasks_added: { type: 'number' },
              },
              required: ['gate', 'tasks_added'],
            },
          },
          {
            id: 'converge-router',
            depends_on: ['converge'],
            route_loop: {
              condition: "$converge.output.gate == 'PASS'",
              max_iterations: 3,
              routes: {
                positive: 'done',
                negative: 'review-gate',
                exhausted: 'exhausted',
              },
            },
          },
          {
            id: 'review-gate',
            approval: { message: 'Review $converge.output.tasks_added task(s).' },
            when: "$converge.output.gate == 'FAIL'",
          },
          { id: 'done', prompt: 'Done.', depends_on: ['converge-router'] },
          { id: 'exhausted', prompt: 'Escalate.', depends_on: ['converge-router'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const events = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => call[0] as { event_type: string; step_name?: string; data?: Record<string, unknown> }
    );
    expect(
      events.some(event => event.event_type === 'node_failed' && event.step_name === 'review-gate')
    ).toBe(false);
    expect(store.pauseWorkflowRun).toHaveBeenCalledWith(
      workflowRun.id,
      expect.objectContaining({ nodeId: 'review-gate' })
    );
    expect(calls.slice(0, 3)).toEqual(['bootstrap', 'work', 'converge']);
  });

  it('reruns the selected negative path while reusing completed external prerequisites', async () => {
    const { calls, routedEvents } = await runRouteLoopWorkflow({
      reviewResults: ['negative', 'positive'],
      includeExternalPrerequisites: true,
    });

    const nodeIds = calls.map(call => call.nodeId);

    expect(nodeIds[0]).toBe('prepare');
    expect(nodeIds.slice(1, 3).sort()).toEqual(['config', 'fix']);
    expect(nodeIds.slice(3)).toEqual(['review', 'fix', 'review', 'done']);
    expect(nodeIds.filter(nodeId => nodeId === 'prepare')).toHaveLength(1);
    expect(nodeIds.filter(nodeId => nodeId === 'config')).toHaveLength(1);
    expect(nodeIds.filter(nodeId => nodeId === 'fix')).toHaveLength(2);
    expect(nodeIds.filter(nodeId => nodeId === 'review')).toHaveLength(2);
    expect(routedEvents.map(event => event.data?.outcome)).toEqual(['negative', 'positive']);
  });

  it('does not let stale first-pass success trigger a scheduled negative-path join', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-active-dep-run');
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') {
          throw new Error('missing node id in active-dependency route-loop provider');
        }
        calls.push(nodeId);

        if (nodeId === 'correct') {
          throw new Error('correction failed');
        }

        if (nodeId === 'evaluator') {
          yield { type: 'assistant' as const, content: JSON.stringify({ result: 'negative' }) };
          yield {
            type: 'result' as const,
            sessionId: 'evaluator-session',
            structuredOutput: { result: 'negative' },
          };
          return;
        }

        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-active-dep',
      testDir,
      {
        name: 'route-loop-active-dep',
        mutates_checkout: false,
        nodes: [
          { id: 'validate', prompt: 'Validate command availability.' },
          {
            id: 'correct',
            prompt: 'Correct readiness findings.',
            when: "$evaluator.output.result == 'negative'",
          },
          {
            id: 'readiness',
            prompt: 'Check readiness.',
            depends_on: ['validate', 'correct'],
            trigger_rule: 'one_success',
          },
          {
            id: 'evaluator',
            prompt: 'Evaluate readiness.',
            depends_on: ['readiness'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'router',
            depends_on: ['evaluator'],
            route_loop: {
              condition: "$evaluator.output.result == 'positive'",
              max_iterations: 2,
              routes: {
                positive: 'done',
                negative: 'correct',
                exhausted: 'error',
              },
            },
          },
          { id: 'done', prompt: 'Done.', depends_on: ['router'] },
          { id: 'error', prompt: 'Error.', depends_on: ['router'] },
        ],
      } as unknown as Parameters<typeof executeDagWorkflow>[4],
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toEqual(['validate', 'readiness', 'evaluator', 'correct']);
    expect(calls.filter(nodeId => nodeId === 'readiness')).toHaveLength(1);
    expect(store.failWorkflowRun).toHaveBeenCalledWith(
      'route-loop-active-dep-run',
      expect.stringContaining('correction failed')
    );
  });

  it('reruns a non-root source node when the negative route targets the source directly', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('direct-from-route-loop-run');
    const calls: string[] = [];
    let reviewAttempt = 0;

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') {
          throw new Error('missing node id in direct-from route-loop provider');
        }
        calls.push(nodeId);

        if (nodeId === 'review') {
          reviewAttempt++;
          const result = reviewAttempt === 1 ? 'negative' : 'positive';
          yield { type: 'assistant' as const, content: JSON.stringify({ result }) };
          yield {
            type: 'result' as const,
            sessionId: `review-${String(reviewAttempt)}`,
            structuredOutput: { result },
          };
          return;
        }

        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-direct-from-route-loop',
      testDir,
      {
        name: 'direct-from-route-loop',
        mutates_checkout: false,
        nodes: [
          { id: 'start', prompt: 'Start.' },
          {
            id: 'review',
            prompt: 'Review.',
            depends_on: ['start'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'review-router',
            depends_on: ['review'],
            route_loop: {
              condition: "$review.output.result == 'positive'",
              max_iterations: 2,
              routes: {
                positive: 'done',
                negative: 'review',
                exhausted: 'escalation',
              },
            },
          },
          { id: 'done', prompt: 'Done.', depends_on: ['review-router'] },
          { id: 'escalation', prompt: 'Escalate.', depends_on: ['review-router'] },
        ],
      } as unknown as Parameters<typeof executeDagWorkflow>[4],
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const routedEvents = (
      store.persistRouteDecisionTransition as ReturnType<typeof mock>
    ).mock.calls.map(
      call =>
        (call[0] as Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0]).event.data
    );

    expect(calls).toEqual(['start', 'review', 'review', 'done']);
    expect(routedEvents.map(event => event.outcome)).toEqual(['negative', 'positive']);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('does not unblock a route target through another route_loop initial path', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('cross-loop-route-target-run');
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') {
          throw new Error('missing node id in cross-loop route target provider');
        }
        calls.push(nodeId);

        if (nodeId === 'a-review' || nodeId === 'b-review') {
          const result = nodeId === 'a-review' ? 'negative' : 'positive';
          yield { type: 'assistant' as const, content: JSON.stringify({ result }) };
          yield {
            type: 'result' as const,
            sessionId: `${nodeId}-session`,
            structuredOutput: { result },
          };
          return;
        }

        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-cross-loop-route-target',
      testDir,
      {
        name: 'cross-loop-route-target',
        mutates_checkout: false,
        nodes: [
          { id: 'a-start', prompt: 'Start A.' },
          {
            id: 'a-review',
            prompt: 'Review A.',
            depends_on: ['a-start'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'a-router',
            depends_on: ['a-review'],
            route_loop: {
              condition: "$a-review.output.result == 'positive'",
              max_iterations: 1,
              routes: {
                positive: 'shared',
                negative: 'a-retry',
                exhausted: 'a-error',
              },
            },
          },
          { id: 'a-retry', prompt: 'Retry A.', depends_on: ['a-router'] },
          { id: 'a-error', prompt: 'Error A.', depends_on: ['a-router'] },
          { id: 'shared', prompt: 'Shared target.' },
          {
            id: 'b-review',
            prompt: 'Review B.',
            depends_on: ['shared'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'b-router',
            depends_on: ['b-review'],
            route_loop: {
              condition: "$b-review.output.result == 'positive'",
              max_iterations: 1,
              routes: {
                positive: 'b-done',
                negative: 'shared',
                exhausted: 'b-error',
              },
            },
          },
          { id: 'b-done', prompt: 'Done B.', depends_on: ['b-router'] },
          { id: 'b-error', prompt: 'Error B.', depends_on: ['b-router'] },
        ],
      } as unknown as Parameters<typeof executeDagWorkflow>[4],
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toEqual(['a-start', 'a-review', 'a-retry']);
    expect(calls).not.toContain('shared');
    expect(calls).not.toContain('b-review');
    expect(calls).not.toContain('b-done');
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('fails the route_loop when an external rerun prerequisite is not completed', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('missing-external-prereq-route-loop-run');
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') {
          throw new Error('missing node id in missing-prereq route-loop provider');
        }
        calls.push(nodeId);
        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-missing-external-prereq-route-loop',
      testDir,
      {
        name: 'missing-external-prereq-route-loop',
        mutates_checkout: false,
        nodes: [
          { id: 'setup', prompt: 'Setup.', when: '1 == 0' },
          { id: 'fix', prompt: 'Fix.', depends_on: ['setup'] },
          { id: 'review', prompt: 'Review.', depends_on: ['fix'] },
          {
            id: 'review-router',
            depends_on: ['review'],
            route_loop: {
              condition: "$review.output == 'positive'",
              max_iterations: 2,
              routes: {
                positive: 'done',
                negative: 'fix',
                exhausted: 'escalation',
              },
            },
          },
          { id: 'done', prompt: 'Done.', depends_on: ['review-router'] },
          { id: 'escalation', prompt: 'Escalate.', depends_on: ['review-router'] },
        ],
      } as unknown as Parameters<typeof executeDagWorkflow>[4],
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([
        ['fix', 'prior fix'],
        ['review', 'negative'],
      ])
    );

    expect(calls).toEqual([]);
    expect(store.persistRouteDecisionTransition).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).toHaveBeenCalledWith(
      'missing-external-prereq-route-loop-run',
      expect.stringContaining(
        "route_loop 'review-router' cannot activate negative target 'fix' because external prerequisite 'setup' for rerun node 'fix' is not completed"
      )
    );
  });

  it('does not run root route targets before the route_loop selects them', async () => {
    const { calls } = await runRouteLoopWorkflow({
      reviewResults: ['positive'],
      routeTargetsAreRoots: true,
    });

    expect(calls.map(call => call.nodeId)).toEqual(['fix', 'review', 'done']);
    expect(calls.some(call => call.nodeId === 'escalation')).toBe(false);
  });

  it('runs selected route target descendants after the selected target', async () => {
    const { calls } = await runRouteLoopWorkflow({
      reviewResults: ['positive'],
      routeTargetsAreRoots: true,
      includeDoneDependent: true,
    });

    expect(calls.map(call => call.nodeId)).toEqual(['fix', 'review', 'done', 'publish']);
  });

  it('reruns multiple negative route attempts without clearing a fresh router rerun schedule', async () => {
    const { calls, routedEvents } = await runRouteLoopWorkflow({
      reviewResults: ['negative', 'negative', 'positive'],
    });

    expect(calls.map(call => call.nodeId)).toEqual([
      'fix',
      'review',
      'fix',
      'review',
      'fix',
      'review',
      'done',
    ]);
    expect(routedEvents.map(event => event.data?.outcome)).toEqual([
      'negative',
      'negative',
      'positive',
    ]);
    expect(routedEvents.map(event => event.data?.execution_seq)).toEqual([1, 2, 3]);
  });

  it('does not rerun unrelated completed descendants when revisiting the negative path layer', async () => {
    const { calls } = await runRouteLoopWorkflow({
      reviewResults: ['negative', 'positive'],
      includeUnrelatedFixDependent: true,
    });

    const nodeIds = calls.map(call => call.nodeId);
    const firstFixIndex = nodeIds.indexOf('fix');
    const secondFixIndex = nodeIds.indexOf('fix', firstFixIndex + 1);
    const firstReviewIndex = nodeIds.indexOf('review');
    const secondReviewIndex = nodeIds.indexOf('review', firstReviewIndex + 1);
    const auditIndex = nodeIds.indexOf('audit');
    const doneIndex = nodeIds.indexOf('done');

    expect(nodeIds.filter(nodeId => nodeId === 'audit')).toHaveLength(1);
    expect(nodeIds).toHaveLength(6);
    expect(firstFixIndex).toBe(0);
    expect(firstReviewIndex).toBeGreaterThan(firstFixIndex);
    expect(auditIndex).toBeGreaterThan(firstFixIndex);
    expect(secondFixIndex).toBeGreaterThan(firstReviewIndex);
    expect(secondReviewIndex).toBeGreaterThan(secondFixIndex);
    expect(doneIndex).toBeGreaterThan(secondReviewIndex);
  });

  it('fails the workflow when durable route-decision persistence rejects a stale write', async () => {
    const { store, calls, routedEvents } = await runRouteLoopWorkflow({
      reviewResults: ['negative'],
      persistRouteDecisionTransition: async () => {
        throw new Error('stale route decision');
      },
    });

    expect(calls.map(call => call.nodeId)).toEqual(['fix', 'review']);
    expect(routedEvents).toHaveLength(1);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).toHaveBeenCalledWith(
      'route-loop-run',
      expect.stringContaining('stale route decision')
    );
  });

  it('routes to exhausted on the second false result when max_iterations is 1', async () => {
    const { store, calls, routedEvents } = await runRouteLoopWorkflow({
      reviewResults: ['negative', 'negative'],
      maxIterations: 1,
    });

    expect(calls.map(call => call.nodeId)).toEqual([
      'fix',
      'review',
      'fix',
      'review',
      'escalation',
    ]);
    expect(calls.some(call => call.nodeId === 'done')).toBe(false);
    expect(routedEvents.map(event => event.data?.outcome)).toEqual(['negative', 'exhausted']);
    expect(routedEvents[1]?.data).toMatchObject({
      to: 'escalation',
      condition: "$review.output.result == '<redacted>'",
      condition_result: false,
      negative_count: 2,
      max_iterations: 1,
      attempt: 2,
      execution_seq: 2,
    });
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('serializes parallel route_loop decisions against the latest execution sequence', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('parallel-route-loop-run');

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = String(sendOptions?.nodeConfig?.nodeId ?? '');
        yield { type: 'assistant' as const, content: JSON.stringify({ result: 'positive' }) };
        yield {
          type: 'result' as const,
          sessionId: `${nodeId}-session`,
          structuredOutput: { result: 'positive' },
        };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-parallel-route-loop',
      testDir,
      {
        name: 'parallel-route-loop',
        mutates_checkout: false,
        nodes: [
          {
            id: 'review-a',
            prompt: 'Review A.',
            output_format: {
              type: 'object',
              properties: { result: { type: 'string', enum: ['positive'] } },
              required: ['result'],
            },
          },
          {
            id: 'review-b',
            prompt: 'Review B.',
            output_format: {
              type: 'object',
              properties: { result: { type: 'string', enum: ['positive'] } },
              required: ['result'],
            },
          },
          {
            id: 'router-a',
            depends_on: ['review-a'],
            route_loop: {
              condition: "$review-a.output.result == 'positive'",
              max_iterations: 1,
              routes: {
                positive: 'done-a',
                negative: 'fix-a',
                exhausted: 'escalate-a',
              },
            },
          },
          {
            id: 'router-b',
            depends_on: ['review-b'],
            route_loop: {
              condition: "$review-b.output.result == 'positive'",
              max_iterations: 1,
              routes: {
                positive: 'done-b',
                negative: 'fix-b',
                exhausted: 'escalate-b',
              },
            },
          },
          { id: 'done-a', prompt: 'Done A.', depends_on: ['router-a'] },
          { id: 'done-b', prompt: 'Done B.', depends_on: ['router-b'] },
          { id: 'fix-a', prompt: 'Fix A.', depends_on: ['router-a'] },
          { id: 'fix-b', prompt: 'Fix B.', depends_on: ['router-b'] },
          { id: 'escalate-a', prompt: 'Escalate A.', depends_on: ['router-a'] },
          { id: 'escalate-b', prompt: 'Escalate B.', depends_on: ['router-b'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const expectedSeqs = (
      store.persistRouteDecisionTransition as ReturnType<typeof mock>
    ).mock.calls.map(
      call =>
        (call[0] as Parameters<IWorkflowStore['persistRouteDecisionTransition']>[0])
          .expected_execution_seq
    );

    expect(expectedSeqs.sort()).toEqual([0, 1]);
  });

  it('hydrates prior route activation metadata on resume', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-resume-run', {
      metadata: {
        loopCounters: { 'review-router': 1 },
        nodeAttempts: { 'review-router': 1 },
        executionSeq: 1,
        routeActivations: {
          revise: {
            route_loop_node_id: 'review-router',
            outcome: 'negative',
            target_node_id: 'revise',
            attempt: 1,
            execution_seq: 1,
          },
        },
      },
    });
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = sendOptions?.nodeConfig?.nodeId;
        if (typeof nodeId !== 'string') {
          throw new Error('missing route-loop resume node id');
        }
        calls.push(nodeId);
        yield { type: 'assistant' as const, content: `${nodeId} output` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-resume',
      testDir,
      {
        name: 'route-loop-resume',
        mutates_checkout: false,
        nodes: [
          { id: 'draft', prompt: 'Draft.' },
          {
            id: 'review',
            prompt: 'Review.',
            depends_on: ['draft'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'review-router',
            depends_on: ['review'],
            route_loop: {
              condition: "$review.output.result == 'positive'",
              max_iterations: 10,
              routes: {
                positive: 'done',
                negative: 'revise',
                exhausted: 'escalation',
              },
            },
          },
          { id: 'revise', prompt: 'Revise.', depends_on: ['review-router'] },
          { id: 'done', prompt: 'Done.', depends_on: ['review-router'] },
          { id: 'escalation', prompt: 'Escalate.', depends_on: ['review-router'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([
        ['draft', 'draft output'],
        ['review', JSON.stringify({ result: 'negative' })],
        ['review-router', JSON.stringify({ outcome: 'negative', to: 'revise' })],
      ])
    );

    expect(calls).toEqual(['revise']);
    expect(store.persistRouteDecisionTransition).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('continues a hydrated negative route path after the selected approval target was approved', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-approved-target-resume-run', {
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review-gate',
          message: 'Approve rework.',
          resolved: 'approved',
        },
        loopCounters: { router: 1 },
        nodeAttempts: { router: 1 },
        executionSeq: 1,
        routeActivations: {
          'review-gate': {
            route_loop_node_id: 'router',
            outcome: 'negative',
            target_node_id: 'review-gate',
            attempt: 1,
            execution_seq: 1,
          },
        },
      },
    });
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = String(sendOptions?.nodeConfig?.nodeId ?? '');
        calls.push(nodeId);
        if (nodeId === 'converge') {
          yield { type: 'assistant' as const, content: JSON.stringify({ result: 'positive' }) };
          yield {
            type: 'result' as const,
            sessionId: 'converge-session',
            structuredOutput: { result: 'positive' },
          };
          return;
        }
        yield { type: 'assistant' as const, content: `${nodeId} output` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-approved-target-resume',
      testDir,
      {
        name: 'route-loop-approved-target-resume',
        mutates_checkout: false,
        nodes: [
          { id: 'setup', prompt: 'Setup.' },
          { id: 'review-gate', approval: { message: 'Approve rework.' } },
          {
            id: 'work',
            prompt: 'Do the work.',
            depends_on: ['setup', 'review-gate'],
            trigger_rule: 'one_success',
          },
          {
            id: 'converge',
            prompt: 'Check convergence.',
            depends_on: ['work'],
            output_format: {
              type: 'object',
              properties: {
                result: { type: 'string', enum: ['positive', 'negative'] },
              },
              required: ['result'],
            },
          },
          {
            id: 'router',
            depends_on: ['converge'],
            route_loop: {
              condition: "$converge.output.result == 'positive'",
              max_iterations: 2,
              routes: {
                positive: 'done',
                negative: 'review-gate',
                exhausted: 'error',
              },
            },
          },
          { id: 'done', prompt: 'Done.', depends_on: ['router'] },
          { id: 'error', prompt: 'Error.', depends_on: ['router'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([
        ['setup', 'setup output'],
        ['review-gate', ''],
        ['work', 'stale work output'],
        ['converge', JSON.stringify({ result: 'negative' })],
        ['router', JSON.stringify({ outcome: 'negative', to: 'review-gate' })],
      ])
    );

    expect(calls).toEqual(['work', 'converge', 'done']);
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('hydrates only the latest activation for a route_loop controller on resume', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-latest-activation-run', {
      metadata: {
        loopCounters: { 'review-router': 0 },
        nodeAttempts: { 'review-router': 2 },
        executionSeq: 2,
        routeActivations: {
          revise: {
            route_loop_node_id: 'review-router',
            outcome: 'negative',
            target_node_id: 'revise',
            attempt: 1,
            execution_seq: 1,
          },
          done: {
            route_loop_node_id: 'review-router',
            outcome: 'positive',
            target_node_id: 'done',
            attempt: 2,
            execution_seq: 2,
          },
        },
      },
    });
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = String(sendOptions?.nodeConfig?.nodeId ?? '');
        calls.push(nodeId);
        yield { type: 'assistant' as const, content: `${nodeId} output` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-latest-activation',
      testDir,
      {
        name: 'route-loop-latest-activation',
        mutates_checkout: false,
        nodes: [
          { id: 'draft', prompt: 'Draft.' },
          { id: 'review', prompt: 'Review.', depends_on: ['draft'] },
          {
            id: 'review-router',
            depends_on: ['review'],
            route_loop: {
              condition: "$review.output.result == 'positive'",
              max_iterations: 10,
              routes: {
                positive: 'done',
                negative: 'revise',
                exhausted: 'escalation',
              },
            },
          },
          { id: 'revise', prompt: 'Revise.', depends_on: ['review-router'] },
          { id: 'done', prompt: 'Done.', depends_on: ['review-router'] },
          { id: 'escalation', prompt: 'Escalate.', depends_on: ['review-router'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([
        ['draft', 'draft output'],
        ['review', JSON.stringify({ result: 'positive' })],
        ['review-router', JSON.stringify({ outcome: 'positive', to: 'done' })],
      ])
    );

    expect(calls).toEqual(['done']);
    expect(store.persistRouteDecisionTransition).not.toHaveBeenCalled();
  });

  it('ignores historical route activations for retry-invalidated controllers', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-retry-activation-run', {
      metadata: {
        loopCounters: { 'review-router': 0 },
        nodeAttempts: { 'review-router': 1 },
        executionSeq: 1,
        routeActivations: {
          done: {
            route_loop_node_id: 'review-router',
            outcome: 'positive',
            target_node_id: 'done',
            attempt: 1,
            execution_seq: 1,
          },
        },
      },
    });
    const calls: string[] = [];

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = String(sendOptions?.nodeConfig?.nodeId ?? '');
        calls.push(nodeId);
        if (nodeId === 'review') {
          yield { type: 'assistant' as const, content: JSON.stringify({ result: 'positive' }) };
          yield {
            type: 'result' as const,
            sessionId: 'review-session',
            structuredOutput: { result: 'positive' },
          };
          return;
        }
        yield { type: 'assistant' as const, content: `${nodeId} output` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-retry-activation',
      testDir,
      {
        name: 'route-loop-retry-activation',
        mutates_checkout: false,
        nodes: [
          { id: 'fix', prompt: 'Fix.' },
          {
            id: 'review',
            prompt: 'Review.',
            depends_on: ['fix'],
            output_format: {
              type: 'object',
              properties: { result: { type: 'string', enum: ['positive'] } },
              required: ['result'],
            },
          },
          {
            id: 'review-router',
            depends_on: ['review'],
            route_loop: {
              condition: "$review.output.result == 'positive'",
              max_iterations: 10,
              routes: {
                positive: 'done',
                negative: 'fix',
                exhausted: 'escalation',
              },
            },
          },
          { id: 'done', prompt: 'Done.' },
          { id: 'escalation', prompt: 'Escalate.' },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([['fix', 'cached fix']]),
      undefined,
      undefined,
      undefined,
      {
        targetNodeId: 'review',
        retryEpoch: 1,
        invalidatedNodeIds: ['review', 'review-router', 'done', 'escalation'],
      }
    );

    expect(calls).toEqual(['review', 'done']);
  });

  it('re-executes a negative rerun path already present in priorCompletedNodes', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('route-loop-prior-success-rerun');
    const calls: string[] = [];
    let convergeAttempt = 0;

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        sendOptions?: SendQueryOptions
      ) {
        const nodeId = String(sendOptions?.nodeConfig?.nodeId ?? '');
        calls.push(nodeId);
        if (nodeId === 'converge') {
          convergeAttempt += 1;
          const gate = convergeAttempt === 1 ? 'FAIL' : 'PASS';
          yield {
            type: 'assistant' as const,
            content: JSON.stringify({ gate, tasks_added: gate === 'FAIL' ? 1 : 0 }),
          };
          yield {
            type: 'result' as const,
            sessionId: `converge-${String(convergeAttempt)}`,
            structuredOutput: { gate, tasks_added: gate === 'FAIL' ? 1 : 0 },
          };
          return;
        }
        yield { type: 'assistant' as const, content: `${nodeId} complete` };
        yield { type: 'result' as const, sessionId: `${nodeId}-session` };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-route-loop-prior-success-rerun',
      testDir,
      {
        name: 'route-loop-prior-success-rerun',
        mutates_checkout: false,
        nodes: [
          { id: 'setup', prompt: 'Setup.' },
          {
            id: 'work',
            prompt: 'Do the work.',
            depends_on: ['setup', 'explain'],
            trigger_rule: 'one_success',
          },
          {
            id: 'converge',
            prompt: 'Check convergence.',
            depends_on: ['work'],
            output_format: {
              type: 'object',
              properties: {
                gate: { type: 'string', enum: ['PASS', 'FAIL'] },
                tasks_added: { type: 'number' },
              },
              required: ['gate', 'tasks_added'],
            },
          },
          {
            id: 'converge-router',
            depends_on: ['converge'],
            route_loop: {
              condition: "$converge.output.gate == 'PASS'",
              max_iterations: 3,
              routes: {
                positive: 'done',
                negative: 'explain',
                exhausted: 'exhausted',
              },
            },
          },
          { id: 'explain', prompt: 'Explain the fail.' },
          { id: 'done', prompt: 'Done.', depends_on: ['converge-router'] },
          { id: 'exhausted', prompt: 'Escalate.', depends_on: ['converge-router'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([
        ['setup', 'setup output'],
        ['work', 'first-pass work'],
      ])
    );

    expect(calls).toEqual(['converge', 'explain', 'work', 'converge', 'done']);
    expect(
      (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.some(
        call =>
          (call[0] as { event_type?: string; step_name?: string }).event_type ===
            'node_skipped_prior_success' && (call[0] as { step_name?: string }).step_name === 'work'
      )
    ).toBe(false);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });
});

describe('executeDagWorkflow -- retry checkpoints', () => {
  async function runGit(repoPath: string, args: string[]): Promise<string> {
    const result = await git.execFileAsync('git', args, { cwd: repoPath });
    return result.stdout.trim();
  }

  it('persists pre-node checkpoints for command, prompt, bash, script, and loop executable node kinds', async () => {
    const testDir = join(
      tmpdir(),
      `dag-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Command prompt');
    await runGit(testDir, ['init']);
    await runGit(testDir, ['config', 'user.name', 'Archon Test']);
    await runGit(testDir, ['config', 'user.email', 'archon-test@example.com']);
    await runGit(testDir, ['add', '.']);
    await runGit(testDir, ['commit', '-m', 'initial']);

    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('checkpoint-run', {
      working_path: testDir,
      metadata: { retry_epoch: 0 },
    });

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response COMPLETE' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-checkpoint-test',
          nodes: [
            { id: 'command-node', command: 'my-cmd' },
            { id: 'prompt-node', prompt: 'Say done.', depends_on: ['command-node'] },
            { id: 'bash-node', bash: 'echo bash-output', depends_on: ['prompt-node'] },
            {
              id: 'script-node',
              script: "console.log('script-output')",
              runtime: 'bun',
              depends_on: ['bash-node'],
            },
            {
              id: 'loop-node',
              loop: {
                prompt: 'Say COMPLETE.',
                until: 'COMPLETE',
                max_iterations: 1,
              },
              depends_on: ['script-node'],
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(upsertCheckpoint.mock.calls.map(call => call[0].node_id)).toEqual([
        'command-node',
        'prompt-node',
        'bash-node',
        'script-node',
        'loop-node',
      ]);
      expect(
        upsertCheckpoint.mock.calls.every(call => call[0].workflow_run_id === 'checkpoint-run')
      ).toBe(true);
      expect(upsertCheckpoint.mock.calls.every(call => call[0].retry_epoch === 0)).toBe(true);
      expect(
        upsertCheckpoint.mock.calls.every(call =>
          call[0].checkpoint_ref.startsWith('refs/archon/checkpoints/checkpoint-run/0/')
        )
      ).toBe(true);
    } finally {
      mockSendQueryDag.mockImplementation(function* () {
        yield { type: 'assistant', content: 'DAG AI response' };
        yield { type: 'result', sessionId: 'dag-session-id' };
      });
      await rm(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('persists a pre-node checkpoint when entering a Plannotator gate', async () => {
    const testDir = join(
      tmpdir(),
      `dag-plannotator-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    await runGit(testDir, ['init']);
    await runGit(testDir, ['config', 'user.name', 'Archon Test']);
    await runGit(testDir, ['config', 'user.email', 'archon-test@example.com']);
    await writeFile(join(testDir, 'README.md'), 'initial\n');
    await runGit(testDir, ['add', 'README.md']);
    await runGit(testDir, ['commit', '-m', 'initial']);

    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;
    const gateSpy = spyOn(plannotatorGateExecutor, 'executePlannotatorGateNode').mockResolvedValue({
      state: 'completed',
      output: 'approved',
    });

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'dag-plannotator-checkpoint-test',
          nodes: [
            {
              id: 'review',
              plannotator_gate: {
                document: 'review.html',
                rework: { prompt: 'Revise the review.' },
              },
            },
          ],
        },
        makeWorkflowRun('plannotator-checkpoint-run', {
          working_path: testDir,
          metadata: { retry_epoch: 0 },
        }),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(gateSpy).toHaveBeenCalledTimes(1);
      expect(upsertCheckpoint.mock.calls.map(call => call[0].node_id)).toEqual(['review']);
    } finally {
      gateSpy.mockRestore();
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('persists untracked files from a completed dependency before the next node starts', async () => {
    const testDir = join(
      tmpdir(),
      `dag-checkpoint-untracked-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const questionsFile = 'specs/008-runtime-settings-background/clarification-questions.md';
    await mkdir(testDir, { recursive: true });
    await runGit(testDir, ['init']);
    await runGit(testDir, ['config', 'user.name', 'Archon Test']);
    await runGit(testDir, ['config', 'user.email', 'archon-test@example.com']);
    await writeFile(join(testDir, 'README.md'), 'initial\n');
    await runGit(testDir, ['add', 'README.md']);
    await runGit(testDir, ['commit', '-m', 'initial']);

    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;
    const workflowRun = makeWorkflowRun('checkpoint-untracked-run', {
      workflow_name: 'checkpoint-untracked-workflow',
      working_path: testDir,
      metadata: { retry_epoch: 0 },
    });

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'checkpoint-untracked-workflow',
          nodes: [
            {
              id: 'clarify',
              bash:
                'mkdir -p .specify specs/008-runtime-settings-background\n' +
                'printf \'{"feature":"008-runtime-settings-background"}\\n\' > .specify/feature.json\n' +
                `printf 'question before response\\n' > ${questionsFile}`,
            },
            {
              id: 'clarify-respond',
              bash: `printf 'response mutation\\n' >> ${questionsFile}`,
              depends_on: ['clarify'],
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const checkpointRows = upsertCheckpoint.mock.calls.map(call => call[0]);
      const clarifyRespondCheckpoint = checkpointRows.find(
        row => row.node_id === 'clarify-respond'
      );
      expect(clarifyRespondCheckpoint).toBeDefined();
      expect(clarifyRespondCheckpoint?.created_commit).toBe(true);

      const committedFiles = await runGit(testDir, [
        'ls-tree',
        '-r',
        '--name-only',
        clarifyRespondCheckpoint!.commit_sha,
      ]);
      expect(committedFiles.split('\n')).toContain('.specify/feature.json');
      expect(committedFiles.split('\n')).toContain(questionsFile);
      expect(
        await runGit(testDir, ['show', `${clarifyRespondCheckpoint!.commit_sha}:${questionsFile}`])
      ).toBe('question before response');
      expect(await readFile(join(testDir, questionsFile), 'utf8')).toBe(
        'question before response\nresponse mutation\n'
      );
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips checkpointing when cwd is not a git repository', async () => {
    const testDir = join(
      tmpdir(),
      `dag-nongit-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'dag-nongit-checkpoint-test',
          nodes: [{ id: 'echo-node', bash: 'printf folder-ok > marker.txt' }],
        },
        makeWorkflowRun('nongit-checkpoint-run'),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(upsertCheckpoint).not.toHaveBeenCalled();
      expect(await readFile(join(testDir, 'marker.txt'), 'utf8')).toBe('folder-ok');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('skips checkpointing when mutates_checkout is false', async () => {
    const testDir = join(
      tmpdir(),
      `dag-no-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'dag-no-checkpoint-test',
          mutates_checkout: false,
          nodes: [{ id: 'prompt-node', prompt: 'Say done.' }],
        },
        makeWorkflowRun('no-checkpoint-run'),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(upsertCheckpoint).not.toHaveBeenCalled();
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('persists loop_group body checkpoints with namespaced node ids when workflow mutates checkout', async () => {
    const testDir = join(
      tmpdir(),
      `dag-loopgroup-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    await runGit(testDir, ['init']);
    await runGit(testDir, ['config', 'user.name', 'Archon Test']);
    await runGit(testDir, ['config', 'user.email', 'archon-test@example.com']);
    await writeFile(join(testDir, 'README.md'), 'initial\n');
    await runGit(testDir, ['add', 'README.md']);
    await runGit(testDir, ['commit', '-m', 'initial']);

    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'dag-loopgroup-checkpoint-test',
          nodes: [
            {
              id: 'create-story',
              loop_group: {
                until: 'CREATE_STORY_READY',
                max_iterations: 1,
                fresh_context: true,
                nodes: [
                  {
                    id: 'author-story',
                    bash:
                      "printf 'draft\\n' >> story.md\n" +
                      'printf \'{"status":"draft"}\\nCREATE_STORY_READY\\n\'',
                    depends_on: [],
                  },
                ],
              },
              depends_on: [],
            },
          ],
        },
        makeWorkflowRun('loopgroup-checkpoint-run', {
          working_path: testDir,
          metadata: { retry_epoch: 0 },
        }),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(upsertCheckpoint.mock.calls.map(call => call[0].node_id)).toContain('create-story');
      expect(upsertCheckpoint.mock.calls.map(call => call[0].node_id)).toContain(
        'create-story.author-story'
      );
      expect(upsertCheckpoint.mock.calls.map(call => call[0].node_id)).not.toContain(
        'author-story'
      );
      expect(
        upsertCheckpoint.mock.calls.every(call =>
          call[0].checkpoint_ref.startsWith('refs/archon/checkpoints/loopgroup-checkpoint-run/0/')
        )
      ).toBe(true);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('skips checkpointing for skipped, approval, and cancel nodes', async () => {
    const testDir = join(
      tmpdir(),
      `dag-checkpoint-skip-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    const upsertCheckpoint = mock(
      async (data: Parameters<NonNullable<IWorkflowStore['upsertWorkflowNodeCheckpoint']>>[0]) => ({
        ...data,
        created_at: new Date(),
      })
    );
    const store = createMockStore();
    store.upsertWorkflowNodeCheckpoint = upsertCheckpoint;

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'dag-checkpoint-skip-test',
          nodes: [
            { id: 'skipped-node', prompt: 'skip me', when: 'not valid condition' },
            { id: 'approval-node', approval: { message: 'approve?' } },
            { id: 'cancel-node', cancel: 'stop' },
          ],
        },
        makeWorkflowRun('checkpoint-skip-run'),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(upsertCheckpoint).not.toHaveBeenCalled();
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('logs a warning for parallel mutating executable nodes in one layer', async () => {
    mockLogFn.mockClear();
    const testDir = join(
      tmpdir(),
      `dag-parallel-warning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'dag-parallel-warning-test',
          nodes: [
            { id: 'left', prompt: 'Left.' },
            { id: 'right', prompt: 'Right.' },
          ],
        },
        makeWorkflowRun('parallel-warning-run'),
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      expect(
        mockLogFn.mock.calls.some(call => call[1] === 'dag.parallel_mutating_executable_nodes')
      ).toBe(true);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

describe('executeDagWorkflow -- break after result (no hang on subprocess exit)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-break-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Command prompt $ARGUMENTS');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    // Restore default sync generator so later tests aren't affected
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('command/prompt node completes immediately after result — does not block on post-result messages', async () => {
    // Generator yields result then hangs forever (simulates subprocess that won't exit)
    mockSendQueryDag.mockImplementation(async function* () {
      yield { type: 'assistant', content: 'response' };
      yield { type: 'result', sessionId: 'sess-break' };
      // Subprocess hangs — without break, this blocks until idle timeout
      await new Promise<void>(() => {});
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    // Should complete promptly (not hang for 30 min)
    const result = await Promise.race([
      executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        { name: 'break-test', nodes: [{ id: 'n1', command: 'my-cmd' }] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      ).then(() => 'completed'),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out — break after result not working')), 5000)
      ),
    ]);

    expect(result).toBe('completed');
  });

  it('loop node completes immediately after result — does not block on post-result messages', async () => {
    // Generator yields result then hangs forever
    mockSendQueryDag.mockImplementation(async function* () {
      yield { type: 'assistant', content: 'All done. COMPLETE' };
      yield { type: 'result', sessionId: 'sess-loop-break' };
      await new Promise<void>(() => {});
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const result = await Promise.race([
      executeDagWorkflow(
        mockDeps,
        platform,
        'conv-dag',
        testDir,
        {
          name: 'loop-break-test',
          nodes: [
            {
              id: 'loop1',
              loop: { until: 'COMPLETE', max_iterations: 3 },
              prompt: 'Do the thing. Say COMPLETE when done.',
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      ).then(() => 'completed'),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out — break after result not working')), 5000)
      ),
    ]);

    expect(result).toBe('completed');
  });
});

describe('executeDagWorkflow -- terminal node output selection', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-terminal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Command prompt $ARGUMENTS');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns output of the single terminal node in a linear DAG', async () => {
    mockSendQueryDag.mockImplementation(async function* () {
      yield { type: 'assistant', content: 'Final summary text' };
      yield { type: 'result', sessionId: 'sess-linear' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'linear-dag',
        nodes: [
          { id: 'step1', command: 'my-cmd' },
          { id: 'step2', command: 'my-cmd', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(result).toBe('Final summary text');
  });

  it('fails node when the AI stream closes with no assistant output', async () => {
    // Empty assistant output on AI nodes (`command:`/`prompt:`) typically
    // indicates a silent provider rejection or stream interruption that
    // didn't yield a result.isError chunk. Treat it as a node failure
    // rather than a successful empty completion.
    mockSendQueryDag.mockImplementation(async function* () {
      yield { type: 'result', sessionId: 'sess-empty' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'empty-dag', nodes: [{ id: 'only', command: 'my-cmd' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBeGreaterThan(0);
    const failedData = (nodeFailedEvents[0][0] as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    expect(failedData.error).toContain('produced no assistant output');
    // Workflow-level failure must propagate, not just the node event.
    expect(store.failWorkflowRun).toHaveBeenCalled();
  });

  it('does NOT fail node when stream yields no assistant text but a structuredOutput is present', async () => {
    // Output-format nodes legitimately produce zero free-form text — the
    // useful payload is the structuredOutput field. The empty-output guard
    // must spare them.
    mockSendQueryDag.mockImplementation(async function* () {
      yield {
        type: 'result',
        sessionId: 'sess-structured',
        structuredOutput: { category: 'math' },
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'structured-only-dag',
        nodes: [
          {
            id: 'classify',
            prompt: 'Classify this',
            output_format: { type: 'object', properties: {} },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBe(0);
    const nodeCompletedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_completed'
    );
    expect(nodeCompletedEvents.length).toBeGreaterThan(0);
  });

  it('idle-timeout with zero output produces node_failed, not node_completed', async () => {
    // Regression test for #1807: idle-timeout before first token must fail, not silently complete.
    // The generator yields nothing; idle_timeout fires before any output is produced.
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      options?: { abortSignal?: AbortSignal }
    ) {
      // Wait for abort (idle timeout fires abort).
      await new Promise<void>(resolve => {
        if (options?.abortSignal?.aborted) {
          resolve();
        } else {
          options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        }
      });
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'idle-timeout-no-output',
        nodes: [
          {
            id: 'classify',
            command: 'my-cmd',
            idle_timeout: 50,
            // Disable retries so the test doesn't wait for retry delays (the
            // "timed out" message matches TRANSIENT patterns, which would trigger
            // the default 2-retry / 3s-delay policy otherwise).
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBeGreaterThan(0);
    const failedData = (nodeFailedEvents[0][0] as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    expect(failedData.error).toContain('timed out with no output');
    const nodeCompletedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_completed'
    );
    expect(nodeCompletedEvents.length).toBe(0);
    expect(store.failWorkflowRun).toHaveBeenCalled();
  });

  it('output_format set but provider returns no structured output → node_failed (Task 8 fail-fast)', async () => {
    // Provider replied with prose only; no structuredOutput on the result chunk.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Sure, the verdict is review.' };
      yield { type: 'result', sessionId: 's' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'outfmt-missing',
        nodes: [
          {
            id: 'classify',
            prompt: 'classify it',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failed = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(failed.length).toBeGreaterThan(0);
    const errMsg = ((failed[0][0] as Record<string, unknown>).data as Record<string, unknown>)
      .error as string;
    expect(errMsg).toContain('no schema-valid structured output');
  });

  it('output_format structured output failing schema validation → node_failed (Task 7)', async () => {
    // Provider returned a structured object missing the required `verdict` field.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '{"confidence":0.9}' };
      yield { type: 'result', sessionId: 's', structuredOutput: { confidence: 0.9 } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'outfmt-invalid',
        nodes: [
          {
            id: 'classify',
            prompt: 'classify it',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' }, confidence: { type: 'number' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failed = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(failed.length).toBeGreaterThan(0);
    const errMsg = ((failed[0][0] as Record<string, unknown>).data as Record<string, unknown>)
      .error as string;
    expect(errMsg).toContain('failed schema validation');
  });

  it('when: referencing a field not in the producer schema FAILS the node (not a silent skip)', async () => {
    // Regression guard: an unresolvable `.field` ref in a `when:` must fail the
    // dependent node (OutputRefError → node_failed), NOT fail-closed-skip it —
    // the exact regression that would silently revert the no-silent-drop fix.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '{"verdict":"review"}' };
      yield { type: 'result', sessionId: 's', structuredOutput: { verdict: 'review' } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'when-badref',
        nodes: [
          {
            id: 'gate',
            prompt: 'decide',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
          {
            id: 'runme',
            prompt: 'go',
            depends_on: ['gate'],
            when: "$gate.output.nonexistent == 'x'",
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const runmeFailed = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).event_type === 'node_failed' &&
        (call[0] as Record<string, unknown>).step_name === 'runme'
    );
    expect(runmeFailed).toBeDefined();
    const errMsg = ((runmeFailed![0] as Record<string, unknown>).data as Record<string, unknown>)
      .error as string;
    expect(errMsg).toContain('not declared in node');
  });

  it('best-effort provider: malformed-then-fixed structured output recovers within reasks', async () => {
    // Attempt 1 returns structured output missing the required `verdict`; the reask
    // loop re-runs and attempt 2 returns valid output → node COMPLETES (not failed).
    // Costs accumulate across both attempts.
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'result', sessionId: 's1', structuredOutput: { other: 'x' }, cost: 0.01 };
    });
    mockSendQueryDag.mockImplementation(function* () {
      yield {
        type: 'result',
        sessionId: 's2',
        structuredOutput: { verdict: 'review' },
        cost: 0.02,
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'reask-recover',
        nodes: [
          {
            id: 'classify',
            prompt: 'decide',
            provider: 'pi',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'pi',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'pi' }
    );

    // sendQuery ran twice (original + 1 reask); node completed, not failed.
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completed = eventCalls.filter(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).event_type === 'node_completed' &&
        (call[0] as Record<string, unknown>).step_name === 'classify'
    );
    const failed = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(completed.length).toBe(1);
    expect(failed.length).toBe(0);
    // Cost accumulates across both attempts (0.01 + 0.02), not just the last pass.
    const cost = ((completed[0][0] as Record<string, unknown>).data as Record<string, unknown>)
      .cost_usd as number;
    expect(cost).toBeCloseTo(0.03, 5);
  });

  it('best-effort provider: reask exhaustion fails loudly', async () => {
    // Every attempt returns invalid structured output → fail after 1 + maxReasks (3) tries.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'result', sessionId: 's', structuredOutput: { other: 'x' } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'reask-exhaust',
        nodes: [
          {
            id: 'classify',
            prompt: 'decide',
            provider: 'pi',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'pi',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'pi' }
    );

    // 1 initial + 3 reasks = 4 sendQuery calls, then fail-fast.
    expect(mockSendQueryDag.mock.calls.length).toBe(4);
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failed = eventCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(failed).toBeDefined();
    const errMsg = ((failed![0] as Record<string, unknown>).data as Record<string, unknown>)
      .error as string;
    expect(errMsg).toContain('failed schema validation');
  });

  it('enforced provider does NOT reask on a validation miss (exactly one sendQuery)', async () => {
    // Claude is 'enforced' → maxReasks = 0. A validation miss must fail on the
    // FIRST pass — a regressed gate would silently make 4 API calls per miss.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'result', sessionId: 's', structuredOutput: { other: 'x' } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'enforced-no-reask',
        nodes: [
          {
            id: 'classify',
            prompt: 'decide',
            provider: 'claude',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failed = eventCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(failed).toBeDefined();
  });

  it('best-effort provider: MISSING structured output triggers reask and recovers', async () => {
    // Attempt 1 returns prose with no structuredOutput; attempt 2 returns valid JSON.
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'assistant', content: 'Sure, here you go.' };
      yield { type: 'result', sessionId: 's1' };
    });
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'result', sessionId: 's2', structuredOutput: { verdict: 'review' } };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'reask-missing',
        nodes: [
          {
            id: 'classify',
            prompt: 'decide',
            provider: 'pi',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'pi',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'pi' }
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completed = eventCalls.filter(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).event_type === 'node_completed' &&
        (call[0] as Record<string, unknown>).step_name === 'classify'
    );
    expect(completed.length).toBe(1);
  });

  it('best-effort provider: idle-timeout on an output_format node does NOT reask', async () => {
    // Generator hangs → idle_timeout fires → abort. canReask is false (timed out),
    // so exactly one sendQuery and the failure names the timeout, not "prose".
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      options?: { abortSignal?: AbortSignal }
    ) {
      await new Promise<void>(resolve => {
        if (options?.abortSignal?.aborted) resolve();
        else options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'reask-idle',
        nodes: [
          {
            id: 'classify',
            prompt: 'decide',
            provider: 'pi',
            idle_timeout: 50,
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
            retry: { max_attempts: 0 },
          },
        ],
      },
      workflowRun,
      'pi',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'pi' }
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failed = eventCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(failed).toBeDefined();
    const errMsg = ((failed![0] as Record<string, unknown>).data as Record<string, unknown>)
      .error as string;
    expect(errMsg).toContain('timed out');
  });

  it('idle-timeout WITH output produces node_completed and sends warning, not node_failed', async () => {
    // The "subprocess hung after AI finished" path must still complete the node, not fail it.
    // Note: no `result` event — the generator yields content then hangs, so idle timeout fires
    // before the generator exits. This is the "subprocess hung without sending result" case.
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resumeSessionId?: string,
      options?: { abortSignal?: AbortSignal }
    ) {
      yield { type: 'assistant', content: 'Here is the analysis result.' };
      // Hang until abort signal fires (idle timeout aborts the controller)
      await new Promise<void>(resolve => {
        options?.abortSignal?.addEventListener('abort', () => resolve());
      });
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'idle-timeout-with-output',
        nodes: [{ id: 'step1', command: 'my-cmd', idle_timeout: 50, retry: { max_attempts: 0 } }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBe(0);
    const nodeCompletedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_completed'
    );
    expect(nodeCompletedEvents.length).toBeGreaterThan(0);
    const sentMessages = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(
      (c: unknown[]) => c[1] as string
    );
    expect(sentMessages.some(m => m.includes('completed via idle timeout'))).toBe(true);
  });

  it('fails the run when a node specifies an unknown provider (defense-in-depth at execution time)', async () => {
    // Loader-time validation also catches this (loader.ts iterates dagNodes
    // after parsing), but the dag-executor's resolveNodeProviderAndModel
    // throws as defense-in-depth in case a code path bypasses the loader.
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'unknown-provider-dag',
        nodes: [
          {
            id: 'bad',
            command: 'my-cmd',
            provider: 'claud', // typo
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.failWorkflowRun).toHaveBeenCalled();
    // The "unknown provider" detail surfaces on the node_failed event; the
    // workflow-level fail message names the failing node(s).
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBeGreaterThan(0);
    const nodeFailedData = (nodeFailedEvents[0][0] as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    expect(nodeFailedData.error).toContain("unknown provider 'claud'");
  });

  it('failure message names the failing node instead of generic summary', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'fail-msg-test',
        nodes: [
          {
            id: 'fail-node',
            command: 'my-cmd',
            provider: 'nonexistent',
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.failWorkflowRun).toHaveBeenCalled();
    const failCall = (store.failWorkflowRun as ReturnType<typeof mock>).mock.calls[0];
    const failMsg = failCall[1] as string;
    expect(failMsg).toContain('fail-node failed');
    expect(failMsg).not.toContain('no successful nodes');
  });

  it('excludes intermediate nodes with dependents from terminal set (fan-in DAG)', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      callCount++;
      if (callCount === 3) {
        // Third call is for node 'c' (terminal)
        yield { type: 'assistant', content: 'C final output' };
      } else {
        yield { type: 'assistant', content: `Intermediate output ${callCount}` };
      }
      yield { type: 'result', sessionId: `sess-fanin-${callCount}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'fanin-dag',
        nodes: [
          { id: 'a', command: 'my-cmd' },
          { id: 'b', command: 'my-cmd' },
          { id: 'c', command: 'my-cmd', depends_on: ['a', 'b'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Only 'c' is terminal (no node depends on it); 'a' and 'b' are not terminal
    expect(result).toBe('C final output');
  });
});

// ---------------------------------------------------------------------------
// Cancel node dispatch
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- cancel node', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-cancel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('cancel node transitions run to cancelled and sends message', async () => {
    const store = createMockStore();
    (store.cancelWorkflowRun as Mock<() => Promise<void>>).mockResolvedValue(undefined);
    // Track whether cancelWorkflowRun has been called to simulate status transition
    let cancelled = false;
    (store.cancelWorkflowRun as Mock<() => Promise<void>>).mockImplementation(async () => {
      cancelled = true;
    });
    (store.getWorkflowRunStatus as Mock<() => Promise<string>>).mockImplementation(async () =>
      cancelled ? 'cancelled' : 'running'
    );
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'cancel-test',
        nodes: [
          { id: 'check', bash: 'echo blocked' },
          { id: 'stop', depends_on: ['check'], cancel: 'Precondition failed' },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // cancelWorkflowRun should have been called
    expect((store.cancelWorkflowRun as Mock<() => Promise<void>>).mock.calls.length).toBe(1);

    // A message with the cancel reason should have been sent
    const sendCalls = (platform.sendMessage as Mock<() => Promise<void>>).mock.calls;
    const cancelMsg = sendCalls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1].includes('Workflow cancelled')
    );
    expect(cancelMsg).toBeDefined();
  });

  it('cancel node with when: false is skipped', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'cancel-skip-test',
        nodes: [
          { id: 'check', bash: 'echo ok' },
          { id: 'stop', depends_on: ['check'], cancel: 'Should not fire', when: '1 == 0' },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // cancelWorkflowRun should NOT have been called (when: condition is false)
    if (store.cancelWorkflowRun && typeof store.cancelWorkflowRun === 'function') {
      expect((store.cancelWorkflowRun as Mock<() => Promise<void>>).mock.calls.length).toBe(0);
    }
  });
});

describe('executeDagWorkflow -- credit exhaustion', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-credit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('marks node as failed when assistant output contains credit exhaustion text', async () => {
    const creditExhaustedQuery = mock(function* () {
      yield { type: 'assistant', content: "You're out of extra usage · resets in 2h" };
      yield { type: 'result', sessionId: 'dag-session-credit' };
    });
    mockGetAgentProviderDag.mockReturnValue({
      sendQuery: creditExhaustedQuery,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    });

    const store = createMockStore();
    const deps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('credit-exhaustion-run');

    await executeDagWorkflow(
      deps,
      platform,
      'conv-credit',
      testDir,
      {
        name: 'credit-test',
        nodes: [{ id: 'investigate', prompt: 'Investigate the issue' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // node_failed (not node_completed) must have been stored
    const events = (store.createWorkflowEvent as Mock<() => Promise<void>>).mock.calls.map(
      (c: unknown[]) => (c[0] as { event_type: string }).event_type
    );
    expect(events).toContain('node_failed');
    expect(events).not.toContain('node_completed');

    // Overall workflow should be marked failed
    expect(store.failWorkflowRun).toHaveBeenCalled();
  });
});
describe('executeDagWorkflow -- approval node', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-approval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('fresh approval node pauses with extended context (capture_response + on_reject)', async () => {
    const store = createMockStore();
    let pauseCommitted = false;
    let pauseCommittedAtApprovalRequest = false;
    store.pauseWorkflowRun = mock(async (): Promise<void> => {
      pauseCommitted = true;
    });
    store.createWorkflowEvent = mock(async event => {
      if (event.event_type === 'approval_requested') {
        pauseCommittedAtApprovalRequest = pauseCommitted;
      }
    });
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-test',
        nodes: [
          {
            id: 'review',
            approval: {
              message: 'Review the plan.',
              capture_response: true,
              on_reject: { prompt: 'Fix based on: $REJECTION_REASON', max_attempts: 3 },
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI should NOT have been called (fresh approval just pauses)
    expect(mockSendQueryDag.mock.calls.length).toBe(0);

    // pauseWorkflowRun should have been called with extended context
    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'approval',
      nodeId: 'review',
      message: 'Review the plan.',
      captureResponse: true,
      onRejectPrompt: 'Fix based on: $REJECTION_REASON',
      onRejectMaxAttempts: 3,
    });
    expect(pauseCommittedAtApprovalRequest).toBe(true);
    expect(store.createWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: workflowRun.id,
      event_type: 'approval_requested',
      step_name: 'review',
      data: {
        gateType: 'approval',
        nodeId: 'review',
        message: 'Review the plan.',
      },
    });
  });

  it('approval node without capture_response stores empty node output', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-no-capture',
        nodes: [
          {
            id: 'review',
            approval: { message: 'Approve?' },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // pauseWorkflowRun context should NOT have captureResponse
    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'approval',
      nodeId: 'review',
      message: 'Approve?',
    });
    // captureResponse should be undefined (not set)
    expect((pauseCalls[0][1] as Record<string, unknown>).captureResponse).toBeUndefined();
  });

  it('on_reject runs AI prompt and re-pauses on rejection resume', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Fixed based on feedback' };
      yield { type: 'result', sessionId: 'reject-fix-session' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    // Simulate a rejection resume — metadata has rejection_reason set by reject handler
    const workflowRun = makeWorkflowRun('reject-resume-run', {
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review',
          message: 'Approve this plan?',
          onRejectPrompt: 'Fix based on: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_reason: 'Missing edge case handling',
        rejection_count: 1,
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-reject-resume',
        nodes: [
          {
            id: 'review',
            approval: {
              message: 'Approve this plan?',
              capture_response: true,
              on_reject: { prompt: 'Fix based on: $REJECTION_REASON', max_attempts: 3 },
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI should have been called once (on_reject prompt ran)
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    // The prompt should contain the rejection reason
    const aiPrompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(aiPrompt).toContain('Missing edge case handling');

    // pauseWorkflowRun should have been called (re-paused at approval gate)
    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
  });

  it('on_reject does not write node_completed for the approval gate node ID', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Fixed based on feedback' };
      yield { type: 'result', sessionId: 'reject-no-poison-session' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    const workflowRun = makeWorkflowRun('reject-no-poison-run', {
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review',
          message: 'Approve this plan?',
          onRejectPrompt: 'Fix based on: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_reason: 'Missing edge case handling',
        rejection_count: 1,
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-no-poison',
        nodes: [
          {
            id: 'review',
            approval: {
              message: 'Approve this plan?',
              on_reject: { prompt: 'Fix based on: $REJECTION_REASON', max_attempts: 3 },
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The on_reject synthetic node must NOT produce a node_completed event with
    // step_name equal to the approval gate's own ID ('review'). If it did, a
    // subsequent resume would find the event via the DAG resume snapshot and
    // skip the approval gate entirely, bypassing the human gate.
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeCompletedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_completed'
    );
    const completedStepNames = nodeCompletedEvents.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).step_name
    );
    expect(completedStepNames).not.toContain('review');

    // The synthetic on_reject node MUST produce a node_completed event with the
    // distinct ID 'review:on_reject'. This ensures the synthetic node itself is
    // recorded as completed so it is not re-run on a subsequent resume.
    expect(completedStepNames.filter((n: unknown) => n === 'review:on_reject').length).toBe(1);
  });

  it('on_reject cancels when max_attempts exhausted', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    // rejection_count already at max_attempts
    const workflowRun = makeWorkflowRun('reject-exhausted-run', {
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review',
          message: 'Approve this plan?',
          onRejectPrompt: 'Fix based on: $REJECTION_REASON',
          onRejectMaxAttempts: 3,
        },
        rejection_reason: 'Still not right',
        rejection_count: 3,
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-exhausted',
        nodes: [
          {
            id: 'review',
            approval: {
              message: 'Approve this plan?',
              on_reject: { prompt: 'Fix: $REJECTION_REASON', max_attempts: 3 },
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI should NOT have been called (max attempts reached, straight to cancel)
    expect(mockSendQueryDag.mock.calls.length).toBe(0);

    // cancelWorkflowRun should have been called
    const cancelCalls = (store.cancelWorkflowRun as Mock<(id: string) => Promise<void>>).mock.calls;
    expect(cancelCalls.length).toBe(1);

    // pauseWorkflowRun should NOT have been called
    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(0);
  });

  it('on_reject with max_attempts: 1 cancels on first rejection', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    const workflowRun = makeWorkflowRun('reject-max1-run', {
      metadata: {
        approval: {
          type: 'approval',
          nodeId: 'review',
          message: 'Approve?',
          onRejectPrompt: 'Fix: $REJECTION_REASON',
          onRejectMaxAttempts: 1,
        },
        rejection_reason: 'Bad',
        rejection_count: 1,
      },
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval',
      testDir,
      {
        name: 'approval-max1',
        nodes: [
          {
            id: 'review',
            approval: {
              message: 'Approve?',
              on_reject: { prompt: 'Fix: $REJECTION_REASON', max_attempts: 1 },
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Should cancel immediately, no AI call
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
    expect((store.cancelWorkflowRun as Mock<(id: string) => Promise<void>>).mock.calls.length).toBe(
      1
    );
  });

  it('approval message substitutes $nodeId.output.field references from upstream structured output', async () => {
    // Repro for: approval gates were rendering literal "$gather-context.output.repo_name"
    // instead of resolved values, breaking interactive workflows like atlas-onboard.
    // Parity: prompt/bash/loop/cancel nodes already get substituteNodeOutputRefs;
    // approval.message must too so the human sees concrete values.
    const structuredJson = {
      repo_name: 'hcr-els',
      app_code: 'CCELS',
      frontend_port: 3012,
    };

    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'gather-context.md'), 'Gather context: $USER_MESSAGE');

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: JSON.stringify(structuredJson) };
      yield { type: 'result', sessionId: 'sid-approval-sub', structuredOutput: structuredJson };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('approval-sub-run');

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-approval-sub',
      testDir,
      {
        name: 'approval-sub-test',
        nodes: [
          {
            id: 'gather-context',
            command: 'gather-context',
            output_format: {
              type: 'object',
              properties: {
                repo_name: { type: 'string' },
                app_code: { type: 'string' },
                frontend_port: { type: 'number' },
              },
            },
          },
          {
            id: 'confirm',
            depends_on: ['gather-context'],
            approval: {
              message:
                'Repo: $gather-context.output.repo_name | App: $gather-context.output.app_code | Port: $gather-context.output.frontend_port',
            },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // gather-context AI call ran once; approval node does NOT call AI
    expect(mockSendQueryDag.mock.calls.length).toBe(1);

    // pauseWorkflowRun should receive the SUBSTITUTED message, not the literal placeholders
    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'approval',
      nodeId: 'confirm',
      message: 'Repo: hcr-els | App: CCELS | Port: 3012',
    });

    // The fix touches FOUR emission sites (safeSendMessage / createWorkflowEvent /
    // pauseWorkflowRun / event-emitter). Assert the other two reachable surfaces too —
    // a future regression at any one of them would otherwise pass this test silently.
    // (Per CodeRabbit review of PR coleam00/Archon#1426.)

    // (a) The chat-surface prompt emitted via platform.sendMessage must contain the
    //     substituted message and must NOT contain literal $gather-context.output refs.
    const sentMessages = (
      platform.sendMessage as Mock<(...args: unknown[]) => Promise<void>>
    ).mock.calls.map((c: unknown[]) => c[1] as string);
    expect(sentMessages.some(m => m.includes('Repo: hcr-els | App: CCELS | Port: 3012'))).toBe(
      true
    );
    expect(sentMessages.some(m => m.includes('$gather-context.output'))).toBe(false);

    // (b) The persisted approval_requested workflow event's data.message must be substituted.
    const approvalRequestedEvents = (
      store.createWorkflowEvent as Mock<() => Promise<void>>
    ).mock.calls.filter(
      (c: unknown[]) => (c[0] as { event_type: string }).event_type === 'approval_requested'
    );
    expect(approvalRequestedEvents.length).toBe(1);
    expect((approvalRequestedEvents[0][0] as { data: { message: string } }).data.message).toBe(
      'Repo: hcr-els | App: CCELS | Port: 3012'
    );
  });
});
describe('executeDagWorkflow -- env var injection', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-env-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, '.archon', 'commands', 'my-cmd.md'), '# Test', {
      flag: 'w',
    }).catch(async () => {
      await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
      await writeFile(join(testDir, '.archon', 'commands', 'my-cmd.md'), '# Test');
    });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('passes config.envVars as env to sendQuery for Claude node', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-env-test', nodes: [{ id: 'task', command: 'my-cmd' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, envVars: { MY_SECRET: 'abc123' } }
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    expect(optionsArg?.env).toEqual({ MY_SECRET: 'abc123' });
  });

  it('does not set env on claudeOptions when config.envVars is empty', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-no-env', nodes: [{ id: 'task', command: 'my-cmd' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, envVars: {} }
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(optionsArg?.env).toBeUndefined();
  });
});

describe('executeDagWorkflow -- Claude SDK advanced options', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-sdk-opts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockLogFn.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('fails node when SDK returns error_max_budget_usd result', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield {
        type: 'result',
        isError: true,
        errorSubtype: 'error_max_budget_usd',
        sessionId: 'sid',
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'budget-test',
        nodes: [{ id: 'step1', command: 'my-cmd', maxBudgetUsd: 2.5 }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(
      (store.failWorkflowRun as Mock<(id: string, msg: string) => Promise<void>>).mock.calls.length
    ).toBeGreaterThan(0);
  });

  it('error message includes cost cap when maxBudgetUsd is set', async () => {
    // 'ok' runs first (no deps), then 'capped' runs after (depends_on: ['ok'])
    // This ensures both nodes run — 'ok' succeeds, 'capped' hits the budget cap
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount === 1) {
        // First call: 'ok' node succeeds
        yield { type: 'assistant', content: 'done' };
        yield { type: 'result', sessionId: 'sid1' };
      } else {
        // Second call: 'capped' node hits budget cap
        yield {
          type: 'result',
          isError: true,
          errorSubtype: 'error_max_budget_usd',
          sessionId: 'sid2',
        };
      }
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'budget-msg-test',
        nodes: [
          { id: 'ok', prompt: 'do work first' },
          { id: 'capped', command: 'my-cmd', maxBudgetUsd: 2.5, depends_on: ['ok'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const capMessage = messages.find(m => m.includes('$2.50'));
    expect(capMessage).toBeDefined();
  });

  it('fails node when SDK returns error_during_execution result', async () => {
    // Regression test for #1208: previously we only failed on error_max_budget_usd
    // and silently broke on all other isError subtypes, letting failed nodes
    // masquerade as successes with empty output.
    mockSendQueryDag.mockImplementation(function* () {
      yield {
        type: 'result',
        isError: true,
        errorSubtype: 'error_during_execution',
        errors: ['Tool call failed: permission denied'],
        sessionId: 'sid-err',
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'err-exec-test',
        nodes: [{ id: 'step1', command: 'my-cmd' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The node_failed event should carry the subtype and SDK errors detail
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents.length).toBeGreaterThan(0);
    const failedData = (nodeFailedEvents[0][0] as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    expect(failedData.error).toContain('error_during_execution');
    expect(failedData.error).toContain('permission denied');
  });

  it('does NOT fail node when SDK returns isError: true + errorSubtype: success', async () => {
    // Regression test for #1425: stop_sequence terminations under the Claude
    // SDK contract carry is_error: true + subtype: 'success'. The provider
    // normalises this, but the executor keeps an explicit guard so a future
    // provider regression or a third-party IAgentProvider that forwards the
    // SDK pair raw cannot reintroduce the "SDK returned success" false-failure.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'classified output' };
      yield {
        type: 'result',
        isError: true,
        errorSubtype: 'success',
        stopReason: 'stop_sequence',
        sessionId: 'sid-stop',
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'success-stop-seq-test',
        nodes: [{ id: 'classify', command: 'my-cmd' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const nodeFailedEvents = eventCalls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).event_type === 'node_failed'
    );
    expect(nodeFailedEvents).toHaveLength(0);

    const completeCalls = (store.completeWorkflowRun as ReturnType<typeof mock>).mock.calls;
    expect(completeCalls.length).toBeGreaterThan(0);
  });

  it('forwards workflow-level effort to node when no per-node override', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'workflow-effort-test',
        nodes: [{ id: 'step1', command: 'my-cmd' }],
        effort: 'high',
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.effort).toBe('high');
  });

  it('per-node effort overrides workflow-level effort', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'node-effort-override-test',
        nodes: [{ id: 'step1', command: 'my-cmd', effort: 'max' }],
        effort: 'low',
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg?.nodeConfig as Record<string, unknown>;
    expect(nodeConfig?.effort).toBe('max');
  });

  it('preserves exact loop-node effort and applies it over workflow effort', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '<promise>DONE</promise>' };
      yield { type: 'result', sessionId: 'loop-effort-session' };
    });

    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'loop-node-effort-override-test',
        nodes: [
          dagNodeSchema.parse({
            id: 'loop-step',
            loop: { prompt: 'Work.', until: 'DONE', max_iterations: 1 },
            effort: '  future-loop  ',
          }),
        ],
        effort: 'workflow-effort',
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBe('  future-loop  ');
  });

  it('applies the complete effort precedence chain without rewriting values', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));

    const cases: Array<{
      label: string;
      nodeEffort?: string;
      workflowEffort?: string;
      workflowLegacyEffort?: string;
      presetEffort?: string;
      providerConfigEffort?: string;
      expectedNodeEffort?: string;
    }> = [
      {
        label: 'node',
        nodeEffort: '  node  ',
        workflowEffort: 'workflow',
        workflowLegacyEffort: 'legacy',
        presetEffort: 'preset',
        providerConfigEffort: 'config',
        expectedNodeEffort: '  node  ',
      },
      {
        label: 'workflow',
        workflowEffort: '  workflow  ',
        workflowLegacyEffort: 'legacy',
        presetEffort: 'preset',
        providerConfigEffort: 'config',
        expectedNodeEffort: '  workflow  ',
      },
      {
        label: 'workflow legacy',
        workflowLegacyEffort: '  legacy  ',
        presetEffort: 'preset',
        providerConfigEffort: 'config',
        expectedNodeEffort: '  legacy  ',
      },
      {
        label: 'preset',
        presetEffort: '  preset  ',
        providerConfigEffort: 'config',
        expectedNodeEffort: '  preset  ',
      },
      {
        label: 'provider legacy config',
        providerConfigEffort: '  config  ',
      },
      { label: 'provider default' },
    ];

    for (const testCase of cases) {
      mockSendQueryDag.mockClear();
      const workflow: WorkflowDefinition = {
        name: `effort-precedence-${testCase.label}`,
        nodes: [
          {
            id: 'step1',
            command: 'my-cmd',
            ...(testCase.nodeEffort !== undefined ? { effort: testCase.nodeEffort } : {}),
          },
        ],
        ...(testCase.workflowEffort !== undefined ? { effort: testCase.workflowEffort } : {}),
        ...(testCase.workflowLegacyEffort !== undefined
          ? { modelReasoningEffort: testCase.workflowLegacyEffort }
          : {}),
      };
      const workflowPreset =
        testCase.presetEffort !== undefined
          ? { provider: 'codex', model: 'gpt-5.5', effort: testCase.presetEffort }
          : undefined;

      await executeDagWorkflow(
        createMockDeps(),
        createMockPlatform(),
        'conv-dag',
        testDir,
        workflow,
        makeWorkflowRun(),
        'codex',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        {
          ...minimalConfig,
          assistant: 'codex',
          assistants: {
            ...minimalConfig.assistants,
            codex:
              testCase.providerConfigEffort !== undefined
                ? { modelReasoningEffort: testCase.providerConfigEffort }
                : {},
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workflowPreset
      );

      const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
      const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
      const assistantConfig = optionsArg.assistantConfig as Record<string, unknown>;
      expect({ label: testCase.label, effort: nodeConfig.effort }).toEqual({
        label: testCase.label,
        effort: testCase.expectedNodeEffort,
      });
      expect({
        label: testCase.label,
        effort: assistantConfig.modelReasoningEffort,
      }).toEqual({
        label: testCase.label,
        effort: testCase.providerConfigEffort,
      });
    }
  });

  it('fails before dispatch when the resolved provider cannot honor explicit effort', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'opencode',
      getCapabilities: () => ({ ...mockCodexCapabilities(), effortControl: false }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'unsupported-effort-test',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'opencode', effort: 'ultra' }],
      },
      makeWorkflowRun(),
      'opencode',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'opencode' }
    );

    expect(mockSendQueryDag).not.toHaveBeenCalled();
    const failedEvent = store.createWorkflowEvent.mock.calls.find(
      call => call[0].event_type === 'node_failed'
    );
    expect(failedEvent?.[0].data?.error).toContain('does not support effortControl');
  });

  it('drops unsupported OpenCode preset effort with warning and omits applied effort', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'opencode',
      getCapabilities: () => ({ ...mockCodexCapabilities(), effortControl: false }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('opencode', {
      repoTiers: {
        large: { provider: 'opencode', model: 'opencode-large', effort: 'high' },
      },
    });

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'preset-effort-drop-test',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'large' }],
      },
      makeWorkflowRun(),
      'opencode',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'opencode' },
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.effort).toBeUndefined();

    const startedEvent = store.createWorkflowEvent.mock.calls.find(
      call => call[0].event_type === 'node_started'
    );
    expect(startedEvent?.[0].data?.effort).toBeUndefined();
    expect(startedEvent?.[0].data?.provider).toBe('opencode');
    expect(startedEvent?.[0].data?.model).toBe('opencode-large');

    const dropWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.preset_effort_unsupported'
    );
    expect(dropWarns.length).toBe(1);
    const dropPayload = dropWarns[0][0];
    expect(
      dropPayload &&
        typeof dropPayload === 'object' &&
        'effort' in dropPayload &&
        dropPayload.effort
    ).toBe('high');
  });

  it('still fails when workflow-authored explicit effort targets OpenCode', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'opencode',
      getCapabilities: () => ({ ...mockCodexCapabilities(), effortControl: false }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'workflow-effort-opencode-fail',
        effort: 'high',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'opencode' }],
      },
      makeWorkflowRun(),
      'opencode',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'opencode' }
    );

    expect(mockSendQueryDag).not.toHaveBeenCalled();
    const failedEvent = store.createWorkflowEvent.mock.calls.find(
      call => call[0].event_type === 'node_failed'
    );
    expect(failedEvent?.[0].data?.error).toContain('does not support effortControl');
  });

  it('warns once for Codex tier preset thinking with no node/workflow thinking', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('codex', {
      repoTiers: {
        large: { provider: 'codex', model: 'gpt-5.1', thinking: 'enabled' },
      },
    });

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'preset-thinking-codex-tier',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'large' }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' },
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    // Requested thinking is preserved on send options even when unsupported.
    expect(nodeConfig.thinking).toEqual({ type: 'enabled' });

    const startedEvent = store.createWorkflowEvent.mock.calls.find(
      call => call[0].event_type === 'node_started'
    );
    expect(startedEvent?.[0].data?.thinking).toEqual({ type: 'enabled' });
    expect(startedEvent?.[0].data?.provider).toBe('codex');

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(1);
    const payload = capWarns[0][0] as { unsupported?: string[] };
    expect(payload.unsupported).toEqual(['thinking']);

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warnings = sendMessage.mock.calls
      .map(call => call[1] as string)
      .filter(msg => typeof msg === 'string' && msg.includes('thinking'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("doesn't support");
  });

  it('warns once for OpenCode alias preset thinking with no node/workflow thinking', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'opencode',
      getCapabilities: () => ({ ...mockCodexCapabilities(), effortControl: false }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('opencode', {
      globalAliases: {
        '@thinky': { provider: 'opencode', model: 'oc-model', thinking: { type: 'enabled' } },
      },
    });

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'preset-thinking-opencode-alias',
        nodes: [{ id: 'step1', command: 'my-cmd', model: '@thinky' }],
      },
      makeWorkflowRun(),
      'opencode',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'opencode' },
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.thinking).toEqual({ type: 'enabled' });

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(1);
    expect((capWarns[0][0] as { unsupported?: string[] }).unsupported).toEqual(['thinking']);
  });

  it('warns once for Grok tier preset thinking with no node/workflow thinking', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'grok',
      getCapabilities: () => ({
        ...mockCodexCapabilities(),
        effortControl: false,
        thinkingControl: false,
      }),
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('grok', {
      repoTiers: {
        medium: { provider: 'grok', model: 'grok-3', thinking: 'disabled' },
      },
    });

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'preset-thinking-grok-tier',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'medium' }],
      },
      makeWorkflowRun(),
      'grok',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'grok' },
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.thinking).toEqual({ type: 'disabled' });

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(1);
    expect((capWarns[0][0] as { unsupported?: string[] }).unsupported).toEqual(['thinking']);
  });

  it('does not warn for Claude preset thinking (supported provider)', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('claude', {
      repoTiers: {
        large: { provider: 'claude', model: 'claude-opus-4', thinking: 'adaptive' },
      },
    });

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'preset-thinking-claude-ok',
        nodes: [{ id: 'step1', command: 'my-cmd', model: 'large' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.thinking).toEqual({ type: 'adaptive' });

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(0);

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warnings = sendMessage.mock.calls
      .map(call => call[1] as string)
      .filter(msg => typeof msg === 'string' && msg.includes('thinking'));
    expect(warnings).toEqual([]);
  });

  it('still warns once for explicit node thinking on Codex (unchanged control)', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'explicit-thinking-codex',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'codex', thinking: 'enabled' }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.thinking).toEqual({ type: 'enabled' });

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(1);
    expect((capWarns[0][0] as { unsupported?: string[] }).unsupported).toEqual(['thinking']);
  });

  it('still warns once for explicit workflow thinking on Codex (unchanged control)', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    mockLogFn.mockClear();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'workflow-thinking-codex',
        thinking: 'enabled',
        nodes: [{ id: 'step1', command: 'my-cmd', provider: 'codex' }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as Record<string, unknown>;
    const nodeConfig = optionsArg.nodeConfig as Record<string, unknown>;
    expect(nodeConfig.thinking).toEqual({ type: 'enabled' });

    const capWarns = mockLogFn.mock.calls.filter(
      (call: unknown[]) => call[1] === 'dag.unsupported_capabilities'
    );
    expect(capWarns.length).toBe(1);
    expect((capWarns[0][0] as { unsupported?: string[] }).unsupported).toEqual(['thinking']);
  });
});

describe('executeDagWorkflow -- cost tracking', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockLogFn.mockClear();

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('passes total_cost_usd to completeWorkflowRun when node yields cost', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done' };
      yield { type: 'result', sessionId: 'sid-cost', cost: 0.0042 };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-cost', nodes: [{ id: 'step', prompt: 'Do thing.' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).toEqual({
      node_counts: { completed: 1, failed: 0, skipped: 0, total: 1 },
      total_cost_usd: 0.0042,
    });
  });

  it('sums total_cost_usd across multiple sequential nodes', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      yield { type: 'assistant', content: `Step ${String(callCount)} output` };
      yield { type: 'result', sessionId: `sid-${String(callCount)}`, cost: 0.001 };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-cost-multi',
        nodes: [
          { id: 'step1', prompt: 'Step 1.' },
          { id: 'step2', prompt: 'Step 2.', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0.002 });
  });

  it('omits total_cost_usd from completeWorkflowRun when no cost yielded', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Some output' };
      yield { type: 'result', sessionId: 'sid-no-cost' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-no-cost', nodes: [{ id: 'step', prompt: 'Do thing.' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).not.toHaveProperty('total_cost_usd');
  });

  it('accumulates cost across loop iterations and includes in completeWorkflowRun', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount < 3) {
        yield { type: 'assistant', content: 'Still working...' };
        yield { type: 'result', sessionId: `loop-sid-${String(callCount)}`, cost: 0.001 };
      } else {
        yield { type: 'assistant', content: 'All done! <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: `loop-sid-${String(callCount)}`, cost: 0.002 };
      }
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-loop-cost',
        nodes: [
          {
            id: 'my-loop',
            loop: { prompt: 'Work.', until: 'COMPLETE', max_iterations: 5 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // 3 iterations: 0.001 + 0.001 + 0.002 = 0.004
    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0.004 });
  });

  it('persists total_cost_usd: 0 and node cost_usd: 0 when provider reports cost 0', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'free' };
      yield { type: 'result', sessionId: 'sid-zero-cost', cost: 0 };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-zero-cost', nodes: [{ id: 'step', prompt: 'Do free thing.' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0 });

    const completed = (store.createWorkflowEvent as Mock).mock.calls.find((c: unknown[]) => {
      const ev = c[0] as { event_type: string; step_name?: string | null };
      return ev.event_type === 'node_completed' && ev.step_name === 'step';
    }) as [{ data?: { cost_usd?: number } }] | undefined;
    expect(completed?.[0]?.data?.cost_usd).toBe(0);
  });

  it('still omits total_cost_usd when provider never yields cost (even after zero-cost path exists)', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'no cost field' };
      yield { type: 'result', sessionId: 'sid-absent-cost' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      { name: 'dag-absent-cost', nodes: [{ id: 'step', prompt: 'No cost.' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls[0][1]).not.toHaveProperty('total_cost_usd');

    const completed = (store.createWorkflowEvent as Mock).mock.calls.find((c: unknown[]) => {
      const ev = c[0] as { event_type: string; step_name?: string | null };
      return ev.event_type === 'node_completed' && ev.step_name === 'step';
    }) as [{ data?: Record<string, unknown> }] | undefined;
    expect(completed?.[0]?.data).not.toHaveProperty('cost_usd');
  });

  it('sums zeros across sequential nodes without treating init zero as absent', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'z' };
      yield { type: 'result', sessionId: 'sid-z', cost: 0 };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-zero-multi',
        nodes: [
          { id: 'step1', prompt: 'A.' },
          { id: 'step2', prompt: 'B.', depends_on: ['step1'] },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0 });
  });

  it('accumulates loop iteration zeros into completeWorkflowRun total_cost_usd: 0', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount < 2) {
        yield { type: 'assistant', content: 'still free' };
        yield { type: 'result', sessionId: `loop-z-${String(callCount)}`, cost: 0 };
      } else {
        yield { type: 'assistant', content: 'done <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: `loop-z-${String(callCount)}`, cost: 0 };
      }
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'dag-loop-zero-cost',
        nodes: [
          {
            id: 'my-loop',
            loop: { prompt: 'Work free.', until: 'COMPLETE', max_iterations: 5 },
          },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0 });

    const completed = (store.createWorkflowEvent as Mock).mock.calls.find((c: unknown[]) => {
      const ev = c[0] as { event_type: string; step_name?: string | null };
      return ev.event_type === 'node_completed' && ev.step_name === 'my-loop';
    }) as [{ data?: { cost_usd?: number } }] | undefined;
    expect(completed?.[0]?.data?.cost_usd).toBe(0);
  });
});

describe('executeDagWorkflow -- script nodes', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-script-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });

    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('inline bun script executes and captures stdout', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-test-run-id', {
      workflow_name: 'script-test',
      conversation_id: 'conv-script',
      user_message: 'script test message',
    });

    const scriptNode: ScriptNode = {
      id: 'inline-bun',
      script: 'console.log("hello from bun")',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-script',
      testDir,
      { name: 'script-inline-bun-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Script node should NOT invoke AI client
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('inline bun script output available for downstream substitution', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-test-run-id', {
      workflow_name: 'script-test',
      conversation_id: 'conv-script',
      user_message: 'script test message',
    });

    // Write a command file for the downstream AI node
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'use-result.md'), 'Use: $compute.output');

    const nodes: DagNode[] = [
      { id: 'compute', script: 'console.log("42")', runtime: 'bun' },
      { id: 'use', command: 'use-result', depends_on: ['compute'] },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-script',
      testDir,
      { name: 'script-subst-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // AI client called for the downstream AI node
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const prompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(prompt).toContain('42');
  });

  it('inline uv script executes and captures stdout', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-uv-run-id', {
      workflow_name: 'script-uv-test',
      conversation_id: 'conv-script-uv',
      user_message: 'uv test message',
    });

    const scriptNode: ScriptNode = {
      id: 'inline-uv',
      script: 'print("hello from python")',
      runtime: 'uv',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-script-uv',
      testDir,
      { name: 'script-inline-uv-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Script node should NOT invoke AI client
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('named bun script executes from .archon/scripts/', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-named-run-id', {
      workflow_name: 'script-named-test',
      conversation_id: 'conv-named',
      user_message: 'named test',
    });

    // Create a named script
    const scriptsDir = join(testDir, '.archon', 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(scriptsDir, 'greet.ts'), 'console.log("named script output")');

    const scriptNode: ScriptNode = {
      id: 'run-greet',
      script: 'greet',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-named',
      testDir,
      { name: 'named-script-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('non-zero exit code results in failed state', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-fail-run-id', {
      workflow_name: 'script-fail-test',
      conversation_id: 'conv-fail',
      user_message: 'fail test',
    });

    const scriptNode: ScriptNode = {
      id: 'fail-script',
      script: 'process.exit(1)',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-fail',
      testDir,
      { name: 'script-fail-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const failMsg = messages.find((m: string) => m.includes('failed') && m.includes('fail-script'));
    expect(failMsg).toBeDefined();
  });

  it('failure message strips the "Command failed: bun -e <body>" prefix and stays small', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-1389-run-id', {
      workflow_name: 'script-1389',
      conversation_id: 'conv-1389s',
      user_message: 'test',
    });

    // 500 × 7 chars = 3.5 KB — larger than SUBPROCESS_ERROR_MAX_CHARS (2 KB),
    // so any leak of the full script body via err.message would violate the length
    // assertion below. Block-comment padding (no newlines) avoids Windows execFile
    // arg truncation at \n that would cause bun to exit 0 on the comment-only prefix.
    const paddingAboveMax = '/* p */'.repeat(500);
    const scriptNode: ScriptNode = {
      id: 'fail-script-1389',
      script: `${paddingAboveMax} this is not valid javascript`,
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-1389s',
      testDir,
      { name: 'script-1389', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'fail-script-1389'
    );
    expect(failedEvent).toBeDefined();
    const errorMsg = (failedEvent![0] as { data: { error: string } }).data.error;
    expect(errorMsg).toContain("Script node 'fail-script-1389' failed");
    expect(errorMsg).not.toContain('Command failed:');
    expect(errorMsg).not.toContain('padding line padding line padding line');
    // 2 KB diagnostic cap + label prefix + truncation marker should stay under
    // 2.1 KB. Bumping SUBPROCESS_ERROR_MAX_CHARS would trip this.
    expect(errorMsg.length).toBeLessThan(2100);
    // Bun emits `error: <description>\n    at [eval]:L:C` for parse failures —
    // the location marker is the strongest signal that the diagnostic survived.
    expect(errorMsg).toContain('[eval]');
  });

  it('timeout kills subprocess', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-timeout-run-id', {
      workflow_name: 'script-timeout-test',
      conversation_id: 'conv-timeout',
      user_message: 'timeout test',
    });

    const scriptNode: ScriptNode = {
      id: 'slow-script',
      // Bun inline script that sleeps longer than the timeout
      script: 'await new Promise(r => setTimeout(r, 30000))',
      runtime: 'bun',
      timeout: 500,
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-timeout',
      testDir,
      { name: 'script-timeout-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    // Workflow fails because the only node failed (timeout)
    const failMsg = messages.find((m: string) => m.includes('failed') && m.includes('slow-script'));
    expect(failMsg).toBeDefined();
  }, 10000);

  it('stderr output is sent to the user', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-stderr-run-id', {
      workflow_name: 'script-stderr-test',
      conversation_id: 'conv-stderr',
      user_message: 'stderr test',
    });

    const scriptNode: ScriptNode = {
      id: 'stderr-script',
      // Write to both stderr and stdout
      script: 'process.stderr.write("error detail\\n"); console.log("done")',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-stderr',
      testDir,
      { name: 'script-stderr-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const stderrMsg = messages.find((m: string) => m.includes('error detail'));
    expect(stderrMsg).toBeDefined();
    expect(stderrMsg).toContain('stderr-script');
  });

  it('$WORKFLOW_ID and $ARTIFACTS_DIR are substituted into script text', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('wf-subst-run-id', {
      workflow_name: 'script-subst-test',
      conversation_id: 'conv-subst',
      user_message: 'subst test',
    });

    const artifactsDir = join(testDir, 'artifacts');

    // Write a downstream command so we can inspect the substituted prompt
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'check-output.md'), 'Got: $script-out.output');

    const nodes: DagNode[] = [
      {
        id: 'script-out',
        // Print system variables after substitution so the downstream prompt can inspect them.
        script: 'console.log("id=$WORKFLOW_ID artifacts=$ARTIFACTS_DIR remote=$PR_REMOTE")',
        runtime: 'bun',
      },
      { id: 'check', command: 'check-output', depends_on: ['script-out'] },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-subst',
      testDir,
      { name: 'script-subst-vars', nodes },
      workflowRun,
      'claude',
      undefined,
      artifactsDir,
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, prRemote: 'upstream' }
    );

    // The downstream AI node should have received the substituted output
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const prompt = mockSendQueryDag.mock.calls[0][0] as string;
    // The script output should contain the actual run ID (not the literal variable name)
    expect(prompt).toContain('wf-subst-run-id');
    expect(prompt).toContain('remote=upstream');
    expect(prompt).not.toContain('$WORKFLOW_ID');
    expect(prompt).not.toContain('$PR_REMOTE');
  });

  it('STATE_DIR reaches script and bash subprocesses as an env var, not just as text', async () => {
    // The textual `$STATE_DIR` path is protected by the fail-fast in
    // executor-shared (referenced-but-unresolved throws). The ENV-BAG path is
    // not: a dropped `STATE_DIR: stateDir` beside `ARTIFACTS_DIR` would be
    // silent, since a node reading `process.env.STATE_DIR` would just see
    // undefined. This locks both delivery channels.
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('wf-statedir-env', {
      workflow_name: 'state-dir-env-test',
      conversation_id: 'conv-statedir',
      user_message: 'state dir env test',
    });

    const stateDir = join(testDir, 'state');
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, 'check-state.md'),
      'script=$from-script.output bash=$from-bash.output'
    );

    const nodes: DagNode[] = [
      // Both read the ENV var and neither contains the literal `$STATE_DIR`, so
      // the textual substitution path cannot make this pass. `${STATE_DIR}` in
      // the bash body survives substitution (the engine replaces the exact
      // string `$STATE_DIR`) and is expanded by the shell from the env bag —
      // which also keeps a Windows path out of the script text entirely.
      { id: 'from-script', script: 'console.log(process.env.STATE_DIR)', runtime: 'bun' },
      { id: 'from-bash', bash: 'printf %s "${STATE_DIR}"' },
      { id: 'check', command: 'check-state', depends_on: ['from-script', 'from-bash'] },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-statedir',
      testDir,
      { name: 'state-dir-env', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      stateDir,
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const prompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(prompt).toContain(`script=${stateDir}`);
    expect(prompt).toContain(`bash=${stateDir}`);
  });

  it('WORKFLOW_ID reaches script and bash subprocesses as an env var, not just as text', async () => {
    // $WORKFLOW_ID substitutes into the body, so a node that spells it inline
    // always worked. A heredoc'd python/node block reads os.environ instead,
    // and found WORKFLOW_ID missing while ARTIFACTS_DIR/STATE_DIR/LOG_DIR beside
    // it were all present — an inconsistency that fails only at runtime, inside
    // the nested interpreter, with a bare KeyError.
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const runId = 'wf-workflowid-env';
    const workflowRun = makeWorkflowRun(runId, {
      workflow_name: 'workflow-id-env-test',
      conversation_id: 'conv-wfid',
      user_message: 'workflow id env test',
    });

    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, 'check-wfid.md'),
      'script=$from-script.output bash=$from-bash.output'
    );

    const nodes: DagNode[] = [
      // Neither body contains the literal `$WORKFLOW_ID`, so the textual
      // substitution path cannot make this pass — only the env bag can.
      { id: 'from-script', script: 'console.log(process.env.WORKFLOW_ID)', runtime: 'bun' },
      { id: 'from-bash', bash: 'printf %s "${WORKFLOW_ID}"' },
      { id: 'check', command: 'check-wfid', depends_on: ['from-script', 'from-bash'] },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-wfid',
      testDir,
      { name: 'workflow-id-env', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const prompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(prompt).toContain(`script=${runId}`);
    expect(prompt).toContain(`bash=${runId}`);
  });

  it('named script not found at runtime results in failed state and platform message', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-notfound-run-id', {
      workflow_name: 'script-notfound-test',
      conversation_id: 'conv-notfound',
      user_message: 'notfound test',
    });

    // Do NOT create .archon/scripts/missing.ts — the script should fail to resolve
    const scriptNode: ScriptNode = {
      id: 'gone-script',
      script: 'missing',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-notfound',
      testDir,
      { name: 'script-notfound-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const notFoundMsg = messages.find((m: string) => m.includes('not found in .archon/scripts/'));
    expect(notFoundMsg).toBeDefined();
  });

  it('bun script node does not leak repo .env from execution cwd (#1135)', async () => {
    // Regression test: place a .env with a marker in the execution cwd.
    // The bun script must NOT see it because --no-env-file is passed.
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('env-leak-run-id', {
      workflow_name: 'env-leak-test',
      conversation_id: 'conv-env-leak',
      user_message: 'env leak test',
    });

    // Write a .env with a marker in the script execution cwd
    await writeFile(join(testDir, '.env'), 'LEAKED_REPO_SECRET=should_not_appear\n');

    const scriptNode: ScriptNode = {
      id: 'env-check',
      script: 'console.log(process.env.LEAKED_REPO_SECRET ?? "CLEAN")',
      runtime: 'bun',
    };

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-env-leak',
      testDir,
      { name: 'env-leak-test', nodes: [scriptNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The node output should be "CLEAN" — the repo .env was not loaded
    const eventCalls = (mockDeps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const completedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string }).event_type === 'node_completed' &&
        (call[0] as { step_name: string }).step_name === 'env-check'
    );
    expect(completedEvent).toBeDefined();
    expect((completedEvent![0] as { data: { node_output: string } }).data.node_output).toBe(
      'CLEAN'
    );
  });

  it('passes config.envVars to script subprocesses', async () => {
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('script-env-run-id');

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-script-env',
      testDir,
      {
        name: 'script-env-test',
        nodes: [{ id: 'inline-bun', script: 'console.log("ok")', runtime: 'bun' }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, prRemote: 'upstream', envVars: { MY_SECRET: 'abc123' } }
    );

    expect(execSpy).toHaveBeenCalledWith(
      'bun',
      ['--no-env-file', '-e', 'console.log("ok")'],
      expect.objectContaining({
        env: expect.objectContaining({ MY_SECRET: 'abc123', PR_REMOTE: 'upstream' }),
      })
    );
    execSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// MCP plugin-noise filtering helpers
// ---------------------------------------------------------------------------

describe('parseMcpFailureServerNames', () => {
  it('extracts entries (name + segment) from a well-formed message', async () => {
    const { parseMcpFailureServerNames } = await import('./dag-executor');
    const entries = parseMcpFailureServerNames(
      'MCP server connection failed: telegram (disconnected), github (timeout)'
    );
    expect(entries).toEqual([
      { name: 'telegram', segment: 'telegram (disconnected)' },
      { name: 'github', segment: 'github (timeout)' },
    ]);
  });

  it('returns empty array for unrelated messages', async () => {
    const { parseMcpFailureServerNames } = await import('./dag-executor');
    expect(parseMcpFailureServerNames('⚠️ Something else')).toEqual([]);
    expect(parseMcpFailureServerNames('')).toEqual([]);
  });

  it('deduplicates repeated entries (first segment wins)', async () => {
    const { parseMcpFailureServerNames } = await import('./dag-executor');
    const entries = parseMcpFailureServerNames(
      'MCP server connection failed: foo (a), foo (b), bar (c)'
    );
    expect(entries).toEqual([
      { name: 'foo', segment: 'foo (a)' },
      { name: 'bar', segment: 'bar (c)' },
    ]);
  });

  it('handles a single entry without status parens gracefully', async () => {
    const { parseMcpFailureServerNames } = await import('./dag-executor');
    expect(parseMcpFailureServerNames('MCP server connection failed: solo')).toEqual([
      { name: 'solo', segment: 'solo' },
    ]);
  });

  it('drops empty segments from trailing/leading commas', async () => {
    const { parseMcpFailureServerNames } = await import('./dag-executor');
    expect(parseMcpFailureServerNames('MCP server connection failed: a (x), , b (y)')).toEqual([
      { name: 'a', segment: 'a (x)' },
      { name: 'b', segment: 'b (y)' },
    ]);
  });
});

describe('loadConfiguredMcpServerNames', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mcp-names-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty set when nodeMcpPath is undefined', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    const names = await loadConfiguredMcpServerNames(undefined, testDir);
    expect(names.size).toBe(0);
  });

  it('returns server names for a valid JSON config (relative path)', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    await writeFile(
      join(testDir, 'mcp.json'),
      JSON.stringify({ foo: { command: 'x' }, bar: { command: 'y' } })
    );
    const names = await loadConfiguredMcpServerNames('mcp.json', testDir);
    expect([...names].sort()).toEqual(['bar', 'foo']);
  });

  it('returns server names for an absolute path', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    const absolutePath = join(testDir, 'abs.json');
    await writeFile(absolutePath, JSON.stringify({ baz: {} }));
    const names = await loadConfiguredMcpServerNames(absolutePath, '/nonexistent/cwd');
    expect([...names]).toEqual(['baz']);
  });

  it('returns empty set when file is missing (no crash)', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    const names = await loadConfiguredMcpServerNames('missing.json', testDir);
    expect(names.size).toBe(0);
  });

  it('returns empty set for invalid JSON (provider surfaces its own error)', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    await writeFile(join(testDir, 'broken.json'), '{ not-json');
    const names = await loadConfiguredMcpServerNames('broken.json', testDir);
    expect(names.size).toBe(0);
  });

  it('returns empty set when JSON is an array (not an object of servers)', async () => {
    const { loadConfiguredMcpServerNames } = await import('./dag-executor');
    await writeFile(join(testDir, 'arr.json'), '["foo","bar"]');
    const names = await loadConfiguredMcpServerNames('arr.json', testDir);
    expect(names.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MCP plugin-noise filtering — end-to-end through executeDagWorkflow
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- MCP failure filtering', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-mcp-filter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'cmd prompt');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function runWithSystemChunk(
    systemContent: string,
    nodeMcpPath?: string
  ): Promise<IWorkflowPlatform> {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'system', content: systemContent };
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess' };
    });

    const platform = createMockPlatform();
    await executeDagWorkflow(
      createMockDeps(),
      platform,
      'conv-mcp-filter',
      testDir,
      {
        name: 'mcp-filter-test',
        nodes: [{ id: 'review', command: 'my-cmd', ...(nodeMcpPath ? { mcp: nodeMcpPath } : {}) }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
    return platform;
  }

  function mcpMessages(platform: IWorkflowPlatform): string[] {
    const calls = (platform.sendMessage as Mock<typeof platform.sendMessage>).mock.calls;
    return calls
      .map(c => c[1] as string)
      .filter(m => m.startsWith('MCP server connection failed:') || m.startsWith('⚠️'));
  }

  it('forwards only workflow-configured failures and preserves status detail', async () => {
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify({ 'workflow-server': {} }));
    const platform = await runWithSystemChunk(
      'MCP server connection failed: workflow-server (timeout), telegram (disconnected)',
      'mcp.json'
    );

    const sent = mcpMessages(platform);
    expect(sent).toEqual(['MCP server connection failed: workflow-server (timeout)']);
  });

  it('suppresses MCP message entirely when all failures are user plugins', async () => {
    await writeFile(join(testDir, 'mcp.json'), JSON.stringify({ 'workflow-server': {} }));
    const platform = await runWithSystemChunk(
      'MCP server connection failed: telegram (disconnected), notion (timeout)',
      'mcp.json'
    );

    expect(mcpMessages(platform)).toEqual([]);
  });

  it('suppresses everything when node has no mcp: config (all failures are plugin noise)', async () => {
    const platform = await runWithSystemChunk(
      'MCP server connection failed: telegram (disconnected)'
    );

    expect(mcpMessages(platform)).toEqual([]);
  });

  it('forwards ⚠️ provider warnings verbatim', async () => {
    const platform = await runWithSystemChunk('⚠️ Haiku does not support MCP');

    expect(mcpMessages(platform)).toEqual(['⚠️ Haiku does not support MCP']);
  });
});

// ---------------------------------------------------------------------------
// Streaming cancel-check policy (during-streaming paused tolerance)
// ---------------------------------------------------------------------------

describe('shouldContinueStreamingForStatus', () => {
  it('continues when status is running', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('running')).toBe(true);
  });

  it('continues when status is paused (sibling approval node in same layer)', async () => {
    // The key invariant: a concurrent approval node can pause the run while a
    // streaming AI node is mid-response. The streaming node must finish its
    // own output — workflow progression is gated by the approval node, not
    // by tearing down unrelated in-flight streams.
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('paused')).toBe(true);
  });

  it('aborts when status is null (run deleted)', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus(null)).toBe(false);
  });

  it('aborts when status is cancelled', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('cancelled')).toBe(false);
  });

  it('aborts when status is failed', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('failed')).toBe(false);
  });

  it('aborts when status is completed', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('completed')).toBe(false);
  });

  it('aborts on any unrecognized state', async () => {
    const { shouldContinueStreamingForStatus } = await import('./dag-executor');
    expect(shouldContinueStreamingForStatus('pending')).toBe(false);
    expect(shouldContinueStreamingForStatus('invalid-status')).toBe(false);
  });
});

describe('executeDagWorkflow -- final status derivation', () => {
  // Invariant: if ANY non-skipped node has failed status, the run must be
  // marked 'failed' — never 'completed' — regardless of how many other nodes
  // succeeded. This covers the anyFailed branch in executeDagWorkflow
  // (dag-executor.ts ~line 2956), which had no direct test coverage.
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'DAG AI response' };
      yield { type: 'result', sessionId: 'dag-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('one success + one independent failure -> failWorkflowRun, not completeWorkflowRun', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-status-run-1');

    const nodes: DagNode[] = [
      { id: 'pass', bash: 'echo ok' } as BashNode,
      { id: 'fail', bash: 'exit 1' } as BashNode,
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-status',
      testDir,
      { name: 'status-test', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect(mockStore.failWorkflowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('fail')
    );

    // Confirm the failure message names the failing node
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const failMsg = messages.find((m: string) => m.includes('completed with failures'));
    expect(failMsg).toBeDefined();
  });

  it('multiple successes + one failure -> failWorkflowRun, not completeWorkflowRun', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-status-run-2');

    const nodes: DagNode[] = [
      { id: 'a', bash: 'echo a' } as BashNode,
      { id: 'b', bash: 'echo b' } as BashNode,
      { id: 'c', bash: 'echo c' } as BashNode,
      { id: 'fail', bash: 'exit 1' } as BashNode,
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-status',
      testDir,
      { name: 'status-test-multi', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect(mockStore.failWorkflowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('fail')
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const failMsg = messages.find((m: string) => m.includes('completed with failures'));
    expect(failMsg).toBeDefined();
  });

  it('trigger_rule: none_failed skips dependent node + anyFailed still marks run failed', async () => {
    const mockStore = createMockStore();
    const mockDeps = createMockDeps(mockStore);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-status-run-3');

    // Layer 1: A and B run in parallel. B fails.
    // Layer 2: C depends on B with trigger_rule: none_failed — so C is skipped.
    // Expected: anyFailed=true (from B), so run must be marked failed even though C is only skipped.
    const nodes: DagNode[] = [
      { id: 'a', bash: 'echo a' } as BashNode,
      { id: 'b', bash: 'exit 1' } as BashNode,
      { id: 'c', bash: 'echo c', depends_on: ['b'], trigger_rule: 'none_failed' } as BashNode,
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-status',
      testDir,
      { name: 'status-test-skip', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect(mockStore.failWorkflowRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('b')
    );
  });
});

describe('executeDagWorkflow -- evidence gate (#2230)', () => {
  // Thin terminal-success gate: when the workflow declares
  // `evidence_policy.required: true`, the executor refuses terminal `completed`
  // unless `$ARTIFACTS_DIR/evidence.json` exists. Presence check ONLY — the
  // workflow's own bash/script nodes compute what counts as evidence.
  let testDir: string;
  let artifactsDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-evidence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    artifactsDir = join(testDir, 'artifacts');
    await mkdir(testDir, { recursive: true });
    mockCaptureWorkflowCompleted.mockClear();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function runEvidenceWorkflow(opts: {
    store: IWorkflowStore;
    platform: IWorkflowPlatform;
    evidencePolicy?: { required: boolean };
    priorCompletedNodes?: Map<string, string>;
  }): Promise<void> {
    const mockDeps = createMockDeps(opts.store);
    const workflowRun = makeWorkflowRun('dag-evidence-run');
    const nodes: DagNode[] = [{ id: 'work', bash: 'echo done' } as BashNode];

    await executeDagWorkflow(
      mockDeps,
      opts.platform,
      'conv-evidence',
      testDir,
      {
        name: 'evidence-test',
        nodes,
        ...(opts.evidencePolicy ? { evidence_policy: opts.evidencePolicy } : {}),
      },
      workflowRun,
      'claude',
      undefined,
      artifactsDir,
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      opts.priorCompletedNodes
    );
  }

  it('required: true + missing evidence.json -> failWorkflowRun with explicit reason, never completed', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
    });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    const failCall = (mockStore.failWorkflowRun as ReturnType<typeof mock>).mock
      .calls[0] as unknown[];
    expect(failCall[1] as string).toContain('evidence_policy.required');
    expect(failCall[1] as string).toContain(join(artifactsDir, 'evidence.json'));

    // The user-facing message says exactly why
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    expect(messages.some(m => m.includes('evidence_policy.required'))).toBe(true);
  });

  it('missing evidence writes a structured metadata.evidence_validation note', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
    });

    const updateCalls = (mockStore.updateWorkflowRun as ReturnType<typeof mock>).mock
      .calls as unknown[][];
    const metadataCall = updateCalls.find(call => {
      const updates = call[1] as { metadata?: Record<string, unknown> };
      return updates?.metadata?.evidence_validation !== undefined;
    });
    expect(metadataCall).toBeDefined();
    const note = (metadataCall?.[1] as { metadata: Record<string, unknown> }).metadata
      .evidence_validation as Record<string, unknown>;
    expect(note.status).toBe('missing');
    expect(note.policy).toBe('evidence_policy.required');
    expect(note.expected_path).toBe(join(artifactsDir, 'evidence.json'));
    expect(typeof note.checked_at).toBe('string');
  });

  it('missing evidence persists an evidence_validation_failed workflow event and telemetry exit reason', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
    });

    const eventCalls = (mockStore.createWorkflowEvent as ReturnType<typeof mock>).mock
      .calls as unknown[][];
    const evidenceEvent = eventCalls.find(
      call => (call[0] as { event_type: string }).event_type === 'evidence_validation_failed'
    );
    expect(evidenceEvent).toBeDefined();
    const eventData = (evidenceEvent?.[0] as { data: Record<string, unknown> }).data;
    expect(eventData.expected_path).toBe(join(artifactsDir, 'evidence.json'));

    const telemetryCalls = mockCaptureWorkflowCompleted.mock.calls as unknown[][];
    const lastTelemetry = telemetryCalls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastTelemetry.outcome).toBe('failed');
    expect(lastTelemetry.exitReason).toBe('evidence_missing');
  });

  it('required: true + evidence.json present -> completeWorkflowRun', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'evidence.json'), '{"proof": "landed"}');

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
    });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('no evidence_policy declared -> completes without checking for evidence.json', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({ store: mockStore, platform });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('required: false -> completes without checking for evidence.json', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: false },
    });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('resumed run (all nodes prior-completed) with evidence.json now present -> completes', async () => {
    // A run that failed the gate is resumed after evidence.json was produced:
    // every node is skipped as prior-completed, the executor re-enters the
    // completion path, and the gate now passes.
    const mockStore = createMockStore();
    const platform = createMockPlatform();
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'evidence.json'), '{"proof": "landed"}');

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
      priorCompletedNodes: new Map([['work', 'done']]),
    });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('resumed run without evidence.json -> fails the gate again', async () => {
    const mockStore = createMockStore();
    const platform = createMockPlatform();

    await runEvidenceWorkflow({
      store: mockStore,
      platform,
      evidencePolicy: { required: true },
      priorCompletedNodes: new Map([['work', 'done']]),
    });

    expect((mockStore.completeWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((mockStore.failWorkflowRun as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });
});

describe('provider resolution -- regression for #1610', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-provider-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();

    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'response' };
      yield { type: 'result', sessionId: 'session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('node with no provider annotation routes to workflowProvider (codex), not to model-implied provider', async () => {
    // Regression: a node with model: opus[1m] but no provider: must route to
    // workflowProvider ('codex' when defaultAssistant: codex), not to 'claude'.
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-provider',
      testDir,
      // Node has model: opus[1m] but NO provider: — must inherit workflowProvider
      {
        name: 'provider-regression',
        nodes: [{ id: 'implement', command: 'my-cmd', model: 'opus[1m]' }],
      },
      workflowRun,
      'codex', // workflowProvider (simulates defaultAssistant: codex)
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    // getAgentProvider must have been called with 'codex', not 'claude'
    expect(mockGetAgentProviderDag).toHaveBeenCalledWith('codex');
    expect(mockGetAgentProviderDag).not.toHaveBeenCalledWith('claude');
  });

  it('node with explicit provider: claude routes to claude even when workflowProvider is codex', async () => {
    // When provider: claude is set on the node, it must override workflowProvider.
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-provider',
      testDir,
      // Node has both model: opus[1m] AND provider: claude
      {
        name: 'provider-explicit',
        nodes: [{ id: 'implement', command: 'my-cmd', model: 'opus[1m]', provider: 'claude' }],
      },
      workflowRun,
      'codex', // workflowProvider
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    // getAgentProvider must have been called with 'claude'
    expect(mockGetAgentProviderDag).toHaveBeenCalledWith('claude');
  });
});

describe('bundled opus nodes -- provider annotation invariant (#1610)', () => {
  it('every bundled node with an opus model has provider: claude at the node or workflow level', async () => {
    // Annotation-only invariant: parse raw YAML (same approach as bundled-defaults.test).
    // Do NOT use parseWorkflow here — loader structural/provider errors are unrelated to
    // the opus provider annotation contract and must not disable this scan (#1610).
    // Malformed YAML throws from Bun.YAML.parse (no silent skip).
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const defaultsDir = join(repoRoot, '.archon', 'workflows', 'defaults');

    const { readdir, readFile: readFileFs } = await import('fs/promises');
    const files = (await readdir(defaultsDir)).filter(f => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);

    let opusNodesScanned = 0;
    for (const file of files) {
      const src = await readFileFs(join(defaultsDir, file), 'utf-8');
      const wf = Bun.YAML.parse(src) as {
        provider?: string;
        nodes?: Array<{ id?: string; model?: string; provider?: string }>;
      };
      if (!wf || typeof wf !== 'object' || !Array.isArray(wf.nodes)) continue;

      const workflowProvider = wf.provider;
      for (const n of wf.nodes) {
        const nodeModel = n.model;
        if (!nodeModel || !nodeModel.toLowerCase().includes('opus')) continue;

        opusNodesScanned += 1;
        const nodeProvider = n.provider;
        const hasExplicitClaude = nodeProvider === 'claude' || workflowProvider === 'claude';
        expect(hasExplicitClaude).toBe(true);
        if (!hasExplicitClaude) {
          throw new Error(
            `${file}: node '${n.id ?? '?'}' has model '${nodeModel}' but no provider: claude at node or workflow level`
          );
        }
      }
    }
    expect(opusNodesScanned).toBeGreaterThan(0);
  });
});

describe('executeDagWorkflow -- typed artifacts (output_type)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-typed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'AI response' };
      yield { type: 'result', sessionId: 'new-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('node with output_type writes nodes/<id>.md + .meta.json with the declared type', async () => {
    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'typed-test',
        nodes: [{ id: 'planner', command: 'my-cmd', output_type: 'plan' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const body = await readFile(join(testDir, 'artifacts', 'nodes', 'planner.md'), 'utf8');
    expect(body).toBe('AI response');
    const meta = JSON.parse(
      await readFile(join(testDir, 'artifacts', 'nodes', 'planner.meta.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(meta).toMatchObject({
      nodeId: 'planner',
      outputType: 'plan',
      runId: 'dag-test-run-id',
      path: join('nodes', 'planner.md'),
      // sessionId is propagated from the node output into the metadata.
      sessionId: 'new-session-id',
    });
    expect(typeof meta.producedAt).toBe('string');
  });

  it('bash node with output_type writes a sidecar with no sessionId', async () => {
    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'bash-typed',
        nodes: [{ id: 'metrics', bash: 'echo "result-data"', output_type: 'metrics' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const body = await readFile(join(testDir, 'artifacts', 'nodes', 'metrics.md'), 'utf8');
    expect(body).toContain('result-data');
    const meta = JSON.parse(
      await readFile(join(testDir, 'artifacts', 'nodes', 'metrics.meta.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(meta).toMatchObject({ nodeId: 'metrics', outputType: 'metrics' });
    // Bash nodes have no provider session — the field is omitted, not null.
    expect('sessionId' in meta).toBe(false);
    // Bash node does not invoke the AI client.
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('artifact write failure is non-fatal — the node still completes', async () => {
    // Force writeNodeArtifact to throw by putting a FILE where the nodes/ dir must
    // go, so its mkdir fails. The node must still complete (best-effort write).
    const artifactsDir = join(testDir, 'artifacts');
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'nodes'), 'not a directory', 'utf8');

    // Resolves without throwing — the best-effort catch swallows the write failure.
    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'typed-fail',
        nodes: [{ id: 'planner', command: 'my-cmd', output_type: 'plan' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      artifactsDir,
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The node executed despite the artifact write being impossible.
    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
  });

  it('node without output_type writes no sidecar artifact', async () => {
    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'untyped-test',
        nodes: [{ id: 'planner', command: 'my-cmd' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    let wrote = true;
    try {
      await readFile(join(testDir, 'artifacts', 'nodes', 'planner.md'), 'utf8');
    } catch {
      wrote = false;
    }
    expect(wrote).toBe(false);
  });
});

describe('executeDagWorkflow -- persist_session', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'My command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'AI response' };
      yield { type: 'result', sessionId: 'new-session-id' };
    });
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('persist_session: true with no prior row → fresh resumeSessionId, upsert on completion', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const getMock = store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>;
    const upsertMock = store.upsertWorkflowNodeSession as Mock<
      typeof store.upsertWorkflowNodeSession
    >;
    expect(getMock).toHaveBeenCalledWith({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
    });

    const resumeSessionArg = mockSendQueryDag.mock.calls[0][2];
    expect(resumeSessionArg).toBeUndefined();

    expect(upsertMock).toHaveBeenCalledWith({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'new-session-id',
      last_run_id: 'dag-test-run-id',
    });
  });

  it('persist_session: true with prior row → resumeSessionId loaded, upsert with new id', async () => {
    const store = createMockStore();
    (store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>).mockResolvedValue({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'prior-session-id',
      last_run_id: 'prior-run',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    });
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls[0][2]).toBe('prior-session-id');
    // A warm resume (resumed not false) runs the node exactly once — never replayed.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const upsertMock = store.upsertWorkflowNodeSession as Mock<
      typeof store.upsertWorkflowNodeSession
    >;
    expect(upsertMock.mock.calls[0][0]).toEqual({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'new-session-id',
      last_run_id: 'dag-test-run-id',
    });
  });

  it('persist_session resume returns cold (resumed:false) → surfaced to user, no re-run, fresh id persisted', async () => {
    const store = createMockStore();
    (store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>).mockResolvedValue({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'prior-session-id',
      last_run_id: 'prior-run',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    });
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    mockSendQueryDag.mockClear();
    // The provider could not resume the prior session and ran cold (already a
    // clean fresh session). The executor must keep this run, not re-run it.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'cold run' };
      yield { type: 'result', sessionId: 'cold-id', resumed: false };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Ran exactly once — a cold resume is NOT replayed (the cold run is already fresh).
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(mockSendQueryDag.mock.calls[0][2]).toBe('prior-session-id');
    // The cold resume was surfaced to the user — never silent.
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map(c => String(c[1]));
    expect(messages.some(m => m.includes('could not resume the prior session'))).toBe(true);
    // The cold run's own fresh session id is what gets persisted for next time.
    const upsertMock = store.upsertWorkflowNodeSession as Mock<
      typeof store.upsertWorkflowNodeSession
    >;
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ provider_session_id: 'cold-id' });
  });

  // --- #1846: cross-invocation artifact scope + cold-resume pointer recovery ---

  /** Arm the mocks for a cold resume: a persisted prior session that the provider
   *  reports back as not resumed (fresh fallback). */
  function armColdResume(store: ReturnType<typeof createMockStore>): void {
    (store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>).mockResolvedValue({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'prior-session-id',
      last_run_id: 'prior-run',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    });
    mockSendQueryDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'cold run' };
      yield { type: 'result', sessionId: 'cold-id', resumed: false };
    });
  }

  it('cold resume with prior scope artifacts → warning carries a by-reference pointer', async () => {
    const scopeDir = join(testDir, 'scope-artifacts');
    // A PRIOR invocation left a typed artifact in the stable scope dir.
    await writeNodeArtifact(
      scopeDir,
      {
        nodeId: 'planner',
        outputType: 'plan',
        runId: 'prior-run',
        producedAt: '2026-05-01T00:00:00Z',
      },
      'the prior plan'
    );
    const store = createMockStore();
    armColdResume(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scopeDir
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map(c => String(c[1]));
    const coldMessage = messages.find(m => m.includes('could not resume the prior session'));
    expect(coldMessage).toBeDefined();
    // By reference: the message names the artifact file's path — never its content.
    expect(coldMessage).toContain('available for recovery');
    expect(coldMessage).toContain(join(scopeDir, 'nodes', 'planner.md'));
    expect(coldMessage).not.toContain('the prior plan');
    // The #1842 invariant holds: the cold run is kept, never replayed.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
  });

  it('cold resume with scope artifacts only from the CURRENT run → plain warning, no pointer', async () => {
    const scopeDir = join(testDir, 'scope-artifacts');
    // Only this run's own mirror exists — it recovers nothing.
    await writeNodeArtifact(
      scopeDir,
      {
        nodeId: 'planner',
        outputType: 'plan',
        runId: 'dag-test-run-id',
        producedAt: '2026-05-01T00:00:00Z',
      },
      'this run output'
    );
    const store = createMockStore();
    armColdResume(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scopeDir
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map(c => String(c[1]));
    expect(messages.some(m => m.includes('could not resume the prior session'))).toBe(true);
    expect(messages.some(m => m.includes('available for recovery'))).toBe(false);
  });

  it('cold resume with an empty/absent scope dir → plain warning, no pointer', async () => {
    const store = createMockStore();
    armColdResume(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      join(testDir, 'scope-artifacts-never-created')
    );

    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map(c => String(c[1]));
    expect(messages.some(m => m.includes('could not resume the prior session'))).toBe(true);
    expect(messages.some(m => m.includes('available for recovery'))).toBe(false);
  });

  it('persist node with output_type mirrors its typed sidecar into the scope dir', async () => {
    const scopeDir = join(testDir, 'scope-artifacts');

    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true, output_type: 'plan' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scopeDir
    );

    // Written to BOTH the per-run dir and the durable scope dir.
    const runCopy = await readFile(join(testDir, 'artifacts', 'nodes', 'planner.md'), 'utf8');
    const scopeCopy = await readFile(join(scopeDir, 'nodes', 'planner.md'), 'utf8');
    expect(runCopy).toBe('AI response');
    expect(scopeCopy).toBe('AI response');
    const scopeMeta = JSON.parse(
      await readFile(join(scopeDir, 'nodes', 'planner.meta.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(scopeMeta).toMatchObject({
      nodeId: 'planner',
      outputType: 'plan',
      runId: 'dag-test-run-id',
    });
  });

  it('non-persist node with output_type does NOT mirror into the scope dir', async () => {
    const scopeDir = join(testDir, 'scope-artifacts');

    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        // scope dir present (another node opted in), but THIS node doesn't persist.
        nodes: [{ id: 'planner', command: 'my-cmd', output_type: 'plan' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scopeDir
    );

    // Run-dir sidecar exists; the scope dir stays untouched.
    const runCopy = await readFile(join(testDir, 'artifacts', 'nodes', 'planner.md'), 'utf8');
    expect(runCopy).toBe('AI response');
    let scopeWrote = true;
    try {
      await readFile(join(scopeDir, 'nodes', 'planner.md'), 'utf8');
    } catch {
      scopeWrote = false;
    }
    expect(scopeWrote).toBe(false);
  });

  it('scope mirror write failure is non-fatal — node completes, run-dir sidecar intact', async () => {
    const scopeDir = join(testDir, 'scope-artifacts');
    // Force the scope write to fail: a FILE where the nodes/ dir must go.
    await mkdir(scopeDir, { recursive: true });
    await writeFile(join(scopeDir, 'nodes'), 'not a directory', 'utf8');

    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true, output_type: 'plan' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scopeDir
    );

    // Node ran and the run-dir sidecar was still written (mirror is best-effort).
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const runCopy = await readFile(join(testDir, 'artifacts', 'nodes', 'planner.md'), 'utf8');
    expect(runCopy).toBe('AI response');
  });

  it('persist_session: true but provider returns no sessionId → delete stale row', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'AI response' };
      yield { type: 'result' }; // no sessionId
    });
    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const upsertMock = store.upsertWorkflowNodeSession as Mock<
      typeof store.upsertWorkflowNodeSession
    >;
    const deleteMock = store.deleteWorkflowNodeSessions as Mock<
      typeof store.deleteWorkflowNodeSessions
    >;
    expect(upsertMock).not.toHaveBeenCalled();
    // Provider is included in the filter so a stale-row cleanup under provider B
    // does not wipe provider A's saved row for the same node.
    expect(deleteMock).toHaveBeenCalledWith({
      workflow_name: 'persist-test',
      scope_key: 'conv-dag',
      node_id: 'planner',
      provider: 'claude',
    });
  });

  it('persist_session unset → no store interaction', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'no-persist',
        nodes: [{ id: 'planner', command: 'my-cmd' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.getWorkflowNodeSession).not.toHaveBeenCalled();
    expect(store.upsertWorkflowNodeSession).not.toHaveBeenCalled();
    expect(store.deleteWorkflowNodeSessions).not.toHaveBeenCalled();
  });

  it('workflow.persist_sessions: true + node.persist_session: false → node opts out', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'wf-default-on',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: false }],
        persist_sessions: true,
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.getWorkflowNodeSession).not.toHaveBeenCalled();
    expect(store.upsertWorkflowNodeSession).not.toHaveBeenCalled();
  });

  it("node.context: 'fresh' bypasses persistence even when persist_session: true", async () => {
    const store = createMockStore();
    (store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>).mockResolvedValue({
      workflow_name: 'persist-test',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'prior-id',
      last_run_id: null,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    });
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true, context: 'fresh' }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.getWorkflowNodeSession).not.toHaveBeenCalled();
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    expect(store.upsertWorkflowNodeSession).not.toHaveBeenCalled();
  });

  it('persist_session: true on non-resume-capable provider → throws clear error', async () => {
    // Provider with sessionResume: false
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'no-resume',
      getCapabilities: () => ({
        ...mockClaudeCapabilities(),
        sessionResume: false,
      }),
    }));

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // executeDagWorkflow catches per-node errors and emits a failure message.
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const messages = sendMessage.mock.calls.map((call: unknown[]) => call[1] as string);
    const errMsg = messages.find(m => m.includes('persist_session') && m.includes('sessionResume'));
    expect(errMsg).toBeDefined();
    expect(store.upsertWorkflowNodeSession).not.toHaveBeenCalled();
  });

  it('workflow.persist_sessions: true + node unset → node inherits persistence', async () => {
    const store = createMockStore();
    const mockDeps = createMockDeps(store);

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'wf-inherit',
        nodes: [{ id: 'planner', command: 'my-cmd' }],
        persist_sessions: true,
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.getWorkflowNodeSession).toHaveBeenCalledWith({
      workflow_name: 'wf-inherit',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
    });
    const upsertMock = store.upsertWorkflowNodeSession as Mock<
      typeof store.upsertWorkflowNodeSession
    >;
    expect(upsertMock).toHaveBeenCalledWith({
      workflow_name: 'wf-inherit',
      node_id: 'planner',
      scope_key: 'conv-dag',
      provider: 'claude',
      provider_session_id: 'new-session-id',
      last_run_id: 'dag-test-run-id',
    });
  });

  it('persist_session lookup failure → node runs fresh and upserts (non-fatal)', async () => {
    const store = createMockStore();
    (store.getWorkflowNodeSession as Mock<typeof store.getWorkflowNodeSession>).mockRejectedValue(
      new Error('DB timeout')
    );
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Lookup threw → node still runs, with no resume session.
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    // The successful node still persists its new session id.
    expect(store.upsertWorkflowNodeSession).toHaveBeenCalled();
    // The user is warned the session could not be loaded.
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warned = sendMessage.mock.calls
      .map((call: unknown[]) => call[1] as string)
      .some(m => m.includes('persisted session') && m.includes('planner'));
    expect(warned).toBe(true);
  });

  it('persist_session upsert failure → node still completes and user is warned (non-fatal)', async () => {
    const store = createMockStore();
    (
      store.upsertWorkflowNodeSession as Mock<typeof store.upsertWorkflowNodeSession>
    ).mockRejectedValue(new Error('write error'));
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-dag',
      testDir,
      {
        name: 'persist-test',
        nodes: [{ id: 'planner', command: 'my-cmd', persist_session: true }],
      },
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Upsert threw, but the node executed (sendQuery ran) and the user was warned —
    // the failure did not abort the node.
    expect(mockSendQueryDag).toHaveBeenCalled();
    const sendMessage = platform.sendMessage as ReturnType<typeof mock>;
    const warned = sendMessage.mock.calls
      .map((call: unknown[]) => call[1] as string)
      .some(m => m.includes('Could not persist') && m.includes('planner'));
    expect(warned).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Completion telemetry
//
// captureWorkflowCompleted is mocked as a no-op; without these assertions a
// dropped call at any of the three terminal sites (success / partial-failure /
// no-nodes-completed) would be invisible. Each test clears the hoisted mock
// immediately before the run so the assertion is precise. `source: 'bundled'`
// is threaded as the final arg to also confirm it reaches the telemetry payload.
// ───────────────────────────────────────────────────────────────────────────
describe('executeDagWorkflow -- completion telemetry', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-tel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockCaptureWorkflowCompleted.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function runDag(workflow: { name: string; nodes: DagNode[] }): Promise<void> {
    await executeDagWorkflow(
      createMockDeps(createMockStore()),
      createMockPlatform(),
      'conv-dag',
      testDir,
      workflow,
      makeWorkflowRun(),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      'bundled'
    );
  }

  it('emits outcome=completed with node counts and the threaded source on success', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done' };
      yield { type: 'result', sessionId: 'sid-ok' };
    });

    await runDag({ name: 'dag-ok', nodes: [{ id: 'step', prompt: 'Do thing.' }] });

    // Exactly once — guards against the double-count risk the PR flagged.
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'completed',
        workflowSource: 'bundled',
        nodesCompleted: 1,
        nodesTotal: 1,
      })
    );
    // No node reported usage — the fields must be OMITTED, not sent as zero.
    const captured = mockCaptureWorkflowCompleted.mock.calls[0][0] as Record<string, unknown>;
    expect('costUsd' in captured).toBe(false);
    expect('tokensIn' in captured).toBe(false);
    expect('tokensOut' in captured).toBe(false);
    expect('loopIterations' in captured).toBe(false);
  });

  it('threads provider-reported cost and tokens into the completion telemetry', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done' };
      yield {
        type: 'result',
        sessionId: 'sid-usage',
        cost: 0.25,
        tokens: { input: 5000, output: 1200 },
      };
    });

    await runDag({ name: 'dag-usage', nodes: [{ id: 'step', prompt: 'Do thing.' }] });

    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'completed',
        costUsd: 0.25,
        tokensIn: 5000,
        tokensOut: 1200,
      })
    );
  });

  it('ignores non-finite token values without poisoning the run totals', async () => {
    let call = 0;
    mockSendQueryDag.mockImplementation(function* () {
      call++;
      yield { type: 'assistant', content: `ok ${call}` };
      if (call === 1) {
        // Misbehaving provider: NaN tokens must be ignored (and warned), not summed.
        yield { type: 'result', sessionId: 'sid-bad', tokens: { input: NaN, output: 100 } };
      } else {
        yield { type: 'result', sessionId: 'sid-good', tokens: { input: 700, output: 50 } };
      }
    });

    await runDag({
      name: 'dag-nan',
      nodes: [
        { id: 'node1', prompt: 'First.' },
        { id: 'node2', prompt: 'Second.', depends_on: ['node1'] },
      ],
    });

    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed', tokensIn: 700, tokensOut: 50 })
    );
  });

  it('emits outcome=failed exit_reason=no_nodes_completed when the only node fails', async () => {
    // A result chunk with no assistant text fails the node (see "produced no
    // assistant output" guard), leaving zero completed nodes.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'result', sessionId: 'sid-empty' };
    });

    await runDag({ name: 'dag-empty', nodes: [{ id: 'only', prompt: 'Do thing.' }] });

    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        workflowSource: 'bundled',
        exitReason: 'no_nodes_completed',
        // Failure taxonomy: "produced no assistant output" matches no fatal/
        // transient pattern → unknown; the failing node is a prompt node.
        errorClass: 'unknown',
        failedNodeType: 'prompt',
      })
    );
  });

  it('emits outcome=failed exit_reason=node_error when one node completes and another fails', async () => {
    // node2 depends on node1, so order is deterministic: node1 yields assistant
    // text (completes), node2 yields only a result (fails) → 1 completed, 1 failed.
    let call = 0;
    mockSendQueryDag.mockImplementation(function* () {
      call++;
      if (call === 1) {
        yield { type: 'assistant', content: 'first ok' };
        yield { type: 'result', sessionId: 'sid-1' };
      } else {
        yield { type: 'result', sessionId: 'sid-2' };
      }
    });

    await runDag({
      name: 'dag-partial',
      nodes: [
        { id: 'node1', prompt: 'First.' },
        { id: 'node2', prompt: 'Second.', depends_on: ['node1'] },
      ],
    });

    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        workflowSource: 'bundled',
        exitReason: 'node_error',
        errorClass: 'unknown',
        failedNodeType: 'prompt',
      })
    );
  });
});

describe('executeDagWorkflow -- loop_group node', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-loopgroup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('completes a loop_group when the until signal appears on iteration N', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: 'assistant', content: 'iteration 1 work, not done yet' };
      } else {
        yield { type: 'assistant', content: 'iteration 2 final result\nDONE' };
      }
      yield { type: 'result', sessionId: `lg-sess-${callCount}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-loopgroup-done');

    const nodes: DagNode[] = [
      {
        id: 'fixer',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work, emit DONE when finished', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'dag-loopgroup-done', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Two iterations: iter 1 (no signal) → iter 2 (DONE signal) → complete.
    expect(callCount).toBe(2);
    expect(result).toContain('iteration 2 final result');
  });

  it('forwards loop_group provider/model/tier to body node_started and sendQuery', async () => {
    // Group model/provider must reach body AI nodes (ordinary YAML and overlay).
    // node_started request fields must equal the pure resolution metadata row.
    mockSendQueryDag.mockImplementation(function* (
      _prompt: string,
      _sid: unknown,
      _cwd: unknown,
      opts: unknown
    ) {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 'lg-model-sid', resolvedModel: { id: 'opus-actual' } };
      void opts;
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const aiProfile = buildAiProfile('claude', {
      globalTiers: {
        large: { provider: 'claude', model: 'opus', effort: 'high' },
      },
    });

    const nodes: DagNode[] = [
      {
        id: 'top',
        prompt: 'outer',
        model: 'claude-haiku-4',
      },
      {
        id: 'grp',
        model: 'large',
        depends_on: ['top'],
        loop_group: {
          until: 'DONE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'body work' }],
        },
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg-model',
      testDir,
      { name: 'dag-loopgroup-model', nodes },
      makeWorkflowRun('dag-loopgroup-model'),
      'claude',
      'claude-sonnet-4',
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      aiProfile
    );
    const bodyCall = mockSendQueryDag.mock.calls.find(call => {
      // prompt is first arg
      return typeof call[0] === 'string' && (call[0] as string).includes('body work');
    });
    expect(bodyCall).toBeDefined();
    const bodyOpts = bodyCall?.[3] as SendQueryOptions;
    expect(bodyOpts.model).toBe('opus');

    const topCall = mockSendQueryDag.mock.calls.find(call => {
      return typeof call[0] === 'string' && (call[0] as string).includes('outer');
    });
    expect(topCall).toBeDefined();
    expect((topCall?.[3] as SendQueryOptions).model).toBe('claude-haiku-4');

    const events = (store.createWorkflowEvent as Mock).mock.calls.map(c => c[0]);
    const topStarted = events.find(
      (e: { event_type: string; step_name?: string }) =>
        e.event_type === 'node_started' && e.step_name === 'top'
    );
    const bodyStarted = events.find(
      (e: { event_type: string; step_name?: string }) =>
        e.event_type === 'node_started' && e.step_name === 'grp.body'
    );
    expect(topStarted?.data).toMatchObject({
      provider: 'claude',
      model: 'claude-haiku-4',
    });
    expect(bodyStarted?.data).toMatchObject({
      provider: 'claude',
      model: 'opus',
      tier: 'large',
      effort: 'high',
    });
    // Group container never gets a provider-turn node_started
    expect(
      events.some(
        (e: { event_type: string; step_name?: string }) =>
          e.event_type === 'node_started' && e.step_name === 'grp'
      )
    ).toBe(false);
  });

  it('runs a command-backed loop node inside a loop_group body with namespaced lifecycle events', async () => {
    // A `loop:` body node may use `loop.command` like any top-level loop. The
    // command body must reach the AI, and the loop's persisted lifecycle events
    // must carry the `<groupId>.<nodeId>` namespaced step_name (#2090).
    await writeFile(
      join(testDir, '.archon', 'commands', 'body-loop-cmd.md'),
      'Command-file body for the inner loop.'
    );
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'inner work done. <promise>INNER_DONE</promise>\nDONE' };
      yield { type: 'result', sessionId: 'lg-cmd-sess' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-loopgroup-cmd');

    const nodes: DagNode[] = [
      {
        id: 'grp',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            {
              id: 'inner-loop',
              loop: {
                command: 'body-loop-cmd',
                until: 'INNER_DONE',
                max_iterations: 2,
                fresh_context: false,
              },
              depends_on: [],
            } as unknown as DagNode,
          ],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'dag-loopgroup-cmd', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The command file's body (not a YAML inline prompt) reached the AI.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(mockSendQueryDag.mock.calls[0][0] as string).toContain(
      'Command-file body for the inner loop.'
    );
    // Inner-loop lifecycle events are namespaced under the group id.
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const innerStarted = eventCalls.filter(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).event_type === 'node_started' &&
        (call[0] as Record<string, unknown>).step_name === 'grp.inner-loop'
    );
    expect(innerStarted.length).toBeGreaterThanOrEqual(1);
  });

  it('delivers $LOOP_USER_INPUT to a resumed body script via env, never spliced into source (#2115)', async () => {
    // Resumed interactive group: the approval-gate free-text must reach the body script
    // as an env var, not as text interpolated into the executed TS source.
    const injection = '"); process.exit(1); //';
    const execSpy = spyOn(git, 'execFileAsync').mockResolvedValue({ stdout: 'DONE\n', stderr: '' });
    try {
      const mockDeps = createMockDeps();
      const platform = createMockPlatform();
      const workflowRun = makeWorkflowRun('lg-userinput-script', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'grp',
            iteration: 0,
            message: 'Review and provide feedback.',
          },
          loop_user_input: injection,
          loop_feedback_given: true,
        },
      });

      const nodes: DagNode[] = [
        {
          id: 'grp',
          loop_group: {
            until: 'DONE',
            max_iterations: 3,
            fresh_context: true,
            interactive: true,
            gate_message: 'Review and provide feedback.',
            nodes: [
              {
                id: 'emit',
                script: 'console.log("$LOOP_USER_INPUT"); console.log("DONE")',
                runtime: 'bun',
                depends_on: [],
              },
            ],
          },
          depends_on: [],
        },
      ];

      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-lg-userinput',
        testDir,
        { name: 'lg-userinput-script', nodes },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );

      const scriptCall = execSpy.mock.calls.find(
        c => (c[0] as string) === 'bun' && (c[1] as string[]).includes('-e')
      ) as [string, string[], { env: NodeJS.ProcessEnv }] | undefined;
      expect(scriptCall).toBeDefined();
      // Source is byte-identical to the author's body — the payload is not interpolated.
      expect(scriptCall?.[1][2]).toBe('console.log("$LOOP_USER_INPUT"); console.log("DONE")');
      expect(scriptCall?.[1][2]).not.toContain('process.exit');
      // The per-iteration feedback reaches the script through the environment.
      expect(scriptCall?.[2].env.LOOP_USER_INPUT).toBe(injection);
    } finally {
      execSpy.mockRestore();
    }
  });

  it('fails the loop_group when max_iterations is exceeded without the until signal', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      yield { type: 'assistant', content: `iteration ${callCount} work, still going` };
      yield { type: 'result', sessionId: `lg-sess-${callCount}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('dag-loopgroup-maxiter');

    const nodes: DagNode[] = [
      {
        id: 'fixer',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work, never emit DONE', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'dag-loopgroup-maxiter', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Exhausted max_iterations (3) with no signal → run failed, no terminal output.
    expect(callCount).toBe(3);
    expect(result).toBeUndefined();
  });

  it('INSTANCE 1: multi-node body (implement→test→review) completes on iteration 2', async () => {
    // The body has 3 nodes; only `review` is AI (calls sendQuery). implement+test are
    // bash. On iteration 1 review does NOT emit DONE; on iteration 2 it does.
    let reviewCalls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      reviewCalls++;
      const content =
        reviewCalls === 1 ? 'tests still failing, need another pass' : 'all tests green now\nDONE';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `review-sess-${reviewCalls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-multinode');

    const nodes: DagNode[] = [
      {
        id: 'fix-loop',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [
            { id: 'implement', bash: 'echo "editing files"', depends_on: [] },
            { id: 'test', bash: 'echo "running tests"', depends_on: ['implement'] },
            {
              id: 'review',
              prompt: 'Review the test results. Emit DONE only when all tests pass.',
              depends_on: ['test'],
            },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-multinode', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // 2 iterations (review called once per iteration); DONE on iteration 2.
    expect(reviewCalls).toBe(2);
    expect(result).toContain('all tests green now');
  });

  it('INSTANCE 2: $LOOP_PREV cross-iteration ref sees prior iteration output', async () => {
    // The body prompt references $LOOP_PREV.work.output. We assert the mock receives a
    // prompt that contains the PREVIOUS iteration's output on iteration 2+ (and empty
    // on iteration 1). Iteration 1 returns "iter-1-draft"; iteration 2's prompt must
    // contain "iter-1-draft" (carried via $LOOP_PREV), and iteration 2 emits DONE.
    let callCount = 0;
    const receivedPrompts: string[] = [];
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      callCount++;
      receivedPrompts.push(prompt ?? '');
      const content = callCount === 1 ? 'iter-1-draft' : 'iter-2-final\nDONE';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `s-${callCount}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-loopprev');

    const nodes: DagNode[] = [
      {
        id: 'draft-loop',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [
            {
              id: 'work',
              prompt: 'Previous draft:\n$LOOP_PREV.work.output\nImprove it. Emit DONE when final.',
              depends_on: [],
            },
          ],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-loopprev', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Iteration 1 prompt: $LOOP_PREV resolved to '' (no prior iteration).
    expect(callCount).toBeGreaterThanOrEqual(1);
    // The first prompt must NOT carry the prior output (there is none).
    expect(receivedPrompts[0]).not.toContain('iter-1-draft');
    // Iteration 2 prompt MUST carry iteration 1's output via $LOOP_PREV.
    expect(callCount).toBe(2);
    expect(receivedPrompts[1]).toContain('iter-1-draft');
  });

  it('INSTANCE 3: until_bash deterministic gate completes on exit 0', async () => {
    // No `until` signal from AI; completion is decided solely by until_bash exit code.
    // The body is a pure bash node that increments a counter file each iteration;
    // until_bash exits 0 once the counter reaches 2. No AI node → sendQuery unused.
    const counterFile = join(testDir, 'iter-counter');
    // The path is interpolated into REAL bash scripts: on Windows, join() yields
    // backslashes that bash strips as escapes. Use forward slashes + quoting so
    // the script is valid on every platform (git-bash accepts D:/-style paths).
    const counterRef = `"${counterFile.replace(/\\/g, '/')}"`;

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-untilbash');

    const nodes: DagNode[] = [
      {
        id: 'bash-loop',
        loop_group: {
          until: 'NEVER_EMITTED', // rely on until_bash, not the signal
          max_iterations: 5,
          fresh_context: false,
          until_bash: `test "$(cat ${counterRef} 2>/dev/null || echo 0)" -ge 2`,
          nodes: [
            {
              id: 'bump',
              bash: `n=$(cat ${counterRef} 2>/dev/null || echo 0); echo $((n+1)) > ${counterRef}; echo "iter $((n+1))"`,
              depends_on: [],
            },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-untilbash', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // until_bash exits 0 once the counter reaches 2 → completes after 2 iterations.
    // The counter file holds the final iteration count (2).
    const { readFile } = await import('fs/promises');
    const finalCount = parseInt((await readFile(counterFile, 'utf8')).trim(), 10);
    expect(finalCount).toBe(2);
    // The group's output is the terminal body node's (bump) last-iteration stdout.
    expect(result).toContain('iter 2');
  });

  it('INSTANCE 4: single-node body degenerates like loop: and completes in 1 iteration', async () => {
    // A loop_group with a single prompt node that emits DONE on the very first iteration.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: 'done immediately\nDONE' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-single');

    const nodes: DagNode[] = [
      {
        id: 'once',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'only', prompt: 'do it, emit DONE', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-single', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Single iteration, completed immediately.
    expect(calls).toBe(1);
    expect(result).toContain('done immediately');
  });

  // --- Edge cases ---

  it('EDGE A: a failed body node fails the group immediately with the real error', async () => {
    // A body node failure must NOT silently re-run the body until max_iterations —
    // that burns AI cost per iteration and buries the root cause under a generic
    // max-iterations message (the exact anti-pattern executeLoopNode already fixed).
    // The group fails fast, surfacing the failed body node's own error.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      throw new Error('body node exploded');
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-body-fail');

    const nodes: DagNode[] = [
      {
        id: 'flaky',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-body-fail', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Fail-fast: exactly ONE iteration ran — no burn-to-max_iterations.
    expect(calls).toBe(1);
    // Run failed → no terminal output returned to the outer DAG.
    expect(result).toBeUndefined();
    // The user-facing failure surfaced the body node's real error, not a
    // generic max-iterations message.
    const sent = (platform.sendMessage as Mock<(...args: unknown[]) => Promise<void>>).mock.calls
      .map(c => String(c[1]))
      .join('\n');
    expect(sent).toContain('body node exploded');
    expect(sent).not.toContain('exceeded max iterations');
  });

  it('EDGE B: body prompt can reference an outer-DAG upstream node via $nodeId.output', async () => {
    // The loop_group depends_on an outer bash node `setup`. The body prompt references
    // $setup.output. outerNodeOutputs is seeded into the scoped map, so the ref resolves.
    let receivedPrompt = '';
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      receivedPrompt = prompt ?? '';
      yield { type: 'assistant', content: 'saw setup output\nDONE' };
      yield { type: 'result', sessionId: 's' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-outer-dep');

    const nodes: DagNode[] = [
      { id: 'setup', bash: 'echo "setup-context-123"', depends_on: [] },
      {
        id: 'consumer',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            {
              id: 'work',
              prompt: 'Outer setup said: $setup.output\nNow act on it. Emit DONE.',
              depends_on: [],
            },
          ],
        },
        depends_on: ['setup'],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-outer-dep', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // The body prompt received the outer node's output (seeded into the scoped map).
    expect(receivedPrompt).toContain('setup-context-123');
    // Completed in 1 iteration (signal emitted immediately).
    expect(result).toContain('saw setup output');
  });

  it('EDGE F: $LOOP_PREV.<id>.output.<field> resolves structured prior-iteration output (unit)', () => {
    // Unit-level: substituteLoopPrevRefs field access against a structured NodeOutput.
    const prev = new Map<string, NodeOutput>([
      ['work', makeOutput('completed', '', { status: 'green', count: 7 }, ['status', 'count'])],
    ]);
    // Field access resolves from structuredOutput.
    expect(substituteLoopPrevRefs('status=$LOOP_PREV.work.output.status', prev)).toBe(
      'status=green'
    );
    expect(substituteLoopPrevRefs('count=$LOOP_PREV.work.output.count', prev)).toBe('count=7');
    // Whole-output form still works (returns the raw output string, here '').
    expect(substituteLoopPrevRefs('all=[$LOOP_PREV.work.output]', prev)).toBe('all=[]');
  });

  it('EDGE F: $LOOP_PREV.<id>.output.<field> on a missing prior node resolves to empty', () => {
    // The referenced node wasn't in the prior iteration (skipped/absent) → '' not a throw.
    // Raw call (no knownBodyIds set) stays fully lenient — the typo check only engages when
    // the static body-id set is threaded in via the executor path.
    const prev = new Map<string, NodeOutput>([['work', makeOutput('completed', 'ran', undefined)]]);
    expect(substituteLoopPrevRefs('other=[$LOOP_PREV.absent.output.field]', prev)).toBe('other=[]');
  });

  it('EDGE F (#2142): substituteLoopPrevRefs classifies absent refs by the two body-id sets', () => {
    // Iteration-1 posture: no prior outputs yet. `knownBodyIds` is the TRANSITIVE set
    // (this group + nested descendants); `directBodyIds` is only this group's immediate ids.
    // Group body: { grader, work, refine(nested group) }; refine's inner body: { polish }.
    const knownBodyIds = new Set(['grader', 'work', 'refine', 'polish']);
    const directBodyIds = new Set(['grader', 'work', 'refine']);

    // Typo: `grrader` matches no body node → OutputRefError('unknown-node') + did-you-mean.
    let caught: unknown;
    try {
      substituteLoopPrevRefs(
        'score=$LOOP_PREV.grrader.output.score',
        undefined,
        false,
        undefined,
        knownBodyIds,
        directBodyIds
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputRefError);
    expect((caught as OutputRefError).reason).toBe('unknown-node');
    expect((caught as OutputRefError).message).toContain("'grader'"); // did-you-mean names the near miss

    // Direct body id with no prior-iteration output (iteration 1) → '' (legitimate absence).
    expect(
      substituteLoopPrevRefs(
        'score=$LOOP_PREV.grader.output.score',
        undefined,
        false,
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toBe('score=');

    // Nested-owned id (`polish` ∈ known, ∉ direct): token left INTACT so the inner
    // loop_group resolves it against its OWN prior-iteration snapshot later. Both the
    // `.field` and whole-text forms are preserved.
    expect(
      substituteLoopPrevRefs(
        'draft=[$LOOP_PREV.polish.output.draft]',
        undefined,
        false,
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toBe('draft=[$LOOP_PREV.polish.output.draft]');
    expect(
      substituteLoopPrevRefs(
        'whole=[$LOOP_PREV.polish.output]',
        undefined,
        false,
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toBe('whole=[$LOOP_PREV.polish.output]');

    // Whole-text `$LOOP_PREV.<id>.output` to an unknown id stays lenient (no throw), even
    // with the set — mirrors substituteNodeOutputRefs' lenient whole-text surface.
    expect(
      substituteLoopPrevRefs(
        'all=$LOOP_PREV.grrader.output',
        undefined,
        false,
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toBe('all=');

    // Bash-escaped mode throws too (the typo would otherwise become an empty shell literal).
    expect(() =>
      substituteLoopPrevRefs(
        'echo $LOOP_PREV.grrader.output.score',
        undefined,
        true,
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toThrow(OutputRefError);

    // Raw caller with NO sets → fully lenient (pre-#2142 behavior): unknown id .field → ''.
    expect(substituteLoopPrevRefs('x=[$LOOP_PREV.grrader.output.score]', undefined)).toBe('x=[]');
  });

  it('EDGE F (#2142): applyLoopPrevToBodyNode — typo throws, nested-owned token SURVIVES the outer pass', () => {
    // The executor path threads the transitive `knownBodyIds` and immediate `directBodyIds`.
    // Simulate the OUTER group's iteration-1 pass (no prior outputs). Outer body =
    // { review, refine(nested group) }; refine's inner body = { polish }.
    const knownBodyIds = new Set(['review', 'refine', 'polish']);
    const directBodyIds = new Set(['review', 'refine']);

    // A typo in a body prompt fails loudly.
    expect(() =>
      applyLoopPrevToBodyNode(
        {
          id: 'review',
          prompt: 'act on $LOOP_PREV.reviw.output.verdict',
          depends_on: [],
        } as DagNode,
        undefined,
        '',
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toThrow(OutputRefError);

    // A nested loop_group whose inner body references its OWN sibling id (`polish`, nested-
    // owned) must have that token LEFT INTACT by the outer pass — otherwise the inner loop
    // could never resolve its own prior iteration (this is the #2165 fix; before it the
    // outer pass destroyed the token to '').
    const nestedGroup = applyLoopPrevToBodyNode(
      {
        id: 'refine',
        loop_group: {
          until: 'DONE',
          max_iterations: 2,
          nodes: [
            { id: 'polish', prompt: 'refine on $LOOP_PREV.polish.output.draft', depends_on: [] },
          ],
        },
        depends_on: [],
      } as DagNode,
      undefined,
      '',
      undefined,
      knownBodyIds,
      directBodyIds
    );
    if (!('loop_group' in nestedGroup) || nestedGroup.loop_group === undefined)
      throw new Error('expected loop_group node');
    const polishNode = nestedGroup.loop_group.nodes[0];
    expect('prompt' in polishNode && polishNode.prompt).toBe(
      'refine on $LOOP_PREV.polish.output.draft'
    );

    // A ref to an OUTER-direct id (`review`) inside the nested body IS resolved now, at the
    // outer granularity — here to '' (iteration 1, no prior output), not preserved.
    const nestedReadsOuter = applyLoopPrevToBodyNode(
      {
        id: 'refine',
        loop_group: {
          until: 'DONE',
          max_iterations: 2,
          nodes: [
            {
              id: 'polish',
              prompt: 'saw outer [$LOOP_PREV.review.output.verdict]',
              depends_on: [],
            },
          ],
        },
        depends_on: [],
      } as DagNode,
      undefined,
      '',
      undefined,
      knownBodyIds,
      directBodyIds
    );
    if (!('loop_group' in nestedReadsOuter) || nestedReadsOuter.loop_group === undefined)
      throw new Error('expected loop_group node');
    const polishReadsOuter = nestedReadsOuter.loop_group.nodes[0];
    expect('prompt' in polishReadsOuter && polishReadsOuter.prompt).toBe('saw outer []');

    // But a typo INSIDE the nested body (id in no body node) still throws through the recursion.
    expect(() =>
      applyLoopPrevToBodyNode(
        {
          id: 'refine',
          loop_group: {
            until: 'DONE',
            max_iterations: 2,
            nodes: [
              { id: 'polish', prompt: 'refine on $LOOP_PREV.reviw.output.verdict', depends_on: [] },
            ],
          },
          depends_on: [],
        } as DagNode,
        undefined,
        '',
        undefined,
        knownBodyIds,
        directBodyIds
      )
    ).toThrow(OutputRefError);
  });

  it('EDGE F (#2165): a nested inner loop_group resolves its OWN prior-iteration $LOOP_PREV end-to-end', async () => {
    // The semantics the L3417 comment promises: an inner loop_group body node referencing
    // its own sibling's previous iteration (`$LOOP_PREV.w.output`) must see that output on
    // the inner group's 2nd+ iteration — even though the inner group is nested inside an
    // outer loop_group. Before #2165 the outer loop's substitution pass eagerly destroyed
    // the token to '' before the inner loop ran, so it was empty on EVERY inner iteration.
    //
    // Body node `w` emits a distinct marker each call; we capture the prompt it receives.
    // Inner iteration 1 → no prior output (''); inner iteration 2 → the marker from
    // iteration 1 (proving the inner loop resolved its own prior iteration).
    const capturedPrompts: string[] = [];
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      capturedPrompts.push(prompt ?? '');
      const n = capturedPrompts.length;
      // Call 1 emits MARK1 (no signal → inner iterates again); call 2 emits the signal.
      yield { type: 'assistant', content: n === 1 ? 'MARK1' : 'MARK2 INNER_DONE' };
      yield { type: 'result', sessionId: `s-${n}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-nested-prev');

    const nodes: DagNode[] = [
      {
        id: 'outer',
        loop_group: {
          until: 'OUTER_DONE',
          // One outer iteration is enough to run the inner group to its own completion.
          max_iterations: 1,
          fresh_context: false,
          nodes: [
            {
              id: 'inner',
              loop_group: {
                until: 'INNER_DONE',
                max_iterations: 3,
                fresh_context: false,
                nodes: [
                  {
                    id: 'w',
                    prompt: 'prev=[$LOOP_PREV.w.output] do work',
                    depends_on: [],
                  },
                ],
              },
              depends_on: [],
            },
          ],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-nested-prev', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Two inner iterations ran within the single outer iteration.
    expect(capturedPrompts.length).toBe(2);
    // Inner iteration 1: no prior output → empty.
    expect(capturedPrompts[0]).toContain('prev=[]');
    // Inner iteration 2: the inner loop resolved ITS OWN prior-iteration output — the token
    // survived the outer pass and resolved against the inner snapshot. This is the fix.
    expect(capturedPrompts[1]).toContain('prev=[MARK1]');
  });

  it('EDGE H: applyLoopPrevToBodyNode uses shell escaping only for shell-bound fields (unit)', () => {
    // Prior output contains a single quote — the acid test for escaping-mode mixups.
    const prev = new Map<string, NodeOutput>([
      ['work', makeOutput('completed', "it's done", undefined)],
    ]);

    // bash: shell-bound → value arrives shell-quoted.
    const bashNode = applyLoopPrevToBodyNode(
      { id: 'b', bash: 'echo $LOOP_PREV.work.output', depends_on: [] } as DagNode,
      prev,
      ''
    );
    expect('bash' in bashNode && bashNode.bash).toBe("echo 'it'\\''s done'");

    // script: runs via execFile argv (no shell) → raw value, no quote artifacts in source.
    const scriptNode = applyLoopPrevToBodyNode(
      {
        id: 's',
        script: 'console.log(`$LOOP_PREV.work.output`)',
        runtime: 'bun',
        depends_on: [],
      } as DagNode,
      prev,
      ''
    );
    expect('script' in scriptNode && scriptNode.script).toBe("console.log(`it's done`)");

    // cancel: display text → raw value.
    const cancelNode = applyLoopPrevToBodyNode(
      { id: 'c', cancel: 'stopping: $LOOP_PREV.work.output', depends_on: [] } as DagNode,
      prev,
      ''
    );
    expect('cancel' in cancelNode && cancelNode.cancel).toBe("stopping: it's done");
  });

  it('EDGE H: never splices $LOOP_USER_INPUT into a script body — env delivery only (#2115)', () => {
    // Malicious approval-gate free-text. Raw-spliced into TS source it would close the
    // string literal and execute; it must stay an inert literal token in the script so
    // executeScriptNode delivers the value out-of-band via env instead.
    const injection = '"); require("child_process").execSync("touch pwned"); //';

    const scriptNode = applyLoopPrevToBodyNode(
      {
        id: 's',
        script: 'console.log("$LOOP_USER_INPUT")',
        runtime: 'bun',
        depends_on: [],
      } as DagNode,
      undefined,
      injection
    );
    // Literal token preserved; the payload never reaches the executed source.
    expect('script' in scriptNode && scriptNode.script).toBe('console.log("$LOOP_USER_INPUT")');

    // bash stays shell-quoted (the existing safe channel) — proving only scripts changed.
    const bashNode = applyLoopPrevToBodyNode(
      { id: 'b', bash: 'echo $LOOP_USER_INPUT', depends_on: [] } as DagNode,
      undefined,
      injection
    );
    // No single quotes in the payload → shellQuote wraps it verbatim in single quotes.
    expect('bash' in bashNode && bashNode.bash).toBe(`echo '${injection}'`);
  });

  it('EDGE H: nested loop until_bash gets $LOOP_PREV substituted shell-safely (unit)', () => {
    const prev = new Map<string, NodeOutput>([
      ['work', makeOutput('completed', 'PASS', undefined)],
    ]);
    const nestedLoop = applyLoopPrevToBodyNode(
      {
        id: 'inner',
        loop: {
          prompt: 'iterate on $LOOP_PREV.work.output',
          until: 'DONE',
          max_iterations: 2,
          until_bash: 'test $LOOP_PREV.work.output = PASS',
        },
        depends_on: [],
      } as DagNode,
      prev,
      ''
    );
    if (!('loop' in nestedLoop) || nestedLoop.loop === undefined)
      throw new Error('expected loop node');
    expect(nestedLoop.loop.prompt).toBe('iterate on PASS');
    expect(nestedLoop.loop.until_bash).toBe("test 'PASS' = PASS");

    const nestedGroup = applyLoopPrevToBodyNode(
      {
        id: 'inner-grp',
        loop_group: {
          until: 'DONE',
          max_iterations: 2,
          until_bash: 'test $LOOP_PREV.work.output = PASS',
          nodes: [{ id: 'w', prompt: 'p', depends_on: [] }],
        },
        depends_on: [],
      } as DagNode,
      prev,
      ''
    );
    if (!('loop_group' in nestedGroup) || nestedGroup.loop_group === undefined)
      throw new Error('expected loop_group node');
    expect(nestedGroup.loop_group.until_bash).toBe("test 'PASS' = PASS");
  });

  it('EDGE D: multi-terminal body runs parallel terminals; signal on the selected terminal completes', async () => {
    // Body has two no-dependency AI nodes (a, b) — a parallel layer, both run each
    // iteration. The group's terminal output is the FIRST completed terminal node in
    // definition order (a before b), so the completion signal must appear in a's output
    // to be detected. This verifies (1) parallel terminals run concurrently and (2) the
    // terminal-output selection picks `a`.
    let aCalls = 0;
    let bCalls = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      // Distinguish the two body nodes by their prompt content.
      if (prompt.includes('node-a')) {
        aCalls++;
        yield { type: 'assistant', content: 'a-output DONE' };
      } else {
        bCalls++;
        yield { type: 'assistant', content: 'b-output (no signal)' };
      }
      yield { type: 'result', sessionId: 's' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-multiterminal');

    const nodes: DagNode[] = [
      {
        id: 'multi',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            { id: 'a', prompt: 'I am node-a. Emit DONE.', depends_on: [] },
            { id: 'b', prompt: 'I am node-b. Do work.', depends_on: [] },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-multiterminal', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Both parallel terminal nodes ran on the completing iteration (iter 1).
    expect(aCalls).toBeGreaterThanOrEqual(1);
    expect(bCalls).toBeGreaterThanOrEqual(1);
    // `a` (first terminal in def order) emitted DONE → group completed; its output is
    // the group's terminal output.
    expect(result).toContain('a-output');
  });

  it('EDGE C: fresh_context=true does not crash and the group still completes', async () => {
    // Smoke: fresh_context:true path. We can't easily assert session reset from the mock,
    // but we verify the group completes normally with fresh_context on.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: calls === 1 ? 'wip' : 'final\nDONE' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-fresh');

    const nodes: DagNode[] = [
      {
        id: 'fresh',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: true,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-fresh', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);
    expect(result).toContain('final');
  });

  it('EDGE E: between-iteration cancellation stops the loop with a failed result', async () => {
    // getWorkflowRunStatus returns 'running' on iteration 1, then 'cancelled' before
    // iteration 2 → the between-iteration check halts the loop with a failed result.
    let calls = 0;
    const statuses = ['running', 'cancelled', 'cancelled'];
    // Override the store mock to cycle statuses. createMockDeps uses createMockStore which
    // returns 'running' always; we override getWorkflowRunStatus here.
    const mockDeps = createMockDeps();
    (mockDeps.store.getWorkflowRunStatus as ReturnType<typeof mock>).mockImplementation(() => {
      const s = statuses[Math.min(calls, statuses.length - 1)];
      return Promise.resolve(s as 'running' | 'cancelled');
    });
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: `iter ${calls} work` };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-cancel');

    const nodes: DagNode[] = [
      {
        id: 'cancellable',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-cancel', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Only iteration 1 ran before cancellation halted the loop. The run did not complete
    // (no DONE) → outer DAG sees no terminal output.
    expect(calls).toBe(1);
    expect(result).toBeUndefined();
  });

  it('EDGE G: until signal OR until_bash — signal short-circuits until_bash (not executed)', async () => {
    // Both until and until_bash are set. The AI emits the until signal on iteration 1;
    // completionDetected = signalDetected (true) short-circuits before until_bash runs.
    // We prove until_bash was skipped via a sentinel file it would create if executed.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-or');
    const sentinel = join(testDir, 'untilbash-ran');

    const nodes: DagNode[] = [
      {
        id: 'either',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          // Creates a sentinel file + exits 0. If this runs, the file exists; if the
          // until-signal short-circuits, the file is never created.
          until_bash: `touch ${sentinel}`,
          nodes: [{ id: 'work', prompt: 'do work, emit DONE', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-or', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Signal completed on iteration 1.
    expect(calls).toBe(1);
    expect(result).toContain('done');
    // until_bash was short-circuited (sentinel file NOT created).
    let sentinelExists = true;
    try {
      await readFile(sentinel, 'utf8');
    } catch {
      sentinelExists = false;
    }
    expect(sentinelExists).toBe(false);
  });

  it('EDGE I: max_iterations=1 single-shot completes when signal present, fails otherwise', async () => {
    // Single iteration allowed. With the signal present → completes in 1.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: 'one-shot\nDONE' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-single-shot');

    const nodes: DagNode[] = [
      {
        id: 'once',
        loop_group: {
          until: 'DONE',
          max_iterations: 1,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work, emit DONE', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-single-shot', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(1);
    expect(result).toContain('one-shot');
  });

  it('EDGE H: nested loop_group (loop_group inside a loop_group body) runs', async () => {
    // Outer body contains an inner loop_group. The inner group completes in 1 iteration
    // (emits INNER_DONE), and the outer completes when its terminal node emits OUTER_DONE.
    // This smoke-tests that applyLoopPrevToBodyNode recurses and that a body node which is
    // itself a loop_group dispatches correctly.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      // Inner loop_group's body node runs first (emits INNER_DONE → inner completes iter 1).
      // Then the outer's review node emits OUTER_DONE. Distinguish by call order.
      const content = calls === 1 ? 'inner work\nINNER_DONE' : 'outer review\nOUTER_DONE';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-nested');

    const nodes: DagNode[] = [
      {
        id: 'outer',
        loop_group: {
          until: 'OUTER_DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            {
              id: 'inner',
              loop_group: {
                until: 'INNER_DONE',
                max_iterations: 2,
                fresh_context: false,
                nodes: [
                  { id: 'inner-work', prompt: 'inner work, emit INNER_DONE', depends_on: [] },
                ],
              },
              depends_on: [],
            },
            {
              id: 'review',
              prompt: 'review inner result, emit OUTER_DONE',
              depends_on: ['inner'],
            },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-nested', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Inner ran (1 call), then outer review ran (1 call) emitting OUTER_DONE → outer completes.
    expect(calls).toBe(2);
    expect(result).toContain('outer review');
  });

  // --- Dimension 4: interactive gate + resume ---

  it('INTERACTIVE: interactive loop_group pauses at the gate after iteration 1', async () => {
    // Fresh interactive loop_group: iteration 1 emits no signal → pauses at the gate.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'iteration 1 draft, awaiting review' };
      yield { type: 'result', sessionId: 'lg-gate-sess-1' };
    });

    const store = createMockStore();
    let pauseCommitted = false;
    let pauseCommittedAtApprovalRequest = false;
    store.pauseWorkflowRun = mock(async (): Promise<void> => {
      pauseCommitted = true;
    });
    store.createWorkflowEvent = mock(async event => {
      if (event.event_type === 'approval_requested') {
        pauseCommittedAtApprovalRequest = pauseCommitted;
      }
    });
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-interactive');

    const nodes: DagNode[] = [
      {
        id: 'refine',
        loop_group: {
          until: 'APPROVED',
          max_iterations: 5,
          fresh_context: false,
          interactive: true,
          gate_message: 'Review the result.',
          nodes: [{ id: 'work', prompt: 'produce a draft', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-interactive', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // One AI call (iteration 1), then paused.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const pauseCalls = (
      mockDeps.store.pauseWorkflowRun as Mock<
        (id: string, ctx: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'interactive_loop',
      nodeId: 'refine',
      iteration: 1,
      completionSignaled: false,
      signaledOutput: null,
    });
    const pausedGroupMessage = (pauseCalls[0][1] as { message: string }).message;
    expect(pausedGroupMessage).toContain('No completion signal');
    expect(pausedGroupMessage).toContain('Review the result.');
    expect(pauseCommittedAtApprovalRequest).toBe(true);
    expect(store.createWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: workflowRun.id,
      event_type: 'approval_requested',
      step_name: 'refine',
      data: {
        gateType: 'interactive_loop',
        nodeId: 'refine',
        message: pausedGroupMessage,
        iteration: 1,
        completionSignaled: false,
      },
    });
  });

  it('INTERACTIVE: loop_group gate persists signal state when iteration 1 signals (#2074)', async () => {
    // Signal on iteration 1 of a fresh interactive loop_group (no signal_completes):
    // still gates, but the pause carries completionSignaled + signaledOutput so a
    // bare approve can finalize at resume.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'validation PASS\nAPPROVED' };
      yield { type: 'result', sessionId: 'lg-sig-sess-1' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-signal-gate');

    const nodes: DagNode[] = [
      {
        id: 'refine',
        loop_group: {
          until: 'APPROVED',
          max_iterations: 5,
          fresh_context: false,
          interactive: true,
          gate_message: 'Review the result.',
          nodes: [{ id: 'work', prompt: 'validate', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-signal-gate', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const pauseCalls = (
      mockDeps.store.pauseWorkflowRun as Mock<
        (id: string, ctx: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'interactive_loop',
      nodeId: 'refine',
      iteration: 1,
      completionSignaled: true,
    });
    expect(String(pauseCalls[0][1].signaledOutput)).toContain('validation PASS');
    expect(String(pauseCalls[0][1].message)).toContain('Completion signal detected');
    // No `signaledTokens` (unlike the plain-loop gate): the group's finalize path has
    // no consumer for it, because the body's own rows already persisted this
    // iteration's usage before the pause (#2333).
    expect(pauseCalls[0][1]).not.toHaveProperty('signaledTokens');
  });

  it('INTERACTIVE: loop_group signal_completes completes on a first-iteration signal without gating (#2074 B)', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'validation PASS\nAPPROVED' };
      yield { type: 'result', sessionId: 'lg-sc-sess-1' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-signal-completes');

    const nodes: DagNode[] = [
      {
        id: 'refine',
        loop_group: {
          until: 'APPROVED',
          max_iterations: 5,
          fresh_context: false,
          interactive: true,
          gate_message: 'Review the result.',
          signal_completes: true,
          nodes: [{ id: 'work', prompt: 'validate', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-signal-completes', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const pauseCalls = (mockDeps.store.pauseWorkflowRun as Mock<() => Promise<void>>).mock.calls;
    expect(pauseCalls.length).toBe(0);
    const eventCalls = (
      mockDeps.store.createWorkflowEvent as Mock<
        (e: {
          event_type: string;
          step_name: string;
          data: Record<string, unknown>;
        }) => Promise<void>
      >
    ).mock.calls;
    const completed = eventCalls.filter(
      c => c[0].event_type === 'node_completed' && c[0].step_name === 'refine'
    );
    expect(completed.length).toBe(1);
  });

  it('INTERACTIVE: loop_group finalizes at resume from persisted signaledOutput on a bare approve (#2074 C)', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'should never run' };
      yield { type: 'result', sessionId: 'never' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-finalize', {
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          iteration: 1,
          sessionId: 'lg-sig-sess-1',
          sessionProvider: 'claude',
          message: 'gate',
          completionSignaled: true,
          signaledOutput: 'GROUP REPORT',
        },
        loop_user_input: 'Approved',
        loop_feedback_given: false,
      },
    });

    const nodes: DagNode[] = [
      {
        id: 'refine',
        loop_group: {
          until: 'APPROVED',
          max_iterations: 5,
          fresh_context: false,
          interactive: true,
          gate_message: 'Review the result.',
          nodes: [{ id: 'work', prompt: 'validate', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-finalize', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // No body iteration ran — the group finalized from the persisted output.
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
    const eventCalls = (
      mockDeps.store.createWorkflowEvent as Mock<
        (e: {
          event_type: string;
          step_name: string;
          data: Record<string, unknown>;
        }) => Promise<void>
      >
    ).mock.calls;
    const completed = eventCalls.filter(
      c => c[0].event_type === 'node_completed' && c[0].step_name === 'refine'
    );
    expect(completed.length).toBe(1);
    expect(completed[0][0].data.node_output).toBe('GROUP REPORT');
  });

  it('INTERACTIVE: resumed loop_group continues from the next iteration and completes', async () => {
    // Two-call pattern (mirrors the loop: resume test): call 1 pauses at the gate after
    // iteration 1 (no signal). Call 2 resumes with metadata.approval populated; iteration 2
    // emits APPROVED → completes.
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'assistant', content: 'iter1 draft, not approved' };
      yield { type: 'result', sessionId: 'lg-resume-sess-1' };
    });

    const mockDeps1 = createMockDeps();
    const platform1 = createMockPlatform();
    const freshRun = makeWorkflowRun('lg-resume-fresh');

    const workflow = {
      name: 'lg-resume',
      nodes: [
        {
          id: 'refine',
          loop_group: {
            until: 'APPROVED',
            max_iterations: 5,
            fresh_context: false,
            interactive: true,
            gate_message: 'Review.',
            nodes: [
              { id: 'work', prompt: 'User: $LOOP_USER_INPUT. Draft or APPROVED.', depends_on: [] },
            ],
          },
          depends_on: [],
        },
      ] as DagNode[],
    };

    await executeDagWorkflow(
      mockDeps1,
      platform1,
      'conv-lg',
      testDir,
      workflow,
      freshRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
    // Call 1 paused at iteration 1, persisting the body's session cursor so a
    // fresh_context: false resume can continue the same conversation.
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const pauseCalls1 = (
      mockDeps1.store.pauseWorkflowRun as Mock<
        (id: string, ctx: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(pauseCalls1.length).toBe(1);
    expect(pauseCalls1[0]?.[1]?.sessionId).toBe('lg-resume-sess-1');
    // The pause payload tags the session with its provider (#1992) so the resume
    // never threads it into a node that resolves to a different provider.
    expect(pauseCalls1[0]?.[1]?.sessionProvider).toBe('claude');

    // ---- Call 2: resume with metadata.approval carrying iter 1 + user input.
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'assistant', content: 'all good, shipping\nAPPROVED' };
      yield { type: 'result', sessionId: 'lg-resume-sess-2' };
    });
    const mockDeps2 = createMockDeps();
    const platform2 = createMockPlatform();
    const resumedRun = makeWorkflowRun('lg-resume-resume', {
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'refine',
          iteration: 1,
          sessionId: 'lg-resume-sess-1',
          sessionProvider: 'claude',
          message: 'Review.',
        },
        loop_user_input: 'looks great',
      },
    });

    await executeDagWorkflow(
      mockDeps2,
      platform2,
      'conv-lg',
      testDir,
      workflow,
      resumedRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Resumed iteration (iteration 2) ran once more and completed via APPROVED.
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    // The resumed iteration's prompt carried the user input via $LOOP_USER_INPUT.
    const resumePrompt = mockSendQueryDag.mock.calls[1][0] as string;
    expect(resumePrompt).toContain('looks great');
    // fresh_context: false — the resumed iteration continues the PRE-PAUSE session
    // (restored from ApprovalContext.sessionId), not a fresh one.
    expect(mockSendQueryDag.mock.calls[1][2]).toBe('lg-resume-sess-1');
    // Resume completed (no second pause at the gate).
    const pauseCalls2 = (
      mockDeps2.store.pauseWorkflowRun as Mock<
        (id: string, ctx: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(pauseCalls2.length).toBe(0);
  });

  it('INTERACTIVE: blocked create-story loop pauses and reruns authoring on approval', async () => {
    let aiCalls = 0;
    let authorCalls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      aiCalls++;
      const prompt = String(mockSendQueryDag.mock.calls[aiCalls - 1]?.[0] ?? '');
      const isAuthorCall = prompt.includes('Author story.');
      if (isAuthorCall) authorCalls++;
      const content =
        isAuthorCall && authorCalls === 1
          ? JSON.stringify({
              status: 'blocked',
              story_name: 'Blocked story',
              story_key: '3-9-blocked-story',
              story_file: join(testDir, 'blocked.md'),
              sprint_status: 'backlog',
              validation_summary: 'Needs canonical decision',
              risk_profile: ['decision coverage'],
            })
          : `${JSON.stringify({
              status: 'draft',
              story_name: 'Blocked story',
              story_key: '3-9-blocked-story',
              story_file: join(testDir, 'blocked.md'),
              sprint_status: 'in-progress',
              validation_summary: 'Ready for validation',
              risk_profile: ['decision coverage'],
            })}`;
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `create-story-${authorCalls}` };
    });

    const workflow = {
      name: 'bmad-create-story-blocked-regression',
      nodes: [
        {
          id: 'create-story',
          output_type: 'create-story',
          loop_group: {
            until: 'CREATE_STORY_READY',
            max_iterations: 3,
            fresh_context: true,
            interactive: true,
            signal_completes: true,
            gate_message:
              'BMAD create-story is blocked. Resolve the canonical source and approve to rerun authoring.',
            nodes: [
              {
                id: 'author-story',
                prompt:
                  'Author story. User note: $LOOP_USER_INPUT. If blocked, return blocked JSON without CREATE_STORY_READY.',
                depends_on: [],
              },
              {
                id: 'record-created-story-state',
                bash:
                  'AUTHOR_STATUS=$author-story.output.status\n' +
                  'if [ "$AUTHOR_STATUS" = "blocked" ]; then\n' +
                  '  echo "blocked"\n' +
                  'else\n' +
                  '  printf "%s\\n" $author-story.output\n' +
                  '  echo CREATE_STORY_READY\n' +
                  'fi',
                depends_on: ['author-story'],
              },
            ],
          },
          depends_on: [],
        },
        {
          id: 'validate-story-readiness',
          prompt: 'Validate $create-story.output.story_file',
          depends_on: ['create-story'],
        },
      ] as DagNode[],
    };

    const firstStore = createMockStore();
    const firstRun = makeWorkflowRun('blocked-loop-first');
    await executeDagWorkflow(
      createMockDeps(firstStore),
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      firstRun,
      'claude',
      undefined,
      join(testDir, 'artifacts-first'),
      join(testDir, 'state-first'),
      join(testDir, 'logs-first'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(authorCalls).toBe(1);
    expect(
      (
        firstStore.pauseWorkflowRun as Mock<
          (id: string, ctx: Record<string, unknown>) => Promise<void>
        >
      ).mock.calls[0]?.[1]
    ).toMatchObject({
      type: 'interactive_loop',
      nodeId: 'create-story',
      iteration: 1,
      completionSignaled: false,
    });

    const resumedStore = createMockStore();
    const resumedRun = makeWorkflowRun('blocked-loop-resume', {
      metadata: {
        approval: {
          type: 'interactive_loop',
          nodeId: 'create-story',
          iteration: 1,
          message: 'Resolve blocker.',
        },
        loop_user_input: 'Canonical source updated.',
        loop_feedback_given: true,
      },
    });

    await executeDagWorkflow(
      createMockDeps(resumedStore),
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      resumedRun,
      'claude',
      undefined,
      join(testDir, 'artifacts-resume'),
      join(testDir, 'state-resume'),
      join(testDir, 'logs-resume'),
      'main',
      'docs/',
      minimalConfig
    );

    const resumedAuthorPrompt = mockSendQueryDag.mock.calls[1]?.[0] as string;
    expect(resumedAuthorPrompt).toContain('Canonical source updated.');
    expect(authorCalls).toBe(2);
    const validatePrompt = mockSendQueryDag.mock.calls[2]?.[0] as string;
    expect(validatePrompt).toContain(join(testDir, 'blocked.md'));
    const completedEvents = (
      resumedStore.createWorkflowEvent as Mock<
        (e: {
          event_type: string;
          step_name: string;
          data: Record<string, unknown>;
        }) => Promise<void>
      >
    ).mock.calls.filter(
      call => call[0].event_type === 'node_completed' && call[0].step_name === 'create-story'
    );
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0]?.[0].data.node_output).not.toContain('CREATE_STORY_READY');
    expect(String(completedEvents[0]?.[0].data.node_output)).toStartWith('{"status":"draft"');
  });

  it('INTERACTIVE: successful create-story loop signal completes without first-run pause', async () => {
    let aiCalls = 0;
    let authorCalls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      aiCalls++;
      const prompt = String(mockSendQueryDag.mock.calls[aiCalls - 1]?.[0] ?? '');
      const isAuthorCall = prompt.includes('Author story.');
      if (isAuthorCall) authorCalls++;
      const content = isAuthorCall
        ? JSON.stringify({
            status: 'draft',
            story_name: 'Ready story',
            story_key: '3-10-ready-story',
            story_file: join(testDir, 'ready.md'),
            sprint_status: 'in-progress',
            validation_summary: 'Ready for validation',
            risk_profile: ['decision coverage'],
          })
        : 'PASS';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `create-story-success-${aiCalls}` };
    });

    const store = createMockStore();
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-lg',
      testDir,
      {
        name: 'bmad-create-story-success-regression',
        nodes: [
          {
            id: 'create-story',
            output_type: 'create-story',
            loop_group: {
              until: 'CREATE_STORY_READY',
              max_iterations: 3,
              fresh_context: true,
              interactive: true,
              signal_completes: true,
              gate_message:
                'BMAD create-story is blocked. Resolve the canonical source and approve to rerun authoring.',
              nodes: [
                {
                  id: 'author-story',
                  prompt: 'Author story. User note: $LOOP_USER_INPUT.',
                  depends_on: [],
                },
                {
                  id: 'record-created-story-state',
                  bash:
                    'AUTHOR_STATUS=$author-story.output.status\n' +
                    'if [ "$AUTHOR_STATUS" = "blocked" ]; then\n' +
                    '  echo "blocked"\n' +
                    'else\n' +
                    '  printf "%s\\n" $author-story.output\n' +
                    '  echo CREATE_STORY_READY\n' +
                    'fi',
                  depends_on: ['author-story'],
                },
              ],
            },
            depends_on: [],
          },
          {
            id: 'validate-story-readiness',
            prompt: 'Validate $create-story.output.story_file',
            depends_on: ['create-story'],
          },
        ] as DagNode[],
      },
      makeWorkflowRun('ready-loop-first'),
      'claude',
      undefined,
      join(testDir, 'artifacts-ready'),
      join(testDir, 'state-ready'),
      join(testDir, 'logs-ready'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(authorCalls).toBe(1);
    expect(
      (store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>)
        .mock.calls.length
    ).toBe(0);
    const validatePrompt = mockSendQueryDag.mock.calls[1]?.[0] as string;
    expect(validatePrompt).toContain(join(testDir, 'ready.md'));
  });

  it('INTERACTIVE resume: $LOOP_PREV is NOT preserved across the pause/resume boundary (v1 known limitation)', async () => {
    // v1 behavior: on interactive resume, loopPrevOutputs resets to undefined (the prior
    // process's body-output snapshot is not persisted in ApprovalContext). So the resumed
    // iteration's $LOOP_PREV.<bodyNode>.output resolves to '' — NOT to the paused run's
    // iteration-1 output. This test locks the current behavior; persisting $LOOP_PREV
    // across resume is a tracked follow-up (CodeRabbit finding #5).
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'assistant', content: 'iter1 body output XYZ' };
      yield { type: 'result', sessionId: 'lg-prev-sess-1' };
    });

    const mockDeps1 = createMockDeps();
    const workflow = {
      name: 'lg-resume-prev',
      nodes: [
        {
          id: 'refine',
          loop_group: {
            until: 'APPROVED',
            max_iterations: 5,
            fresh_context: false,
            interactive: true,
            gate_message: 'Review.',
            nodes: [
              {
                id: 'work',
                prompt: 'PREV=<<$LOOP_PREV.work.output>> USER=$LOOP_USER_INPUT. Draft or APPROVED.',
                depends_on: [],
              },
            ],
          },
          depends_on: [],
        },
      ] as DagNode[],
    };
    await executeDagWorkflow(
      mockDeps1,
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      makeWorkflowRun('lg-prev-fresh'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Iteration 1 prompt: $LOOP_PREV resolved to '' (no prior iteration in this process).
    const iter1Prompt = mockSendQueryDag.mock.calls[0][0] as string;
    expect(iter1Prompt).toContain('PREV=<<>>');

    // ---- Resume: iteration 2.
    mockSendQueryDag.mockImplementationOnce(function* () {
      yield { type: 'assistant', content: 'final\nAPPROVED' };
      yield { type: 'result', sessionId: 'lg-prev-sess-2' };
    });
    await executeDagWorkflow(
      createMockDeps(),
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      makeWorkflowRun('lg-prev-resume', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'lg-prev-sess-1',
            message: 'Review.',
          },
          loop_user_input: 'ok',
        },
      }),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Resumed iteration 2: $LOOP_PREV is '' (v1 does not persist the prior body snapshot
    // across resume), NOT 'iter1 body output XYZ'.
    const resumePrompt = mockSendQueryDag.mock.calls[1][0] as string;
    expect(resumePrompt).toContain('PREV=<<>>');
    expect(resumePrompt).not.toContain('iter1 body output XYZ');
    expect(resumePrompt).toContain('USER=ok');
  });

  // --- Dimension 3: cost/token accumulation across iterations ---

  it('COST: accumulates total_cost_usd across loop_group iterations', async () => {
    // 2 iterations: iter 1 no signal (cost 0.01), iter 2 DONE (cost 0.02).
    // The group sums per-iteration cost into its NodeExecutionResult; the outer runLayers
    // then aggregates it into the run's total_cost_usd.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      const cost = calls === 1 ? 0.01 : 0.02;
      const content = calls === 1 ? 'work in progress' : 'done\nDONE';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `s-${calls}`, cost };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-cost');

    const nodes: DagNode[] = [
      {
        id: 'paid',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-cost', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);
    const completeCalls = (
      store.completeWorkflowRun as Mock<
        (id: string, metadata?: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(completeCalls.length).toBe(1);
    // 0.01 + 0.02 = 0.03 accumulated across the group's 2 iterations.
    expect(completeCalls[0][1]).toMatchObject({ total_cost_usd: 0.03 });
  });

  it('COST: accumulates token usage across loop_group iterations', async () => {
    mockCaptureWorkflowCompleted.mockClear();
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      const content = calls === 1 ? 'work in progress' : 'done\nDONE';
      yield { type: 'assistant', content };
      yield {
        type: 'result',
        sessionId: `s-${calls}`,
        tokens: calls === 1 ? { input: 100, output: 10 } : { input: 200, output: 20 },
      };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-tokens');

    const nodes: DagNode[] = [
      {
        id: 'paid',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-tokens', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);
    // The group sums tokens across iterations into its result; the outer runLayers
    // rolls them into the run totals reported via telemetry.
    expect(mockCaptureWorkflowCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed', tokensIn: 300, tokensOut: 30 })
    );
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    // The BODY node's per-iteration rows are the authoritative per-node usage.
    const bodyEvents = eventCalls.filter(
      ([arg]) => arg.event_type === 'node_completed' && arg.step_name === 'paid.work'
    );
    expect(bodyEvents.map(([arg]) => arg.data?.tokens)).toEqual([
      { input: 100, output: 10 },
      { input: 200, output: 20 },
    ]);
    // The GROUP row must NOT repeat the same total under the same field name: body
    // rows and the aggregate live in one event stream, so a consumer summing
    // `data.tokens` would otherwise count this group twice (600/60 for 300/30).
    const groupEvent = eventCalls.find(
      ([arg]) => arg.event_type === 'node_completed' && arg.step_name === 'paid'
    );
    expect(groupEvent).toBeDefined();
    expect(groupEvent?.[0].data).not.toHaveProperty('tokens');
    // The property the persisted stream must hold: a naive consumer summing every
    // node_completed row's tokens gets the run's real usage, with no discriminator.
    const naiveSum = eventCalls
      .filter(([arg]) => arg.event_type === 'node_completed')
      .reduce(
        (acc, [arg]) => {
          const t = arg.data?.tokens as { input: number; output: number } | undefined;
          return t ? { input: acc.input + t.input, output: acc.output + t.output } : acc;
        },
        { input: 0, output: 0 }
      );
    expect(naiveSum).toEqual({ input: 300, output: 30 });
  });

  it('COST: a loop_group gate → bare approve → finalize does not double-count body tokens (#2333)', async () => {
    // Both phases write to ONE event store, the way a real database behaves. Per-test
    // isolation would hide the defect entirely: the body's per-iteration rows are
    // persisted BEFORE the pause and survive it, so a finalize row carrying the same
    // usage doubles it in the single stream a consumer actually reads.
    const store = createMockStore();
    const nodes: DagNode[] = [
      {
        id: 'refine',
        loop_group: {
          until: 'APPROVED',
          max_iterations: 5,
          fresh_context: false,
          interactive: true,
          gate_message: 'Review the result.',
          nodes: [{ id: 'work', prompt: 'validate', depends_on: [] }],
        },
        depends_on: [],
      },
    ];
    const workflow = { name: 'lg-finalize-tokens', nodes };

    // Phase 1 — iteration 1 signals but still gates (fresh interactive, no
    // signal_completes). Its body row persists 100/10, the run's ONLY real usage.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'validation PASS\nAPPROVED' };
      yield { type: 'result', sessionId: 'lg-dbl-sess-1', tokens: { input: 100, output: 10 } };
    });

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      makeWorkflowRun('lg-finalize-tokens-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);

    // Phase 2 — bare approve. The resumed run carries EXACTLY the context the gate
    // persisted, so what the pause writes is what the finalize reads.
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'should never run' };
      yield { type: 'result', sessionId: 'never', tokens: { input: 999, output: 99 } };
    });
    const aiCallsBeforeResume = mockSendQueryDag.mock.calls.length;

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-lg',
      testDir,
      workflow,
      makeWorkflowRun('lg-finalize-tokens-run', {
        metadata: {
          approval: pauseCalls[0][1],
          loop_user_input: '',
          loop_feedback_given: false,
        },
      }),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Finalized from the persisted output — no body iteration re-ran.
    expect(mockSendQueryDag.mock.calls.length).toBe(aiCallsBeforeResume);

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    const completedRows = eventCalls.filter(([arg]) => arg.event_type === 'node_completed');
    expect(completedRows.map(([arg]) => arg.step_name)).toEqual(['refine.work', 'refine']);
    // The pre-pause body row is authoritative and still present after the resume.
    expect(completedRows[0][0].data?.tokens).toEqual({ input: 100, output: 10 });
    // The finalize row is an aggregate over body rows that already carry the usage —
    // same reason the natural-completion group row omits `tokens`.
    expect(completedRows[1][0].data).not.toHaveProperty('tokens');
    // The property the persisted stream must hold across a gate: a naive consumer
    // summing every node_completed row's tokens gets the run's real usage.
    const naiveSum = completedRows.reduce(
      (acc, [arg]) => {
        const t = arg.data?.tokens as { input: number; output: number } | undefined;
        return t ? { input: acc.input + t.input, output: acc.output + t.output } : acc;
      },
      { input: 0, output: 0 }
    );
    expect(naiveSum).toEqual({ input: 100, output: 10 });
  });

  it('omits tokens from loop_group body node_completed events when providers report no usage', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 'lg-no-usage-sid' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const nodes: DagNode[] = [
      {
        id: 'no-usage-group',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-lg-no-usage',
      testDir,
      { name: 'lg-no-usage', nodes },
      makeWorkflowRun('lg-no-usage-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls as Array<
      [{ event_type: string; step_name: string; data?: Record<string, unknown> }]
    >;
    const bodyEvent = eventCalls.find(
      ([event]) =>
        event.event_type === 'node_completed' && event.step_name === 'no-usage-group.work'
    );
    expect(bodyEvent).toBeDefined();
    expect(bodyEvent?.[0].data).not.toHaveProperty('tokens');
    const groupEvent = eventCalls.find(
      ([event]) => event.event_type === 'node_completed' && event.step_name === 'no-usage-group'
    );
    expect(groupEvent).toBeDefined();
    expect(groupEvent?.[0].data).not.toHaveProperty('tokens');
  });

  it('SESSION: fresh_context=false threads the body session between iterations', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: calls >= 2 ? 'done\nDONE' : 'progress' };
      yield { type: 'result', sessionId: `lg-sess-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-session-thread');

    const nodes: DagNode[] = [
      {
        id: 'stateful',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-session-thread', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    // Iteration 1: always fresh.
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    // Iteration 2: resumes iteration 1's session (fresh_context: false).
    expect(mockSendQueryDag.mock.calls[1][2]).toBe('lg-sess-1');
  });

  it('SESSION: fresh_context=true starts a fresh body session every iteration', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: calls >= 2 ? 'done\nDONE' : 'progress' };
      yield { type: 'result', sessionId: `lg-fresh-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-session-fresh');

    const nodes: DagNode[] = [
      {
        id: 'stateless',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: true,
          nodes: [{ id: 'work', prompt: 'do work', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-session-fresh', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    expect(mockSendQueryDag.mock.calls[1][2]).toBeUndefined();
  });

  it('WHEN: a body node when: gates on a sibling output per iteration without leaking skip state', async () => {
    // Iteration 1: gate node outputs 'stop' → work is skipped (when false) → no
    // completed terminal output → no signal → iteration 2. Iteration 2: gate outputs
    // 'go' → work runs and emits DONE. Proves (1) when: evaluates against the SAME
    // iteration's scoped outputs and (2) skip state doesn't leak into iteration 2.
    let gateCalls = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      if (prompt.includes('GATE')) {
        gateCalls++;
        yield { type: 'assistant', content: gateCalls === 1 ? 'stop' : 'go' };
        yield { type: 'result', sessionId: `gate-${gateCalls}` };
      } else {
        yield { type: 'assistant', content: 'work ran\nDONE' };
        yield { type: 'result', sessionId: 'work-1' };
      }
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-when');

    const nodes: DagNode[] = [
      {
        id: 'gated',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: true,
          nodes: [
            { id: 'gate', prompt: 'GATE: decide', depends_on: [] },
            {
              id: 'work',
              prompt: 'do the work',
              depends_on: ['gate'],
              when: "$gate.output == 'go'",
            },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-when', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // gate ran twice (both iterations); work ran once (iteration 2 only).
    expect(gateCalls).toBe(2);
    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    expect(result).toContain('work ran');
  });

  it('EDGE A2: a failed upstream body node skips its dependent and fails the group with the real error', async () => {
    // Multi-node body: implement fails → verify (depends_on implement) is skipped by
    // trigger-rule semantics → group fails fast with implement's error, one iteration.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      calls++;
      if (prompt.includes('IMPLEMENT')) {
        throw new Error('implement blew up');
      }
      yield { type: 'assistant', content: 'verified\nDONE' };
      yield { type: 'result', sessionId: 'v-1' };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-multi-fail');

    const nodes: DagNode[] = [
      {
        id: 'pipeline',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            { id: 'implement', prompt: 'IMPLEMENT: fix it', depends_on: [] },
            { id: 'verify', prompt: 'verify the fix', depends_on: ['implement'] },
          ],
        },
        depends_on: [],
      },
    ];

    const result = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-multi-fail', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    // Only implement's single (failing) call ran — verify was skipped, no iteration 2.
    expect(calls).toBe(1);
    expect(result).toBeUndefined();
    const sent = (platform.sendMessage as Mock<(...args: unknown[]) => Promise<void>>).mock.calls
      .map(c => String(c[1]))
      .join('\n');
    expect(sent).toContain('implement blew up');
    expect(sent).not.toContain('exceeded max iterations');
  });

  // --- Dimension 2: output_type typed artifact from final iteration ---

  it('OUTPUT_TYPE: loop_group with output_type writes a sidecar from the final terminal output', async () => {
    // The group declares output_type: 'result'. On completion, the outer runLayers writes
    // nodes/{groupId}.md from the group's NodeExecutionResult.output (= final iteration's
    // terminal output).
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      const content = calls === 1 ? 'draft v1' : 'final result v2\nDONE';
      yield { type: 'assistant', content };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-artifact');
    const artifactsDir = join(testDir, 'artifacts');

    const nodes: DagNode[] = [
      {
        id: 'producer',
        output_type: 'result',
        loop_group: {
          until: 'DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'produce output', depends_on: [] }],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-artifact', nodes },
      workflowRun,
      'claude',
      undefined,
      artifactsDir,
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);
    // The sidecar artifact carries the final iteration's terminal output.
    const written = await readFile(join(artifactsDir, 'nodes', 'producer.md'), 'utf8');
    expect(written).toContain('final result v2');
    expect(written).not.toContain('draft v1');
  });
});

// #2090: loop_group body lifecycle events must carry a namespaced persisted `step_name`
// (`<groupId>.<nodeId>`, composing across nested groups) plus the current `iteration`, while
// the in-process emitter payloads stay raw. Top-level DAG events are unchanged (bare id).
describe('executeDagWorkflow -- loop_group body step_name namespacing (#2090)', () => {
  let testDir: string;

  /** All persisted createWorkflowEvent payloads for a store mock. */
  type PersistedEvent = { event_type: string; step_name?: string; data?: Record<string, unknown> };
  const persistedEvents = (store: IWorkflowStore): PersistedEvent[] =>
    (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      c => c[0] as PersistedEvent
    );
  const eventsWith = (
    store: IWorkflowStore,
    eventType: string,
    stepName: string
  ): PersistedEvent[] =>
    persistedEvents(store).filter(e => e.event_type === eventType && e.step_name === stepName);

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-lg-ns-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('namespaces body node lifecycle step_name and tags iteration; top-level node stays bare', async () => {
    // `work` (AI) does not emit DONE on iteration 1, emits it on iteration 2 → 2 iterations.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield {
        type: 'assistant',
        content: calls === 1 ? 'still working' : 'finished\nDONE',
      };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-ns-run');

    const nodes: DagNode[] = [
      // Top-level bash node — its events must NOT be namespaced and must NOT carry iteration.
      { id: 'setup', bash: 'echo ready', depends_on: [] },
      {
        id: 'fixer',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work, emit DONE when done', depends_on: [] }],
        },
        depends_on: ['setup'],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-ns', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);

    // Body node events are namespaced `<groupId>.<nodeId>`.
    const bodyStarted = eventsWith(store, 'node_started', 'fixer.work');
    const bodyCompleted = eventsWith(store, 'node_completed', 'fixer.work');
    expect(bodyStarted.length).toBe(2); // one per iteration
    expect(bodyCompleted.length).toBe(2);
    // Each body lifecycle event carries the iteration it ran in.
    expect(bodyStarted.map(e => e.data?.iteration).sort()).toEqual([1, 2]);
    expect(bodyCompleted.map(e => e.data?.iteration).sort()).toEqual([1, 2]);

    // The raw (un-namespaced) body id must NEVER appear as a persisted step_name.
    expect(persistedEvents(store).some(e => e.step_name === 'work')).toBe(false);

    // The group node's OWN events keep the bare group id (they are not body events).
    expect(eventsWith(store, 'node_completed', 'fixer').length).toBeGreaterThanOrEqual(1);
    expect(eventsWith(store, 'loop_iteration_started', 'fixer').length).toBe(2);

    // Top-level node keeps its bare id and carries no `iteration` tag.
    const setupStarted = eventsWith(store, 'node_started', 'setup');
    expect(setupStarted.length).toBe(1);
    expect(setupStarted[0].data?.iteration).toBeUndefined();
    expect(eventsWith(store, 'node_completed', 'setup').length).toBe(1);
  });

  it('composes the prefix across nested loop_groups (<outer>.<inner>.<leaf>)', async () => {
    // Inner group completes in 1 iteration (INNER_DONE); outer completes when review emits
    // OUTER_DONE. Mirrors the EDGE H harness above.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield {
        type: 'assistant',
        content: calls === 1 ? 'inner work\nINNER_DONE' : 'outer review\nOUTER_DONE',
      };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-nested-ns');

    const nodes: DagNode[] = [
      {
        id: 'outer',
        loop_group: {
          until: 'OUTER_DONE',
          max_iterations: 3,
          fresh_context: false,
          nodes: [
            {
              id: 'inner',
              loop_group: {
                until: 'INNER_DONE',
                max_iterations: 2,
                fresh_context: false,
                nodes: [{ id: 'leaf', prompt: 'inner work, emit INNER_DONE', depends_on: [] }],
              },
              depends_on: [],
            },
            { id: 'review', prompt: 'review, emit OUTER_DONE', depends_on: ['inner'] },
          ],
        },
        depends_on: [],
      },
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-nested-ns', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(calls).toBe(2);

    // Deepest body node composes both enclosing group ids.
    expect(eventsWith(store, 'node_completed', 'outer.inner.leaf').length).toBeGreaterThanOrEqual(
      1
    );
    // The inner group's OWN events are namespaced by the outer group only.
    expect(
      eventsWith(store, 'loop_iteration_started', 'outer.inner').length
    ).toBeGreaterThanOrEqual(1);
    // The outer body's sibling AI node is namespaced by the outer group.
    expect(eventsWith(store, 'node_completed', 'outer.review').length).toBeGreaterThanOrEqual(1);
    // No un-namespaced leaf/review rows leak.
    expect(persistedEvents(store).some(e => e.step_name === 'leaf')).toBe(false);
    expect(persistedEvents(store).some(e => e.step_name === 'review')).toBe(false);
  });

  it('keeps the in-process emitter payload raw (unprefixed nodeId) for body events', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 's-1' };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-emit-raw');

    const captured: WorkflowEmitterEvent[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe(e => {
      if (e.runId === workflowRun.id) captured.push(e);
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-lg',
        testDir,
        {
          name: 'lg-emit-raw',
          nodes: [
            {
              id: 'fixer',
              loop_group: {
                until: 'DONE',
                max_iterations: 3,
                fresh_context: false,
                nodes: [{ id: 'work', prompt: 'do work, emit DONE', depends_on: [] }],
              },
              depends_on: [],
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      unsubscribe();
    }

    // The live emitter carries the RAW body node id (consumers key off this) — never `fixer.work`.
    const bodyCompleted = captured.filter(
      e => e.type === 'node_completed' && 'nodeId' in e && e.nodeId === 'work'
    );
    expect(bodyCompleted.length).toBeGreaterThanOrEqual(1);
    expect(
      captured.some(e => 'nodeId' in e && (e as { nodeId?: string }).nodeId === 'fixer.work')
    ).toBe(false);
  });

  it('resume: a namespaced body key in priorCompletedNodes cannot skip a top-level node', async () => {
    // Simulate a resume where a prior run's loop_group completed: the map holds the group id
    // AND a namespaced body key. The group must be skipped as a unit (body does NOT re-run),
    // and the un-namespaced body key must NOT be mistaken for the still-pending top-level node.
    let calls = 0;
    mockSendQueryDag.mockImplementation(function* () {
      calls++;
      yield { type: 'assistant', content: 'finalize output' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('lg-resume');

    const priorCompletedNodes = new Map<string, string>([
      ['fixer', 'group output from prior run'],
      ['fixer.work', 'body output from prior run'],
    ]);

    const nodes: DagNode[] = [
      {
        id: 'fixer',
        loop_group: {
          until: 'DONE',
          max_iterations: 5,
          fresh_context: false,
          nodes: [{ id: 'work', prompt: 'do work, emit DONE', depends_on: [] }],
        },
        depends_on: [],
      },
      { id: 'finalize', prompt: 'finalize using $fixer.output', depends_on: ['fixer'] },
    ];

    let finalizePrompt = '';
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      calls++;
      finalizePrompt = prompt;
      yield { type: 'assistant', content: 'finalize output' };
      yield { type: 'result', sessionId: `s-${calls}` };
    });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-lg',
      testDir,
      { name: 'lg-resume', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );

    // Only `finalize` executes: the loop_group `fixer` was skipped as a unit (body never
    // re-ran), and the namespaced `fixer.work` key skipped nothing at the top level.
    expect(calls).toBe(1);
    // The skipped group's pre-populated output flows into the still-running downstream node.
    expect(finalizePrompt).toContain('group output from prior run');
    // The group was skipped via its own id, and finalize genuinely ran.
    expect(eventsWith(store, 'node_skipped_prior_success', 'fixer').length).toBe(1);
    expect(eventsWith(store, 'node_completed', 'finalize').length).toBe(1);
  });
});

describe('resolveBashPath -- platform-aware bash binary resolution (#1326)', () => {
  const originalEnv = process.env.ARCHON_BASH_PATH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ARCHON_BASH_PATH;
    } else {
      process.env.ARCHON_BASH_PATH = originalEnv;
    }
  });

  it('returns the platform default when ARCHON_BASH_PATH is unset', () => {
    delete process.env.ARCHON_BASH_PATH;
    const result = git.resolveBashPath();
    if (process.platform === 'win32') {
      // Multi-candidate scan: first existing Git-Bash location, or the
      // canonical Program Files default when none exist.
      expect(result.endsWith('\\bash.exe')).toBe(true);
    } else {
      expect(result).toBe('bash');
    }
  });

  it('returns the ARCHON_BASH_PATH override when the path exists', () => {
    // process.execPath is the test runner binary — always exists, cross-platform.
    process.env.ARCHON_BASH_PATH = process.execPath;
    expect(git.resolveBashPath()).toBe(process.execPath);
  });

  it('throws with an actionable message when ARCHON_BASH_PATH points to a non-existent path', () => {
    process.env.ARCHON_BASH_PATH = '/definitely/does/not/exist/bash';
    expect(() => git.resolveBashPath()).toThrow(
      /ARCHON_BASH_PATH points to a path that does not exist/
    );
  });

  it('error message includes both the bad path and the Git Bash hint', () => {
    process.env.ARCHON_BASH_PATH = '/definitely/does/not/exist/bash';
    try {
      git.resolveBashPath();
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('/definitely/does/not/exist/bash');
      expect(msg).toContain('LOCALAPPDATA');
    }
  });
});

describe('executeDagWorkflow -- provider-boundary session threading (#1992)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-provbound-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function runWorkflow(
    conversationId: string,
    workflow: { name: string; nodes: DagNode[] },
    workflowRun: WorkflowRun
  ): Promise<WorkflowDeps> {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    await executeDagWorkflow(
      mockDeps,
      platform,
      conversationId,
      testDir,
      workflow,
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
    return mockDeps;
  }

  async function runTwoNodeWorkflow(secondNode: DagNode): Promise<void> {
    await runWorkflow(
      'conv-prov-bound',
      {
        name: 'dag-provider-boundary',
        nodes: [{ id: 'a', prompt: 'First step' }, secondNode],
      },
      makeWorkflowRun('provider-boundary-run')
    );
  }

  it('sequential node on a DIFFERENT provider gets a fresh session (no cross-provider resume)', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'step done' };
      yield { type: 'result', sessionId: 'sess-a' };
    });

    await runTwoNodeWorkflow({
      id: 'b',
      prompt: 'Second step',
      depends_on: ['a'],
      provider: 'codex',
    });

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    // Node a (claude) ran fresh; node b (codex) must NOT inherit a's claude session id.
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    expect(mockSendQueryDag.mock.calls[1][2]).toBeUndefined();
  });

  it('sequential node on the SAME provider still threads the session', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'step done' };
      yield { type: 'result', sessionId: 'sess-a' };
    });

    await runTwoNodeWorkflow({ id: 'b', prompt: 'Second step', depends_on: ['a'] });

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
    expect(mockSendQueryDag.mock.calls[1][2]).toBe('sess-a');
  });

  it('node after a loop node on a DIFFERENT provider gets a fresh session', async () => {
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      if (prompt.includes('Iterate')) {
        yield { type: 'assistant', content: 'all done <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sess' };
      } else {
        yield { type: 'assistant', content: 'downstream done' };
        yield { type: 'result', sessionId: 'sess-after' };
      }
    });

    await runWorkflow(
      'conv-prov-bound-loop',
      {
        name: 'dag-provider-boundary-loop',
        nodes: [
          {
            id: 'work',
            loop: { prompt: 'Iterate until done.', until: 'COMPLETE', max_iterations: 3 },
          },
          { id: 'after', prompt: 'Summarize', depends_on: ['work'], provider: 'codex' },
        ],
      },
      makeWorkflowRun('provider-boundary-loop-run')
    );

    // 1 loop iteration + 1 downstream call.
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    // Downstream codex node must NOT resume the loop's claude session.
    expect(mockSendQueryDag.mock.calls[1][2]).toBeUndefined();
  });

  it('node after a loop node on the SAME provider still threads the loop session', async () => {
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      if (prompt.includes('Iterate')) {
        yield { type: 'assistant', content: 'all done <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sess' };
      } else {
        yield { type: 'assistant', content: 'downstream done' };
        yield { type: 'result', sessionId: 'sess-after' };
      }
    });

    await runWorkflow(
      'conv-same-prov-loop',
      {
        name: 'dag-same-provider-loop',
        nodes: [
          {
            id: 'work',
            loop: { prompt: 'Iterate until done.', until: 'COMPLETE', max_iterations: 3 },
          },
          { id: 'after', prompt: 'Summarize', depends_on: ['work'] },
        ],
      },
      makeWorkflowRun('same-provider-loop-run')
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(mockSendQueryDag.mock.calls[1][2]).toBe('loop-sess');
  });

  it('loop_group body: provider boundaries stay fresh within and across iterations', async () => {
    // Body: x (claude) -> y (codex), fresh_context: false. y emits DONE on iteration 2.
    // No call may ever receive a resume id: x->y is a provider boundary within the
    // iteration, and each cross-iteration handoff (y's codex cursor into x, x's claude
    // cursor into y) is a provider boundary too.
    let yCalls = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      if (prompt.includes('analyze')) {
        yield { type: 'assistant', content: 'analysis output' };
        yield { type: 'result', sessionId: 'sess-x' };
      } else {
        yCalls++;
        const content = yCalls === 1 ? 'not finished yet' : 'finished\nDONE';
        yield { type: 'assistant', content };
        yield { type: 'result', sessionId: `sess-y-${yCalls}` };
      }
    });

    await runWorkflow(
      'conv-lg-prov',
      {
        name: 'lg-provider-boundary',
        nodes: [
          {
            id: 'fixer',
            loop_group: {
              until: 'DONE',
              max_iterations: 3,
              fresh_context: false,
              nodes: [
                { id: 'x', prompt: 'analyze the failure', depends_on: [] },
                {
                  id: 'y',
                  prompt: 'apply the fix, emit DONE when green',
                  depends_on: ['x'],
                  provider: 'codex',
                },
              ],
            },
            depends_on: [],
          },
        ],
      },
      makeWorkflowRun('lg-provider-boundary')
    );

    // 2 iterations x 2 body nodes = 4 calls, every one fresh.
    expect(mockSendQueryDag.mock.calls.length).toBe(4);
    for (const call of mockSendQueryDag.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
  });

  it('loop_group body: same-provider chain still threads within and across iterations', async () => {
    // Body: x -> y, both claude, fresh_context: false. Threading expectations:
    // iter1: x fresh, y resumes x's session; iter2 seeds y's iter-1 session into x,
    // then y resumes x's iter-2 session.
    let yCalls = 0;
    mockSendQueryDag.mockImplementation(function* (prompt: string) {
      if (prompt.includes('analyze')) {
        yield { type: 'assistant', content: 'analysis output' };
        yield { type: 'result', sessionId: `sess-x-${String(yCalls + 1)}` };
      } else {
        yCalls++;
        const content = yCalls === 1 ? 'not finished yet' : 'finished\nDONE';
        yield { type: 'assistant', content };
        yield { type: 'result', sessionId: `sess-y-${yCalls}` };
      }
    });

    await runWorkflow(
      'conv-lg-same',
      {
        name: 'lg-same-provider',
        nodes: [
          {
            id: 'fixer',
            loop_group: {
              until: 'DONE',
              max_iterations: 3,
              fresh_context: false,
              nodes: [
                { id: 'x', prompt: 'analyze the failure', depends_on: [] },
                { id: 'y', prompt: 'apply the fix, emit DONE when green', depends_on: ['x'] },
              ],
            },
            depends_on: [],
          },
        ],
      },
      makeWorkflowRun('lg-same-provider')
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(4);
    const resumeIds = mockSendQueryDag.mock.calls.map(call => call[2]);
    // iter1: x fresh, y resumes x. iter2: x resumes y's iter-1 session, y resumes x's.
    expect(resumeIds[0]).toBeUndefined();
    expect(resumeIds[1]).toBe('sess-x-1');
    expect(resumeIds[2]).toBe('sess-y-1');
    expect(resumeIds[3]).toBe('sess-x-2');
  });

  it('interactive loop_group resume without a provider tag (legacy pause) restores fresh', async () => {
    // A run paused BEFORE the provider tag existed has approval metadata with a bare
    // sessionId. Restoring it untagged could thread the session into a different
    // provider, so the resume starts fresh instead (safe degradation).
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'resumed and finished\nDONE' };
      yield { type: 'result', sessionId: 'legacy-resume-sess' };
    });

    await runWorkflow(
      'conv-lg-legacy',
      {
        name: 'lg-legacy-resume',
        nodes: [
          {
            id: 'refine',
            loop_group: {
              until: 'DONE',
              max_iterations: 5,
              fresh_context: false,
              interactive: true,
              gate_message: 'Review.',
              nodes: [{ id: 'work', prompt: 'Refine the draft.', depends_on: [] }],
            },
            depends_on: [],
          },
        ],
      },
      makeWorkflowRun('lg-legacy-resume', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'pre-tag-sess-1', // no sessionProvider — legacy pause
            message: 'Review.',
          },
          loop_user_input: 'continue',
        },
      })
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    // The untagged pre-pause session is NOT restored.
    expect(mockSendQueryDag.mock.calls[0][2]).toBeUndefined();
  });

  it('interactive loop_group gate with no live cursor pauses with EXPLICIT null session fields', async () => {
    // Body tail is a PARALLEL layer (two sibling nodes, nothing downstream), which
    // resets the sequential cursor before the gate. The pause payload must write
    // sessionId/sessionProvider as explicit nulls — key omission would let SQLite's
    // json_patch deep-merge keep a stale pair from a previous pause of this run
    // (same convention as ApprovalContext.resolved).
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'checked, not done yet' };
      yield { type: 'result', sessionId: 'parallel-tail-sess' };
    });

    const mockDeps = await runWorkflow(
      'conv-lg-nullpause',
      {
        name: 'lg-null-pause',
        nodes: [
          {
            id: 'refine',
            loop_group: {
              until: 'DONE',
              max_iterations: 5,
              fresh_context: false,
              interactive: true,
              gate_message: 'Review.',
              nodes: [
                { id: 'lint', prompt: 'run lint checks', depends_on: [] },
                { id: 'test', prompt: 'run test checks', depends_on: [] },
              ],
            },
            depends_on: [],
          },
        ],
      },
      makeWorkflowRun('lg-null-pause')
    );

    const pauseCalls = (
      mockDeps.store.pauseWorkflowRun as Mock<
        (id: string, ctx: Record<string, unknown>) => Promise<void>
      >
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    const pauseCtx = pauseCalls[0][1];
    // Keys present with explicit null — NOT omitted, NOT a live session pair.
    expect('sessionId' in pauseCtx).toBe(true);
    expect('sessionProvider' in pauseCtx).toBe(true);
    expect(pauseCtx.sessionId).toBeNull();
    expect(pauseCtx.sessionProvider).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Include expansion — the "zero new runtime machinery" proof.
//
// Expand a parent that `include:`s a child (via expandWorkflowIncludes, exactly
// as discovery does), then run the flattened definition through executeDagWorkflow.
// The executor never sees an include node; the namespaced nodes behave as ordinary
// top-level nodes for events, terminal-output selection, resume-skip, and always_run.
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- include expansion (zero runtime machinery)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-include-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function buildWf(name: string, nodes: unknown[]): WorkflowDefinition {
    return { name, description: name, nodes: nodes.map(n => dagNodeSchema.parse(n)) };
  }

  /**
   * Parent that includes a 2-node bash child (a -> b) and reads `$inc.output`.
   * Expands to: inc__a -> inc__b -> consumer(reads $inc__b.output). `alwaysRunA`
   * flags the child's entry node so resume re-executes it.
   */
  function expandedParentNodes(alwaysRunA = false): DagNode[] {
    const child = buildWf('inc-child', [
      { id: 'a', bash: 'echo AAA', ...(alwaysRunA ? { always_run: true } : {}) },
      { id: 'b', bash: 'echo BBB', depends_on: ['a'] },
    ]);
    const parent = buildWf('inc-parent', [
      { id: 'inc', include: 'inc-child' },
      { id: 'consumer', bash: 'echo $inc.output', depends_on: ['inc'] },
    ]);
    const { workflows, errors } = expandWorkflowIncludes(
      new Map([
        ['inc-child', child],
        ['inc-parent', parent],
      ])
    );
    expect(errors).toHaveLength(0);
    return [...workflows.get('inc-parent')!.nodes];
  }

  function eventList(deps: WorkflowDeps): Array<{ event_type: string; step_name: string }> {
    return (deps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      (call: unknown[]) => call[0] as { event_type: string; step_name: string }
    );
  }

  it('emits namespaced step_names and resolves $inc.output to the child terminal node', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-run-id', { workflow_name: 'inc-parent' });

    const terminalOutput = await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc',
      testDir,
      { name: 'inc-parent', nodes: expandedParentNodes() },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const events = eventList(mockDeps);
    const completedStepNames = events
      .filter(e => e.event_type === 'node_completed')
      .map(e => e.step_name);
    // Included nodes surface as ordinary namespaced top-level nodes in the event log.
    expect(completedStepNames).toContain('inc__a');
    expect(completedStepNames).toContain('inc__b');
    expect(completedStepNames).toContain('consumer');
    // No include node ever reached the executor.
    expect(events.every(e => e.step_name !== 'inc')).toBe(true);

    // $inc.output was rewritten to the child terminal ($inc__b.output = "BBB"), so the
    // run's terminal output (consumer, the sole sink) carries it.
    expect(terminalOutput).toContain('BBB');
  });

  it('resume skips a completed namespaced node and re-runs the rest', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-resume-id', { workflow_name: 'inc-parent' });

    // Prior run completed the namespaced entry node inc__a.
    const prior = new Map<string, string>([['inc__a', 'AAA']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc',
      testDir,
      { name: 'inc-parent', nodes: expandedParentNodes() },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      prior
    );

    const events = eventList(mockDeps);
    // inc__a skipped as prior-success (its namespaced id matched the persisted map).
    expect(
      events.some(e => e.event_type === 'node_skipped_prior_success' && e.step_name === 'inc__a')
    ).toBe(true);
    // Downstream namespaced node + consumer still executed.
    const completed = events.filter(e => e.event_type === 'node_completed').map(e => e.step_name);
    expect(completed).toContain('inc__b');
    expect(completed).toContain('consumer');
    expect(completed).not.toContain('inc__a');
  });

  it('always_run on an included node re-executes it on resume', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-always-id', { workflow_name: 'inc-parent' });

    const prior = new Map<string, string>([['inc__a', 'AAA']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc',
      testDir,
      { name: 'inc-parent', nodes: expandedParentNodes(true) },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      prior
    );

    const events = eventList(mockDeps);
    // always_run survived inlining: inc__a is force-reset (re-executed), not skipped.
    expect(
      events.some(e => e.event_type === 'node_always_run_reset' && e.step_name === 'inc__a')
    ).toBe(true);
    expect(
      events.some(e => e.event_type === 'node_skipped_prior_success' && e.step_name === 'inc__a')
    ).toBe(false);
    expect(events.some(e => e.event_type === 'node_completed' && e.step_name === 'inc__a')).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// An unexpanded include node must FAIL LOUDLY, never silently skip — the
// fail-fast guard runs before resume-skip / when / trigger-rule handling.
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- unexpanded include node fail-fast guard', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-inc-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function events(
    deps: WorkflowDeps
  ): Array<{ event_type: string; step_name: string; data: unknown }> {
    return (deps.store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      (call: unknown[]) => call[0] as { event_type: string; step_name: string; data: unknown }
    );
  }

  it('fails (not skips) an unexpanded include node that matches a prior-completed entry', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-guard-resume', { workflow_name: 'inc-guard' });

    // A raw include node reaching the executor with a resume entry for its own id: the
    // guard must fire BEFORE the resume-skip check, so it fails instead of being skipped.
    const includeNode = dagNodeSchema.parse({ id: 'inc', include: 'some-block' });
    const prior = new Map<string, string>([['inc', 'stale prior output']]);

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc-guard',
      testDir,
      { name: 'inc-guard', nodes: [includeNode] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      prior
    );

    const evs = events(mockDeps);
    const failed = evs.find(e => e.event_type === 'node_failed' && e.step_name === 'inc');
    expect(failed).toBeDefined();
    expect((failed!.data as { error: string }).error).toContain('reached the executor unexpanded');
    // Crucially, it was NOT silently skipped as a prior success.
    expect(evs.some(e => e.event_type === 'node_skipped_prior_success')).toBe(false);
  });

  it('fails (not skips) an unexpanded include node whose when: would evaluate false', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-guard-when', { workflow_name: 'inc-guard' });

    // `flag` emits NO; the include's when checks == YES (false → would normally skip). The
    // guard must fire first and fail the node instead.
    const nodes = [
      dagNodeSchema.parse({ id: 'flag', bash: 'echo NO' }),
      dagNodeSchema.parse({
        id: 'inc',
        include: 'some-block',
        depends_on: ['flag'],
        when: "$flag.output == 'YES'",
      }),
    ];

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc-guard',
      testDir,
      { name: 'inc-guard', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const evs = events(mockDeps);
    const failed = evs.find(e => e.event_type === 'node_failed' && e.step_name === 'inc');
    expect(failed).toBeDefined();
    expect((failed!.data as { error: string }).error).toContain('reached the executor unexpanded');
    // It was NOT skipped via the when: gate.
    expect(evs.some(e => e.event_type === 'node_skipped' && e.step_name === 'inc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// An approval node inside an included block: pause + capture_response + no
// cross-talk when the same block is included twice.
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- approval node inside an included block', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-inc-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function buildWf(name: string, nodes: unknown[]): WorkflowDefinition {
    return { name, description: name, nodes: nodes.map(n => dagNodeSchema.parse(n)) };
  }

  it('pauses at the namespaced approval id and exposes capture_response via it', async () => {
    const block = buildWf('apblk', [
      { id: 'approve', approval: { message: 'Approve this?', capture_response: true } },
    ]);
    const parent = buildWf('apparent', [
      { id: 'setup', bash: 'echo setup' },
      { id: 'rev', include: 'apblk', depends_on: ['setup'] },
      // Reads the include's output; the block's sole sink is the approval node, so
      // $rev.output resolves to the captured response via the namespaced id.
      { id: 'after', bash: 'echo $rev.output', depends_on: ['rev'] },
    ]);
    const { workflows, errors } = expandWorkflowIncludes(
      new Map([
        ['apblk', block],
        ['apparent', parent],
      ])
    );
    expect(errors).toHaveLength(0);
    const expanded = workflows.get('apparent')!;

    // capture_response (stored as $<approvalId>.output) is reachable via the namespaced id.
    const after = expanded.nodes.find(n => n.id === 'after');
    expect(after && 'bash' in after ? after.bash : '').toBe('echo $rev__approve.output');

    const store = createMockStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('inc-approval-run', { workflow_name: 'apparent' });

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-inc-approval',
      testDir,
      { name: 'apparent', nodes: expanded.nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const pauseCalls = (
      store.pauseWorkflowRun as Mock<(id: string, ctx: Record<string, unknown>) => Promise<void>>
    ).mock.calls;
    expect(pauseCalls.length).toBe(1);
    // The gate pauses under the namespaced approval id, not the bare block id.
    expect(pauseCalls[0][1]).toMatchObject({
      type: 'approval',
      nodeId: 'rev__approve',
      message: 'Approve this?',
      captureResponse: true,
    });
  });

  it('the same approval block included twice yields distinct namespaced approval ids', () => {
    const block = buildWf('apblk', [{ id: 'approve', approval: { message: 'Approve?' } }]);
    const parent = buildWf('apparent', [
      { id: 'a', include: 'apblk' },
      { id: 'b', include: 'apblk', depends_on: ['a'] },
    ]);
    const { workflows, errors } = expandWorkflowIncludes(
      new Map([
        ['apblk', block],
        ['apparent', parent],
      ])
    );
    expect(errors).toHaveLength(0);
    const ids = workflows.get('apparent')!.nodes.map(n => n.id);
    // Distinct ApprovalContext.nodeId per inclusion → no cross-talk between the two gates.
    expect(ids).toContain('a__approve');
    expect(ids).toContain('b__approve');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('containerCommandName', () => {
  it('returns a bare command unchanged', () => {
    expect(containerCommandName('bash')).toBe('bash');
    expect(containerCommandName('bun')).toBe('bun');
  });

  it('strips a unix directory to the basename', () => {
    expect(containerCommandName('/usr/local/bin/bash')).toBe('bash');
  });

  it('strips a Windows path + .exe (container is always Linux)', () => {
    expect(containerCommandName('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('bash');
  });
});

describe('collectContainerIncompatibleProviders', () => {
  const promptNode = (id: string, provider?: string): DagNode =>
    ({ id, prompt: `do ${id}`, ...(provider ? { provider } : {}) }) as unknown as DagNode;
  const bashNode = (id: string): DagNode => ({ id, bash: 'echo hi' }) as unknown as DagNode;
  const scope = (
    provider: string,
    extra: Partial<WorkflowModelScope> = {}
  ): WorkflowModelScope => ({
    provider,
    model: undefined,
    preset: undefined,
    tier: undefined,
    effort: undefined,
    providerOrigin: 'workflow',
    ...extra,
  });

  it('is empty when all AI nodes resolve to claude (containerExec: true)', () => {
    const nodes = [promptNode('a'), promptNode('b', 'claude'), bashNode('c')];
    const bad = collectContainerIncompatibleProviders(nodes, scope('claude'));
    expect([...bad]).toEqual([]);
  });

  it('flags a node whose provider lacks containerExec (codex)', () => {
    const nodes = [promptNode('a'), promptNode('b', 'codex')];
    const bad = collectContainerIncompatibleProviders(nodes, scope('claude'));
    expect([...bad]).toEqual(['codex']);
  });

  it('flags the workflow-level provider when a node does not override it', () => {
    const nodes = [promptNode('a')];
    const bad = collectContainerIncompatibleProviders(nodes, scope('codex'));
    expect([...bad]).toEqual(['codex']);
  });

  it('ignores bash/script nodes (deterministic, no provider)', () => {
    const nodes = [bashNode('a'), bashNode('b')];
    const bad = collectContainerIncompatibleProviders(nodes, scope('codex'));
    expect([...bad]).toEqual([]);
  });

  it('recurses loop_group bodies', () => {
    const group = {
      id: 'g',
      loop_group: { max_iterations: 2, nodes: [promptNode('inner', 'codex')] },
    } as unknown as DagNode;
    const bad = collectContainerIncompatibleProviders([group], scope('claude'));
    expect([...bad]).toEqual(['codex']);
  });

  it('outer codex + group claude + inherited prompt passes (group never sendQuery)', () => {
    // Preflight used to check the group container AND visit the body with the
    // outer workflow provider, so an inherited prompt kept outer `codex` and
    // falsely rejected a container-safe claude body.
    const group = {
      id: 'g',
      provider: 'claude',
      loop_group: { max_iterations: 1, nodes: [promptNode('inner')] },
    } as unknown as DagNode;
    const bad = collectContainerIncompatibleProviders([group], scope('codex'));
    expect([...bad]).toEqual([]);
  });

  it('group resolving to codex with explicit claude body children passes', () => {
    // Group container provider is irrelevant — only body provider turns count.
    const group = {
      id: 'g',
      provider: 'codex',
      loop_group: {
        max_iterations: 1,
        nodes: [promptNode('a', 'claude'), promptNode('b', 'claude')],
      },
    } as unknown as DagNode;
    const bad = collectContainerIncompatibleProviders([group], scope('claude'));
    expect([...bad]).toEqual([]);
  });

  it('nested-group inheritance applies the inner group scope', () => {
    const nested = {
      id: 'outer',
      provider: 'claude',
      loop_group: {
        max_iterations: 1,
        nodes: [
          {
            id: 'inner',
            provider: 'claude',
            loop_group: {
              max_iterations: 1,
              nodes: [promptNode('leaf')],
            },
          },
        ],
      },
    } as unknown as DagNode;
    // Outer workflow is codex, but both groups select claude — leaf inherits claude.
    expect([...collectContainerIncompatibleProviders([nested], scope('codex'))]).toEqual([]);

    const nestedIncompatible = {
      id: 'outer',
      provider: 'claude',
      loop_group: {
        max_iterations: 1,
        nodes: [
          {
            id: 'inner',
            // No provider → inherits outer group claude, then body selects codex.
            loop_group: {
              max_iterations: 1,
              nodes: [promptNode('leaf', 'codex')],
            },
          },
        ],
      },
    } as unknown as DagNode;
    expect([
      ...collectContainerIncompatibleProviders([nestedIncompatible], scope('claude')),
    ]).toEqual(['codex']);
  });

  it('group model-alias scope is used for inherited body turns', () => {
    const group = {
      id: 'g',
      model: '@safe',
      loop_group: { max_iterations: 1, nodes: [promptNode('inner')] },
    } as unknown as DagNode;
    const profile = {
      defaultProvider: 'codex',
      aliases: {
        '@safe': { provider: 'claude', model: 'claude-sonnet' },
        '@unsafe': { provider: 'codex', model: 'o3' },
      },
    };
    // Outer codex + group alias → claude: body inherits claude, preflight passes.
    expect([
      ...collectContainerIncompatibleProviders([group], scope('codex'), {}, profile),
    ]).toEqual([]);

    const unsafeGroup = {
      id: 'g',
      model: '@unsafe',
      loop_group: { max_iterations: 1, nodes: [promptNode('inner')] },
    } as unknown as DagNode;
    // Group alias → codex: inherited body turn is incompatible.
    expect([
      ...collectContainerIncompatibleProviders([unsafeGroup], scope('claude'), {}, profile),
    ]).toEqual(['codex']);
  });

  it('incompatible inherited body provider turn still rejects before execution', () => {
    const group = {
      id: 'g',
      provider: 'codex',
      loop_group: { max_iterations: 1, nodes: [promptNode('inner')] },
    } as unknown as DagNode;
    const bad = collectContainerIncompatibleProviders([group], scope('claude'));
    expect([...bad]).toEqual(['codex']);
  });

  it('approval/plannotator inside groups inherit the group scope', () => {
    const group = {
      id: 'g',
      provider: 'claude',
      loop_group: {
        max_iterations: 1,
        nodes: [
          {
            id: 'gate',
            approval: { prompt: 'ok?', on_reject: { prompt: 'fix it' } },
          },
          {
            id: 'review',
            plannotator_gate: {
              rework: { prompt: 'Revise it.' },
            },
          },
        ],
      },
    } as unknown as DagNode;
    // Outer is codex, group is claude — inherited approval/rework must not keep codex.
    expect([...collectContainerIncompatibleProviders([group], scope('codex'))]).toEqual([]);

    const incompatibleGroup = {
      id: 'g',
      provider: 'codex',
      loop_group: {
        max_iterations: 1,
        nodes: [
          {
            id: 'gate',
            approval: { prompt: 'ok?', on_reject: { prompt: 'fix it' } },
          },
        ],
      },
    } as unknown as DagNode;
    expect([
      ...collectContainerIncompatibleProviders([incompatibleGroup], scope('claude')),
    ]).toEqual(['codex']);
  });

  it('checks both prepare and rework providers for Plannotator gates', () => {
    const withIncompatiblePrepare = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Write the review.', provider: 'codex' },
        rework: { prompt: 'Revise it.', provider: 'claude' },
      },
    } as unknown as DagNode;
    const withIncompatibleRework = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Write the review.', provider: 'claude' },
        rework: { prompt: 'Revise it.', provider: 'codex' },
      },
    } as unknown as DagNode;

    expect([
      ...collectContainerIncompatibleProviders([withIncompatiblePrepare], scope('claude')),
    ]).toEqual(['codex']);
    expect([
      ...collectContainerIncompatibleProviders([withIncompatibleRework], scope('claude')),
    ]).toEqual(['codex']);
  });

  it('resolves prepare and rework model aliases before checking container compatibility', () => {
    const gate = {
      id: 'review',
      plannotator_gate: {
        prepare: { prompt: 'Write the review.', model: '@codex' },
        rework: { prompt: 'Revise it.', model: 'large' },
      },
    } as unknown as DagNode;
    const profile = {
      defaultProvider: 'claude',
      aliases: {
        '@codex': { provider: 'codex', model: 'codex-alias' },
        large: { provider: 'codex', model: 'codex-tier' },
      },
    };

    expect([
      ...collectContainerIncompatibleProviders([gate], scope('claude'), {}, profile),
    ]).toEqual(['codex']);
  });
});

describe('collectAskHumanUnsupportedProviders', () => {
  const promptNode = (
    id: string,
    extra: {
      provider?: string;
      model?: string;
      allowed_tools?: string[];
      denied_tools?: string[];
    } = {}
  ): DagNode => ({ id, prompt: `do ${id}`, ...extra }) as unknown as DagNode;
  const commandNode = (
    id: string,
    extra: { provider?: string; allowed_tools?: string[] } = {}
  ): DagNode => ({ id, command: 'my-cmd', ...extra }) as unknown as DagNode;
  const loopNode = (
    id: string,
    extra: { provider?: string; allowed_tools?: string[] } = {}
  ): DagNode =>
    ({
      id,
      loop: { prompt: `loop ${id}`, until: 'DONE', max_iterations: 1 },
      ...extra,
    }) as unknown as DagNode;
  const scope = (
    provider: string,
    extra: Partial<WorkflowModelScope> = {}
  ): WorkflowModelScope => ({
    provider,
    model: undefined,
    preset: undefined,
    tier: undefined,
    effort: undefined,
    providerOrigin: 'workflow',
    ...extra,
  });
  const aliasProfile = {
    defaultProvider: 'codex',
    aliases: {
      '@safe': { provider: 'claude', model: 'claude-sonnet' },
      '@unsafe': { provider: 'codex', model: 'o3' },
      '@grok': { provider: 'grok', model: 'grok-1' },
    },
  };

  it.each([
    {
      name: 'AskHuman on a top-level Codex prompt',
      nodes: [promptNode('review', { provider: 'codex', allowed_tools: ['AskHuman'] })],
      scopeProvider: 'claude',
      expected: ['codex'],
    },
    {
      name: 'mcp__archon__AskHuman on inherited workflow grok',
      nodes: [promptNode('review', { allowed_tools: ['mcp__archon__AskHuman'] })],
      scopeProvider: 'grok',
      expected: ['grok'],
    },
    {
      name: 'AskHuman(allow) specifier on a Codex command',
      nodes: [commandNode('review', { provider: 'codex', allowed_tools: ['AskHuman(allow)'] })],
      scopeProvider: 'claude',
      expected: ['codex'],
    },
    {
      name: 'AskHuman on a Codex loop',
      nodes: [loopNode('refine', { provider: 'codex', allowed_tools: ['AskHuman'] })],
      scopeProvider: 'claude',
      expected: ['codex'],
    },
    {
      name: 'Claude with AskHuman is not reported',
      nodes: [promptNode('review', { provider: 'claude', allowed_tools: ['AskHuman'] })],
      scopeProvider: 'codex',
      expected: [],
    },
    {
      name: 'Pi with AskHuman is not reported',
      nodes: [promptNode('review', { provider: 'pi', allowed_tools: ['mcp__archon__AskHuman'] })],
      scopeProvider: 'codex',
      expected: [],
    },
    {
      name: 'denied_tools AskHuman does not match',
      nodes: [promptNode('review', { provider: 'codex', denied_tools: ['AskHuman'] })],
      scopeProvider: 'claude',
      expected: [],
    },
    {
      name: 'unrelated allowed_tools do not match',
      nodes: [promptNode('review', { provider: 'codex', allowed_tools: ['Read', 'Bash'] })],
      scopeProvider: 'claude',
      expected: [],
    },
    {
      name: 'missing allowed_tools does not match',
      nodes: [promptNode('review', { provider: 'codex' })],
      scopeProvider: 'claude',
      expected: [],
    },
  ])('$name', ({ nodes, scopeProvider, expected }) => {
    expect(collectAskHumanUnsupportedProviders(nodes, scope(scopeProvider))).toEqual(expected);
  });

  it('nested loop_group body inherits the inner group provider', () => {
    const nested = {
      id: 'outer',
      provider: 'claude',
      loop_group: {
        max_iterations: 1,
        nodes: [
          {
            id: 'inner',
            provider: 'grok',
            loop_group: {
              max_iterations: 1,
              nodes: [promptNode('leaf', { allowed_tools: ['AskHuman'] })],
            },
          },
        ],
      },
    } as unknown as DagNode;
    expect(collectAskHumanUnsupportedProviders([nested], scope('claude'))).toEqual(['grok']);
  });

  it('group model-alias scope is used for inherited AskHuman body turns', () => {
    const safeGroup = {
      id: 'g',
      model: '@safe',
      loop_group: {
        max_iterations: 1,
        nodes: [promptNode('inner', { allowed_tools: ['AskHuman'] })],
      },
    } as unknown as DagNode;
    expect(
      collectAskHumanUnsupportedProviders([safeGroup], scope('codex'), {}, aliasProfile)
    ).toEqual([]);

    const unsafeGroup = {
      id: 'g',
      model: '@unsafe',
      loop_group: {
        max_iterations: 1,
        nodes: [promptNode('inner', { allowed_tools: ['AskHuman'] })],
      },
    } as unknown as DagNode;
    expect(
      collectAskHumanUnsupportedProviders([unsafeGroup], scope('claude'), {}, aliasProfile)
    ).toEqual(['codex']);
  });

  it('resolves a node model alias through WorkflowModelScope', () => {
    const node = promptNode('review', { model: '@grok', allowed_tools: ['AskHuman'] });
    expect(collectAskHumanUnsupportedProviders([node], scope('claude'), {}, aliasProfile)).toEqual([
      'grok',
    ]);
  });

  it('returns each unsupported provider once in sorted order', () => {
    const nodes = [
      promptNode('a', { provider: 'grok', allowed_tools: ['AskHuman'] }),
      commandNode('b', { provider: 'codex', allowed_tools: ['mcp__archon__AskHuman'] }),
      loopNode('c', { provider: 'codex', allowed_tools: ['AskHuman(allow)'] }),
    ];
    expect(collectAskHumanUnsupportedProviders(nodes, scope('claude'))).toEqual(['codex', 'grok']);
  });
});

describe('executeDagWorkflow -- container preflight group scope', () => {
  const CONTAINER_EXEC = { kind: 'container' as const, containerId: 'cid-preflight' };
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-container-preflight-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    mockSendQueryDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'should not run' };
      yield { type: 'result', sessionId: 'never' };
    });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('rejects incompatible inherited group body before any node executes', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('preflight-reject-run');

    await expect(
      executeDagWorkflow(
        mockDeps,
        platform,
        'conv-preflight',
        testDir,
        {
          name: 'preflight-group',
          nodes: [
            {
              id: 'g',
              provider: 'codex',
              loop_group: {
                max_iterations: 1,
                nodes: [{ id: 'inner', prompt: 'inherited body turn' }],
              },
            } as unknown as DagNode,
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        CONTAINER_EXEC
      )
    ).rejects.toThrow(/Provider 'codex' cannot run inside a container/);

    expect(mockSendQueryDag).not.toHaveBeenCalled();
  });

  it('allows outer codex + group claude inherited body on container', async () => {
    const mockDeps = createMockDeps();
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun('preflight-allow-run');

    // Group selects claude; inherited body must not keep outer codex.
    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-preflight',
      testDir,
      {
        name: 'preflight-group-ok',
        nodes: [
          {
            id: 'g',
            provider: 'claude',
            loop_group: {
              max_iterations: 1,
              until: 'DONE',
              nodes: [{ id: 'inner', prompt: 'say DONE' }],
            },
          } as unknown as DagNode,
        ],
      },
      workflowRun,
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      CONTAINER_EXEC
    );

    expect(mockSendQueryDag).toHaveBeenCalled();
  });
});

describe('buildSubprocessDockerArgs — bash/script env isolation', () => {
  const CTX = { kind: 'container' as const, containerId: 'cid-9' };

  it('delivers the Archon-managed env via -e flags only and runs at the same cwd', () => {
    const args = buildSubprocessDockerArgs(CTX, 'bash', ['-c', 'echo hi'], {
      cwd: '/tmp/ops-client',
      env: { ARTIFACTS_DIR: '/a', ANTHROPIC_API_KEY: 'sk', BASE_BRANCH: 'main' },
    });
    expect(args.slice(0, 2)).toEqual(['exec', '-w']);
    expect(args[2]).toBe('/tmp/ops-client');
    // Every managed var is delivered as an explicit -e flag.
    expect(args).toContain('-e');
    expect(args).toContain('ARTIFACTS_DIR=/a');
    expect(args).toContain('ANTHROPIC_API_KEY=sk');
    expect(args).toContain('BASE_BRANCH=main');
    // Container id, then the normalized command, then the node args.
    const cidIdx = args.indexOf('cid-9');
    expect(cidIdx).toBeGreaterThan(-1);
    expect(args[cidIdx + 1]).toBe('bash');
    expect(args.slice(cidIdx + 2)).toEqual(['-c', 'echo hi']);
  });

  it('does NOT leak host process.env (only the passed env bag is forwarded)', () => {
    const canary = 'ARCHON_DAGEXEC_CANARY';
    process.env[canary] = 'leaked';
    try {
      const args = buildSubprocessDockerArgs(CTX, 'bash', ['-c', 'true'], {
        cwd: '/w',
        env: { ONLY_THIS: '1' },
      });
      const joined = args.join(' ');
      expect(joined).toContain('ONLY_THIS=1');
      expect(joined).not.toContain(canary);
    } finally {
      delete process.env[canary];
    }
  });

  it('normalizes a host bash path to the in-container binary name', () => {
    const args = buildSubprocessDockerArgs(CTX, '/usr/local/bin/bash', ['-c', 'x'], {
      cwd: '/w',
      env: {},
    });
    const cidIdx = args.indexOf('cid-9');
    expect(args[cidIdx + 1]).toBe('bash');
  });

  it('never forwards denylisted keys (PATH/HOME) — a project env var must not clobber resolution', () => {
    const args = buildSubprocessDockerArgs(CTX, 'bash', ['-c', 'true'], {
      cwd: '/w',
      env: { PATH: '/evil/bin', HOME: '/evil', PWD: '/x', KEEP: '1' },
    });
    const joined = args.join(' ');
    expect(joined).not.toContain('PATH=/evil/bin');
    expect(joined).not.toContain('HOME=/evil');
    expect(joined).not.toContain('PWD=/x');
    expect(joined).toContain('KEEP=1'); // non-denylisted keys still forwarded
  });
});

// ---------------------------------------------------------------------------
// Container write-back gate + suspend-on-pause (Phase C)
// ---------------------------------------------------------------------------

describe('executeDagWorkflow -- container write-back gate', () => {
  const CONTAINER_EXEC = { kind: 'container' as const, containerId: 'cid-1' };
  const wbTestDir = join(tmpdir(), `dag-wb-test-${Date.now()}`);

  function makeWritebackBackend(over?: Partial<Record<string, unknown>>) {
    return {
      suspend: mock(async () => undefined),
      finalize: mock(async () => ({ requiresApproval: false as boolean })),
      applyChanges: mock(async () => ({
        filesApplied: 0,
        filesDeleted: 0,
        warnings: [] as string[],
      })),
      discardChanges: mock(async () => undefined),
      ...over,
    };
  }

  /** Run a single pre-completed bash node under a container context so the gate runs. */
  async function runGate(opts: {
    backend: ReturnType<typeof makeWritebackBackend>;
    writeBack?: 'approve' | 'auto';
    runMetadata?: Record<string, unknown>;
    status?: 'running' | 'paused';
    claimed?: boolean;
    failApprovalEvent?: boolean;
    onApprovalRequested?: (pauseCommitted: boolean) => void;
  }): Promise<IWorkflowStore> {
    const store = createMockStore();
    let pauseCommitted = false;
    store.pauseWorkflowRun = mock(async (): Promise<void> => {
      pauseCommitted = true;
    });
    store.createWorkflowEvent = mock(event => {
      if (event.event_type === 'approval_requested') {
        opts.onApprovalRequested?.(pauseCommitted);
        if (opts.failApprovalEvent) return Promise.reject(new Error('event store unavailable'));
      }
      return Promise.resolve();
    });
    store.getWorkflowRunStatus = mock(() => Promise.resolve(opts.status ?? ('running' as const)));
    store.getWorkflowRun = mock(() =>
      Promise.resolve(makeWorkflowRun('wb-run', { metadata: opts.runMetadata ?? {} }))
    );
    store.claimWriteback = mock(() => Promise.resolve({ claimed: opts.claimed ?? true }));
    const deps = createMockDeps(store);
    await executeDagWorkflow(
      deps,
      createMockPlatform(),
      'conv-wb',
      wbTestDir,
      { name: 'wb', nodes: [{ id: 'a', bash: 'echo hi' }] },
      makeWorkflowRun('wb-run'),
      'claude',
      undefined,
      join(wbTestDir, 'artifacts'),
      join(wbTestDir, 'state'),
      join(wbTestDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([['a', 'out']]), // pre-completed → node skipped, DAG reaches the gate
      undefined,
      undefined,
      undefined,
      undefined,
      CONTAINER_EXEC,
      { envId: 'env-x', writeBack: opts.writeBack ?? 'approve', backend: opts.backend }
    );
    return store;
  }

  it('empty diff → completes normally, no pause', async () => {
    const backend = makeWritebackBackend({
      finalize: mock(async () => ({ requiresApproval: false })),
    });
    const store = await runGate({ backend });
    expect(backend.finalize).toHaveBeenCalledTimes(1);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(backend.suspend).not.toHaveBeenCalled();
  });

  it('non-empty diff + approve policy → pauses (writeback) + suspends, does NOT complete', async () => {
    const backend = makeWritebackBackend({
      finalize: mock(async () => ({
        requiresApproval: true,
        changeSummary: {
          added: ['x.md'],
          modified: [],
          deleted: [],
          symlinks: [],
          skipped: [],
          totalCount: 1,
          truncated: false,
        },
      })),
    });
    let pauseCommittedAtApprovalRequest = false;
    const store = await runGate({
      backend,
      failApprovalEvent: true,
      onApprovalRequested: committed => {
        pauseCommittedAtApprovalRequest = committed;
      },
    });
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    const pauseCall = (store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls[0];
    const pauseArg = pauseCall[1] as { nodeId: string; type: string };
    expect(pauseArg.nodeId).toBe('__writeback__');
    expect(pauseArg.type).toBe('writeback');
    // pending_writeback is folded into the SAME pause write (M3), not a 2nd update.
    const extraMeta = pauseCall[2] as { pending_writeback?: { envId: string } };
    expect(extraMeta.pending_writeback?.envId).toBe('env-x');
    expect(pauseCommittedAtApprovalRequest).toBe(true);
    expect(store.createWorkflowEvent).toHaveBeenCalledWith({
      workflow_run_id: 'wb-run',
      event_type: 'approval_requested',
      step_name: '__writeback__',
      data: {
        gateType: 'writeback',
        nodeId: '__writeback__',
        message: expect.any(String),
      },
    });
    expect(backend.suspend).toHaveBeenCalledTimes(1);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('non-empty diff + auto policy → applies without pausing, then completes', async () => {
    const backend = makeWritebackBackend({
      finalize: mock(async () => ({
        requiresApproval: true,
        changeSummary: {
          added: ['x.md'],
          modified: [],
          deleted: [],
          symlinks: [],
          skipped: [],
          totalCount: 1,
          truncated: false,
        },
      })),
      applyChanges: mock(async () => ({ filesApplied: 1, filesDeleted: 0, warnings: [] })),
    });
    const store = await runGate({ backend, writeBack: 'auto' });
    expect(backend.applyChanges).toHaveBeenCalledTimes(1);
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  });

  // Helper: a writeback approval context resolved to a given decision.
  const wbApproval = (resolved: 'approved' | 'rejected' | null) => ({
    nodeId: '__writeback__',
    message: 'review',
    type: 'writeback' as const,
    resolved,
  });

  it('resume after approve → CLAIMS then applies overlay, marks resolved, completes', async () => {
    const backend = makeWritebackBackend({
      applyChanges: mock(async () => ({ filesApplied: 3, filesDeleted: 1, warnings: [] })),
    });
    const store = await runGate({
      backend,
      runMetadata: { pending_writeback: { envId: 'env-x' }, approval: wbApproval('approved') },
    });
    // R2-F4: the apply is claimed BEFORE the live root is mutated.
    expect(store.claimWriteback).toHaveBeenCalledTimes(1);
    expect(backend.applyChanges).toHaveBeenCalledTimes(1);
    expect(backend.finalize).not.toHaveBeenCalled(); // resume path skips re-inspection
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  });

  // R2-F4 — a lost claim (concurrent/prior resume owns the apply, or a crash left it
  // claimed after a successful apply) must NOT re-apply; complete as applied.
  it('resume after approve with a LOST claim does NOT re-apply', async () => {
    const backend = makeWritebackBackend();
    const store = await runGate({
      backend,
      claimed: false,
      runMetadata: { pending_writeback: { envId: 'env-x' }, approval: wbApproval('approved') },
    });
    expect(store.claimWriteback).toHaveBeenCalledTimes(1);
    expect(backend.applyChanges).not.toHaveBeenCalled(); // no double-apply
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  });

  // R2-F4 — a failed apply RELEASES the claim (so `workflow resume` can retry) and
  // propagates the error (run fails → volume preserved by H2).
  it('resume after approve with a FAILED apply releases the claim and rethrows', async () => {
    const backend = makeWritebackBackend({
      applyChanges: mock(async () => {
        throw new Error('cp: No space left on device');
      }),
    });
    // executeDagWorkflow lets the apply error propagate; the outer executor marks the
    // run failed. Assert release was called and the error surfaced.
    let threw = false;
    const store = createMockStore();
    store.getWorkflowRunStatus = mock(() => Promise.resolve('running' as const));
    store.getWorkflowRun = mock(() =>
      Promise.resolve(
        makeWorkflowRun('wb-run', {
          metadata: { pending_writeback: { envId: 'env-x' }, approval: wbApproval('approved') },
        })
      )
    );
    store.claimWriteback = mock(() => Promise.resolve({ claimed: true }));
    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-wb',
        wbTestDir,
        { name: 'wb', nodes: [{ id: 'a', bash: 'echo hi' }] },
        makeWorkflowRun('wb-run'),
        'claude',
        undefined,
        join(wbTestDir, 'artifacts'),
        join(wbTestDir, 'state'),
        join(wbTestDir, 'logs'),
        'main',
        'docs/',
        minimalConfig,
        undefined,
        undefined,
        new Map([['a', 'out']]),
        undefined,
        undefined,
        undefined,
        undefined,
        CONTAINER_EXEC,
        { envId: 'env-x', writeBack: 'approve', backend }
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(store.releaseWritebackClaim).toHaveBeenCalledTimes(1);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  // A stateful store that accumulates metadata from updateWorkflowRun / pauseWorkflowRun,
  // so an apply-throw test can inspect the FINAL run metadata — the exact input the CLI
  // teardown's `hasUnresolvedWriteback` reads to decide preserve-vs-destroy.
  function statefulGateStore(initialMeta: Record<string, unknown>): {
    store: IWorkflowStore;
    metadata: Record<string, unknown>;
  } {
    const metadata: Record<string, unknown> = { ...initialMeta };
    const store = createMockStore();
    store.getWorkflowRunStatus = mock(() => Promise.resolve('running' as const));
    store.getWorkflowRun = mock(() => Promise.resolve(makeWorkflowRun('wb-run', { metadata })));
    store.claimWriteback = mock(() => Promise.resolve({ claimed: true }));
    store.updateWorkflowRun = mock(
      (_id: string, updates: { metadata?: Record<string, unknown> }) => {
        for (const [k, v] of Object.entries(updates.metadata ?? {})) {
          if (v === null) delete metadata[k];
          else metadata[k] = v;
        }
        return Promise.resolve();
      }
    );
    return { store, metadata };
  }

  /** The predicate the CLI teardown uses to PRESERVE the volume (mirror of hasUnresolvedWriteback). */
  const wouldPreserve = (m: Record<string, unknown>): boolean =>
    m.pending_writeback !== undefined && m.writeback_resolved !== true;

  async function runGateWithStore(
    store: IWorkflowStore,
    backend: ReturnType<typeof makeWritebackBackend>,
    writeBack: 'approve' | 'auto'
  ): Promise<void> {
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-wb',
      wbTestDir,
      { name: 'wb', nodes: [{ id: 'a', bash: 'echo hi' }] },
      makeWorkflowRun('wb-run'),
      'claude',
      undefined,
      join(wbTestDir, 'artifacts'),
      join(wbTestDir, 'state'),
      join(wbTestDir, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      new Map([['a', 'out']]),
      undefined,
      undefined,
      undefined,
      undefined,
      CONTAINER_EXEC,
      { envId: 'env-x', writeBack, backend }
    );
  }

  // N1/item-2 — an apply-throw in APPROVE mode leaves the run with pending_writeback set
  // and unresolved, so the teardown PRESERVES the volume (never destroy the only copy).
  it('apply-throw in approve mode leaves an unresolved write-back (teardown preserves)', async () => {
    const { store, metadata } = statefulGateStore({
      pending_writeback: { envId: 'env-x' },
      approval: wbApproval('approved'),
    });
    const backend = makeWritebackBackend({
      applyChanges: mock(async () => {
        throw new Error('cp: read-only file system');
      }),
    });
    await expect(runGateWithStore(store, backend, 'approve')).rejects.toThrow(/read-only/);
    expect(wouldPreserve(metadata)).toBe(true);
  });

  // N1 — an apply-throw in AUTO mode must ALSO leave pending_writeback set (auto sets the
  // preserve marker BEFORE mutating the live root), so the teardown preserves the volume.
  it('apply-throw in auto mode sets the preserve marker (teardown preserves)', async () => {
    const { store, metadata } = statefulGateStore({}); // fresh: no pending_writeback yet
    const backend = makeWritebackBackend({
      finalize: mock(async () => ({
        requiresApproval: true,
        changeSummary: {
          added: ['x.md'],
          modified: [],
          deleted: [],
          symlinks: [],
          skipped: [],
          totalCount: 1,
          truncated: false,
        },
      })),
      applyChanges: mock(async () => {
        throw new Error('cp: read-only file system');
      }),
    });
    await expect(runGateWithStore(store, backend, 'auto')).rejects.toThrow(/read-only/);
    expect(metadata.pending_writeback).toBeDefined(); // marker set before the throw
    expect(wouldPreserve(metadata)).toBe(true);
  });

  it('resume after reject → discards overlay (live root untouched), completes', async () => {
    const backend = makeWritebackBackend();
    const store = await runGate({
      backend,
      runMetadata: { pending_writeback: { envId: 'env-x' }, approval: wbApproval('rejected') },
    });
    expect(backend.discardChanges).toHaveBeenCalledTimes(1);
    expect(backend.applyChanges).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  });

  // H1 — FAIL CLOSED. A bare `/workflow resume` (no decision) reaches the still-open
  // gate: it must RE-PAUSE, never apply.
  it('resume with an UNRESOLVED gate re-pauses (fail closed), does NOT apply', async () => {
    const backend = makeWritebackBackend();
    const store = await runGate({
      backend,
      runMetadata: {
        pending_writeback: {
          envId: 'env-x',
          summary: {
            added: ['x'],
            modified: [],
            deleted: [],
            symlinks: [],
            skipped: [],
            totalCount: 1,
            truncated: false,
          },
        },
        approval: wbApproval(null), // gate raised but not yet decided
      },
    });
    expect(backend.applyChanges).not.toHaveBeenCalled();
    expect(backend.discardChanges).not.toHaveBeenCalled();
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1); // re-raised
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  // H1 — a STALE run-wide approval_response from an earlier mid-DAG approval node must
  // NOT auto-apply the write-back gate; only the gate's own approval.resolved counts.
  it('stale top-level approval_response does NOT apply the write-back overlay', async () => {
    const backend = makeWritebackBackend();
    const store = await runGate({
      backend,
      runMetadata: {
        pending_writeback: {
          envId: 'env-x',
          summary: {
            added: ['x'],
            modified: [],
            deleted: [],
            symlinks: [],
            skipped: [],
            totalCount: 1,
            truncated: false,
          },
        },
        approval: wbApproval(null),
        approval_response: 'approved', // stale from a prior gate — must be ignored
      },
    });
    expect(backend.applyChanges).not.toHaveBeenCalled();
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1); // re-raised, not applied
  });

  it('mid-DAG pause suspends the container instead of completing', async () => {
    const backend = makeWritebackBackend();
    const store = await runGate({ backend, status: 'paused' });
    // A node paused the run → suspend fires right after the layer walk; the gate
    // + completion are never reached.
    expect(backend.suspend).toHaveBeenCalledTimes(1);
    expect(backend.finalize).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('a docker-stop failure during suspend does NOT flip the paused run to failed', async () => {
    const backend = makeWritebackBackend({
      suspend: mock(async () => {
        throw new Error('Cannot connect to the Docker daemon');
      }),
    });
    // status 'paused' → the mid-DAG suspend path runs; a suspend throw is best-effort.
    const store = await runGate({ backend, status: 'paused' });
    expect(backend.suspend).toHaveBeenCalledTimes(1);
    // The run stays paused — suspend failure must not mark it failed or complete it.
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });
});

describe('executeDagWorkflow -- gate pause vs external transition (#1123)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dag-pause-race-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(testDir, '.archon', 'commands'), { recursive: true });
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /** Store whose pauseWorkflowRun loses the CAS because an operator cancelled
   *  the run in the window between gate raise and pause commit. */
  function createExternallyCancelledStore(): IWorkflowStore {
    const store = createMockStore();
    let pauseAttempted = false;
    store.pauseWorkflowRun = mock(() => {
      pauseAttempted = true;
      return Promise.reject(
        new Error('Workflow run not found or not in running state (id: dag-test-run-id)')
      );
    });
    store.getWorkflowRunStatus = mock(() =>
      Promise.resolve(pauseAttempted ? ('cancelled' as const) : ('running' as const))
    );
    return store;
  }

  it('approval gate that loses the pause CAS to an external transition halts cleanly', async () => {
    const store = createExternallyCancelledStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const emitted: string[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe((event: WorkflowEmitterEvent) => {
      if ('runId' in event && event.runId === workflowRun.id) emitted.push(event.type);
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-pause-race',
        testDir,
        {
          name: 'pause-race-approval',
          nodes: [{ id: 'review', approval: { message: 'Approve this plan?' } }],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      unsubscribe();
    }

    // The gate never actually paused — no approval_pending signal to live UIs.
    expect(emitted).not.toContain('approval_pending');

    // The lost CAS must NOT cascade into a node failure or any terminal write —
    // the external transition owns the run's final state.
    const events = (store.createWorkflowEvent as Mock<() => Promise<void>>).mock.calls.map(
      (c: unknown[]) => (c[0] as { event_type: string }).event_type
    );
    expect(events).not.toContain('approval_requested');
    expect(events).not.toContain('node_failed');
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('interactive loop gate that loses the pause CAS halts cleanly', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Here is the plan. Please review.' };
      yield { type: 'result', sessionId: 'loop-session-race' };
    });

    const store = createExternallyCancelledStore();
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    const emitted: string[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe((event: WorkflowEmitterEvent) => {
      if ('runId' in event && event.runId === workflowRun.id) emitted.push(event.type);
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        platform,
        'conv-pause-race-loop',
        testDir,
        {
          name: 'pause-race-loop',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'User said: $LOOP_USER_INPUT. Refine the plan.',
                until: 'APPROVED',
                max_iterations: 10,
                interactive: true,
                gate_message: 'Review the plan and provide feedback.',
              },
            },
          ],
        },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      unsubscribe();
    }

    expect(emitted).not.toContain('approval_pending');
    const events = (store.createWorkflowEvent as Mock<() => Promise<void>>).mock.calls.map(
      (c: unknown[]) => (c[0] as { event_type: string }).event_type
    );
    expect(events).not.toContain('approval_requested');
    expect(events).not.toContain('node_failed');
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('gate pause failure with the run still running stays a genuine node failure', async () => {
    const store = createMockStore();
    // Pause fails but the run is still 'running' (default mock) — a real store
    // failure, not an external transition. Legacy behavior must hold: the node
    // fails and the run is marked failed.
    store.pauseWorkflowRun = mock(() => Promise.reject(new Error('database connection lost')));
    const mockDeps = createMockDeps(store);
    const platform = createMockPlatform();
    const workflowRun = makeWorkflowRun();

    await executeDagWorkflow(
      mockDeps,
      platform,
      'conv-pause-genuine-failure',
      testDir,
      {
        name: 'pause-genuine-failure',
        nodes: [{ id: 'review', approval: { message: 'Approve this plan?' } }],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    const events = (store.createWorkflowEvent as Mock<() => Promise<void>>).mock.calls.map(
      (c: unknown[]) => (c[0] as { event_type: string }).event_type
    );
    expect(events).toContain('node_failed');
    expect(store.failWorkflowRun).toHaveBeenCalled();
  });
});

type GateIntegrationEvent = Pick<
  WorkflowEventData,
  'workflow_run_id' | 'event_type' | 'step_name' | 'data'
>;

interface DagFakePlannotator {
  bin: string;
  controlDir: string;
  invocationLog: string;
}

let compiledDagFakePlannotator: string | undefined;
let compiledDagFakePlannotatorRoot: string | undefined;

function createDagFakePlannotator(root: string): DagFakePlannotator {
  const controlDir = join(root, 'controls');
  let bin = join(root, 'plannotator');
  const script = process.platform === 'win32' ? join(root, 'plannotator.ts') : bin;
  const invocationLog = join(root, 'plannotator-invocations.jsonl');
  process.env.ARCHON_TEST_PLANNOTATOR_CONTROL_DIR = controlDir;
  process.env.ARCHON_TEST_PLANNOTATOR_INVOCATION_LOG = invocationLog;
  mkdirSync(controlDir, { recursive: true });
  writeFileSync(
    script,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = Bun.argv.slice(2);
if (args[0] === 'annotate' && args.includes('--help')) {
  console.log('annotate --gate --json --persist-session --result-file <path>');
  process.exit(0);
}
const resultIndex = args.indexOf('--result-file');
if (args[0] !== 'annotate' || resultIndex < 0 || !args[resultIndex + 1]) process.exit(64);
const resultFile = args[resultIndex + 1];
const controlDir = process.env.ARCHON_TEST_PLANNOTATOR_CONTROL_DIR;
const invocationLog = process.env.ARCHON_TEST_PLANNOTATOR_INVOCATION_LOG;
if (!controlDir || !invocationLog) process.exit(67);
const key = basename(resultFile);
const readyFile = process.env.PLANNOTATOR_READY_FILE;
if (!readyFile) process.exit(65);
writeFileSync(
  readyFile,
  JSON.stringify({ url: 'http://mac-mini.example.ts.net:19432', isRemote: true, port: 19432 }) + '\\n'
);
appendFileSync(invocationLog, JSON.stringify({ args, document: args[1], resultFile }) + '\\n');
writeFileSync(join(controlDir, key + '.started'), 'started\\n');
if (process.platform !== 'win32') {
  process.on('SIGTERM', () => {
    writeFileSync(join(controlDir, key + '.terminated'), 'terminated\\n');
    process.exit(143);
  });
}
const control = join(controlDir, key + '.control.json');
while (!existsSync(control)) {
  if (!existsSync(controlDir)) process.exit(66);
  await Bun.sleep(5);
}
const decision = JSON.parse(readFileSync(control, 'utf8'));
if (decision.stdout) console.log(decision.stdout);
if (decision.stderr) console.error(decision.stderr);
if (decision.payload !== undefined) {
  const temporary = resultFile + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(decision.payload) + '\\n');
  renameSync(temporary, resultFile);
}
process.exit(decision.exitCode ?? 0);
`
  );
  if (process.platform === 'win32') {
    if (!compiledDagFakePlannotator) {
      compiledDagFakePlannotatorRoot = mkdtempSync(join(tmpdir(), 'dag-fake-plannotator-'));
      compiledDagFakePlannotator = join(compiledDagFakePlannotatorRoot, 'plannotator.exe');
      const compiled = Bun.spawnSync([
        process.execPath,
        'build',
        '--compile',
        script,
        '--outfile',
        compiledDagFakePlannotator,
      ]);
      if (compiled.exitCode !== 0) {
        throw new Error(Buffer.from(compiled.stderr).toString('utf8'));
      }
    }
    bin = compiledDagFakePlannotator;
  } else {
    chmodSync(bin, 0o755);
  }
  return { bin, controlDir, invocationLog };
}

function dagGateAttemptKey(gateId: string, attempt = 1): string {
  return `gate-${encodeURIComponent(gateId)}-attempt-${String(attempt)}.json`;
}

function releaseDagGateDecision(
  fake: DagFakePlannotator,
  gateId: string,
  payload: Record<string, unknown>
): void {
  writeFileSync(
    join(fake.controlDir, `${dagGateAttemptKey(gateId)}.control.json`),
    JSON.stringify({ payload, stdout: 'fake stdout', stderr: 'fake stderr', exitCode: 0 })
  );
}

async function waitForDagGateInvocations(
  fake: DagFakePlannotator,
  count: number
): Promise<Array<{ args: string[]; document: string; resultFile: string }>> {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (existsSync(fake.invocationLog)) {
      const invocations = readFileSync(fake.invocationLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as { args: string[]; document: string; resultFile: string });
      if (invocations.length >= count) return invocations;
    }
    await Bun.sleep(5);
  }
  throw new Error(`Timed out waiting for ${String(count)} Plannotator invocation(s)`);
}

function createDagGateStore(run: WorkflowRun): {
  store: IWorkflowStore;
  events: GateIntegrationEvent[];
} {
  const store = createMockStore();
  const events: GateIntegrationEvent[] = [];
  store.getWorkflowRun = mock(id => Promise.resolve(id === run.id ? structuredClone(run) : null));
  store.getWorkflowRunStatus = mock(id => Promise.resolve(id === run.id ? run.status : null));
  store.pauseWorkflowRun = mock((id, approval) => {
    if (id === run.id) {
      run.status = 'paused';
      run.metadata = { ...run.metadata, approval: { ...approval, resolved: null } };
    }
    return Promise.resolve();
  });
  store.transitionPlannotatorGate = mock(async input => {
    const approval = run.metadata.approval as ApprovalContext | undefined;
    if (run.status !== 'paused') return { outcome: 'stopped' as const, status: run.status };
    if (
      input.runId !== run.id ||
      approval?.type !== 'plannotator_gate' ||
      approval.nodeId !== input.nodeId ||
      approval.gateId !== input.expectedGateId
    ) {
      return { outcome: 'superseded' as const };
    }
    if (approval.resolved != null) {
      return { outcome: 'resolved' as const, resolved: approval.resolved };
    }
    const next: ApprovalContext = {
      ...approval,
      gateId: input.nextGateId ?? input.expectedGateId,
      document: input.document,
      phase: input.phase,
    };
    run.metadata = { ...run.metadata, approval: next };
    return { outcome: 'updated' as const, approval: next };
  });
  store.resolveApprovalGate = mock(async (id, expected, metadata, resolutionEvents) => {
    const approval = run.metadata.approval as ApprovalContext | undefined;
    if (
      id !== run.id ||
      run.status !== 'paused' ||
      approval?.resolved != null ||
      approval?.nodeId !== expected.nodeId ||
      approval.gateId !== expected.gateId
    ) {
      return { resolved: false };
    }
    run.metadata = { ...run.metadata, ...metadata };
    events.push(...resolutionEvents.map(event => ({ workflow_run_id: id, ...event })));
    return { resolved: true };
  });
  store.resumeApprovedGate = mock(async (id, expected) => {
    const approval = run.metadata.approval as ApprovalContext | undefined;
    if (
      id !== run.id ||
      run.status !== 'paused' ||
      approval?.resolved !== 'approved' ||
      approval.nodeId !== expected.nodeId ||
      approval.gateId !== expected.gateId
    ) {
      return { resumed: false };
    }
    run.status = 'running';
    return { resumed: true };
  });
  store.createWorkflowEvent = mock(data => {
    events.push(data);
    return Promise.resolve();
  });
  store.getDagResumeSnapshot = mock(() =>
    Promise.resolve({
      completedNodeOutputs: new Map(
        events
          .filter(event => event.event_type === 'node_completed' && event.step_name !== undefined)
          .map(event => [event.step_name ?? '', String(event.data?.node_output ?? '')])
      ),
      tokens: { input: 0, output: 0 },
    })
  );
  return { store, events };
}

describe('executeDagWorkflow -- production Plannotator gate integration', () => {
  const originalBin = process.env.PLANNOTATOR_BIN;
  const originalFakeControlDir = process.env.ARCHON_TEST_PLANNOTATOR_CONTROL_DIR;
  const originalFakeInvocationLog = process.env.ARCHON_TEST_PLANNOTATOR_INVOCATION_LOG;
  let root: string;
  let artifactsDir: string;
  let fake: DagFakePlannotator;

  beforeEach(() => {
    root = join(
      tmpdir(),
      `dag-plannotator-integration-${String(Date.now())}-${Math.random().toString(36).slice(2)}`
    );
    artifactsDir = join(root, 'artifacts');
    mkdirSync(artifactsDir, { recursive: true });
    fake = createDagFakePlannotator(root);
    process.env.PLANNOTATOR_BIN = fake.bin;
  });

  afterEach(async () => {
    if (originalBin === undefined) delete process.env.PLANNOTATOR_BIN;
    else process.env.PLANNOTATOR_BIN = originalBin;
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    await rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (originalFakeControlDir === undefined)
      delete process.env.ARCHON_TEST_PLANNOTATOR_CONTROL_DIR;
    else process.env.ARCHON_TEST_PLANNOTATOR_CONTROL_DIR = originalFakeControlDir;
    if (originalFakeInvocationLog === undefined)
      delete process.env.ARCHON_TEST_PLANNOTATOR_INVOCATION_LOG;
    else process.env.ARCHON_TEST_PLANNOTATOR_INVOCATION_LOG = originalFakeInvocationLog;
    if (compiledDagFakePlannotatorRoot) {
      await rm(compiledDagFakePlannotatorRoot, { recursive: true, force: true });
    }
  });

  function approveDagGateInvocation(
    gate: DagFakePlannotator,
    invocation: { resultFile: string }
  ): void {
    writeFileSync(
      join(gate.controlDir, `${basename(invocation.resultFile)}.control.json`),
      JSON.stringify({
        payload: { decision: 'approved', feedback: 'Approved' },
        stdout: 'fake stdout',
        stderr: 'fake stderr',
        exitCode: 0,
      })
    );
  }

  function integrationWorkflow(marker: string): WorkflowDefinition {
    const document = join(root, 'producer.html');
    return {
      name: 'real-plannotator-gate',
      nodes: [
        {
          id: 'producer',
          bash: `printf '<html>review</html>' > '${document}'\nprintf '%s\\n' '${document}'`,
        },
        {
          id: 'review',
          depends_on: ['producer'],
          plannotator_gate: {
            document: '$producer.output',
            capture_response: true,
            rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
          },
        },
        {
          id: 'downstream',
          depends_on: ['review'],
          bash: `printf 'ran\\n' >> '${marker}'`,
        },
      ],
    };
  }

  function prepareIntegrationWorkflow(marker: string): WorkflowDefinition {
    const document = join(root, 'prepared.html');
    return {
      name: 'real-plannotator-prepare-gate',
      nodes: [
        {
          id: 'review',
          plannotator_gate: {
            prepare: { prompt: 'Write the initial review document.' },
            capture_response: true,
            rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
          },
        },
        {
          id: 'downstream',
          depends_on: ['review'],
          bash: `printf 'ran\\n' >> '${marker}'`,
        },
      ],
    };
  }

  async function executeIntegrationDag(
    deps: WorkflowDeps,
    run: WorkflowRun,
    workflow: WorkflowDefinition,
    priorCompletedNodes?: Map<string, string>
  ): Promise<string | undefined> {
    return executeDagWorkflow(
      deps,
      createMockPlatform(),
      run.conversation_id ?? 'conv-gate',
      root,
      workflow,
      run,
      'claude',
      undefined,
      artifactsDir,
      join(root, 'state'),
      join(root, 'logs'),
      'main',
      'docs/',
      minimalConfig,
      undefined,
      undefined,
      priorCompletedNodes
    );
  }

  it('runs producer → real gate → downstream and completes exactly once', async () => {
    const marker = join(root, 'downstream.log');
    const run = makeWorkflowRun('run-real-gate', {
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review',
          gateId: 'gate-real',
          phase: 'opening',
          resolved: null,
        },
      },
    });
    const { store, events } = createDagGateStore(run);
    const execution = executeIntegrationDag(
      createMockDeps(store),
      run,
      integrationWorkflow(marker)
    );

    await waitForDagGateInvocations(fake, 1);
    releaseDagGateDecision(fake, 'gate-real', {
      decision: 'approved',
      feedback: 'Approved',
    });
    await execution;

    expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['ran']);
    expect(
      events.filter(event => event.event_type === 'node_completed' && event.step_name === 'review')
    ).toHaveLength(1);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('runs prepare → approve → downstream exactly once', async () => {
    const marker = join(root, 'prepared-downstream.log');
    const document = join(root, 'prepared.html');
    const run = makeWorkflowRun('run-real-prepare-gate', {
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review',
          gateId: 'gate-prepare-real',
          phase: 'opening',
          resolved: null,
        },
      },
    });
    const { store, events } = createDagGateStore(run);
    const prepareCalls: string[] = [];
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mock(function* (
        _prompt: string,
        _cwd: string,
        _resumeSessionId?: string,
        options?: SendQueryOptions
      ) {
        prepareCalls.push(String(options?.nodeConfig?.nodeId));
        writeFileSync(document, '<html><body>prepared</body></html>');
        yield { type: 'assistant' as const, content: document };
      }),
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    const execution = executeIntegrationDag(
      createMockDeps(store),
      run,
      prepareIntegrationWorkflow(marker)
    );

    const [invocation] = await waitForDagGateInvocations(fake, 1);
    expect(invocation?.document).toBe(realpathSync(document));
    expect(prepareCalls).toEqual(['review:prepare']);
    approveDagGateInvocation(fake, invocation!);
    await execution;

    expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['ran']);
    expect(
      events.filter(event => event.event_type === 'node_completed' && event.step_name === 'review')
    ).toHaveLength(1);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('recovers a rotated opening prepare gate from its persisted document exactly once', async () => {
    const marker = join(root, 'recovered-prepared-downstream.log');
    const document = join(root, 'prepared-before-recovery.html');
    writeFileSync(document, '<html><body>prepared before recovery</body></html>');
    const run = makeWorkflowRun('run-recovered-prepare-gate', {
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review',
          gateId: 'gate-rotated-after-rework',
          document,
          phase: 'opening',
          resolved: null,
        },
      },
    });
    const { store, events } = createDagGateStore(run);
    const getAgentProvider = mock(() => {
      throw new Error('prepare must not be invoked while recovering a persisted document');
    });
    mockGetAgentProviderDag.mockImplementation(getAgentProvider);

    const execution = executeIntegrationDag(
      createMockDeps(store),
      run,
      prepareIntegrationWorkflow(marker)
    );

    const [invocation] = await waitForDagGateInvocations(fake, 1);
    expect(invocation?.document).toBe(realpathSync(document));
    expect(getAgentProvider).not.toHaveBeenCalled();
    expect((store.pauseWorkflowRun as Mock).mock.calls[0]?.[1]).toMatchObject({
      nodeId: 'review',
      gateId: 'gate-rotated-after-rework',
      document: realpathSync(document),
      phase: 'waiting_decision',
    });
    expect((store.transitionPlannotatorGate as Mock).mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            nodeId: 'review',
            expectedGateId: 'gate-rotated-after-rework',
          }),
        ],
      ])
    );
    approveDagGateInvocation(fake, invocation!);
    await execution;

    expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['ran']);
    expect(
      events.filter(event => event.event_type === 'node_completed' && event.step_name === 'review')
    ).toHaveLength(1);
    expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('rotates ownership, terminates the old child, and lets only the replacement continue', async () => {
    const marker = join(root, 'takeover-downstream.log');
    const document = join(root, 'producer.html');
    writeFileSync(document, '<html>review</html>');
    const run = makeWorkflowRun('run-takeover', {
      metadata: {
        approval: {
          type: 'plannotator_gate',
          nodeId: 'review',
          gateId: 'gate-a',
          phase: 'opening',
          resolved: null,
        },
      },
    });
    const { store, events } = createDagGateStore(run);
    const deps = createMockDeps(store);
    const workflow = integrationWorkflow(marker);
    const prior = new Map([['producer', document]]);
    const realExecuteGate = plannotatorGateExecutor.executePlannotatorGateNode;
    const gateResults: NodeOutput[] = [];
    const gateSpy = spyOn(plannotatorGateExecutor, 'executePlannotatorGateNode').mockImplementation(
      async args => {
        const result = await realExecuteGate(args);
        gateResults.push(result);
        return result;
      }
    );
    try {
      const oldExecution = executeIntegrationDag(deps, run, workflow, prior);
      await waitForDagGateInvocations(fake, 1);

      const transition = await store.transitionPlannotatorGate({
        runId: run.id,
        nodeId: 'review',
        expectedGateId: 'gate-a',
        nextGateId: 'gate-b',
        document,
        phase: 'opening',
      });
      expect(transition.outcome).toBe('updated');
      run.status = 'running';
      const replacementRun = structuredClone(run);
      const replacementExecution = executeIntegrationDag(deps, replacementRun, workflow, prior);
      const invocations = await waitForDagGateInvocations(fake, 2);

      if (process.platform !== 'win32') {
        for (let attempt = 0; attempt < 600; attempt++) {
          if (existsSync(join(fake.controlDir, `${dagGateAttemptKey('gate-a')}.terminated`))) {
            break;
          }
          await Bun.sleep(5);
        }
        expect(existsSync(join(fake.controlDir, `${dagGateAttemptKey('gate-a')}.terminated`))).toBe(
          true
        );
      }
      await expect(oldExecution).resolves.toBeUndefined();
      expect(gateResults).toContainEqual({ state: 'pending', output: '' });
      expect(store.completeWorkflowRun).not.toHaveBeenCalled();
      releaseDagGateDecision(fake, 'gate-b', {
        decision: 'approved',
        feedback: 'Replacement approved',
      });
      await replacementExecution;

      expect(invocations.map(invocation => basename(invocation.resultFile))).toEqual([
        dagGateAttemptKey('gate-a'),
        dagGateAttemptKey('gate-b'),
      ]);
      expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['ran']);
      expect(
        events.filter(
          event => event.event_type === 'node_completed' && event.step_name === 'review'
        )
      ).toHaveLength(1);
      expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
    } finally {
      gateSpy.mockRestore();
    }
  }, 30_000);
});

describe('bundled feature verification routing', () => {
  for (const failures of [0, 1, 4]) {
    it(`routes ${failures} proof failures without publishing an unverified PR`, async (): Promise<void> => {
      const root = mkdtempSync(join(tmpdir(), 'feature-verify-routing-'));
      const source = readFileSync(
        join(
          import.meta.dir,
          '../../../.archon/workflows/defaults/archon-superpower-feature-verify-loop.yml'
        ),
        'utf8'
      );
      const parsed = parseWorkflow(source, 'archon-superpower-feature-verify-loop.yml');
      if (!parsed.workflow) throw new Error(JSON.stringify(parsed.error));
      const calls: string[] = [];
      let attempts = 0;
      // Preserve the shipped graph and route policy; replace costly AI/proof/PR bodies.
      const nodes: DagNode[] = parsed.workflow.nodes.map((node): DagNode => {
        if ('route_loop' in node) return node;
        const base = {
          id: node.id,
          depends_on: node.depends_on,
          trigger_rule: node.trigger_rule,
          always_run: node.always_run,
        };
        if (node.id === 'verify-blocked') return { ...base, bash: 'exit 1' };
        return { ...base, prompt: `Fixture ${node.id}`, provider: 'claude' };
      });
      mockGetAgentProviderDag.mockImplementation(() => ({
        sendQuery: mock(function* (
          _prompt: string,
          _cwd: string,
          _resumeSessionId?: string,
          options?: SendQueryOptions
        ) {
          const id = options?.nodeConfig?.nodeId;
          if (typeof id !== 'string') throw new Error('Fixture node id missing');
          calls.push(id);
          if (id === 'begin-verify') attempts++;
          yield {
            type: 'assistant' as const,
            content: id === 'record-verify' ? JSON.stringify(attempts > failures) : id,
          };
          yield { type: 'result' as const, sessionId: `fixture-${id}` };
        }),
        getType: (): string => 'claude',
        getCapabilities: mockClaudeCapabilities,
      }));
      const store = createMockStore();
      try {
        await executeDagWorkflow(
          createMockDeps(store),
          createMockPlatform(),
          'feature-verify-fixture',
          root,
          {
            ...parsed.workflow,
            provider: 'claude',
            model: undefined,
            nodes,
            mutates_checkout: false,
          },
          makeWorkflowRun(`feature-verify-${failures}`),
          'claude',
          undefined,
          join(root, 'artifacts'),
          join(root, 'state'),
          join(root, 'logs'),
          'main',
          'docs/',
          minimalConfig
        );
        const expectedAttempts = Math.min(failures + 1, 4);
        for (const id of [
          'begin-verify',
          'finalize-change',
          'prepare-verify',
          'select-verify-targets',
          'normalize-verify-targets',
          'prove',
          'record-verify',
        ]) {
          expect(calls.filter(call => call === id)).toHaveLength(expectedAttempts);
        }
        expect(calls.filter(id => id === 'fix-verify')).toHaveLength(expectedAttempts - 1);
        expect(calls.filter(id => id === 'ralph-loop-run')).toHaveLength(1);
        expect(calls.filter(id => id === 'create-pull-request')).toHaveLength(failures > 3 ? 0 : 1);
        if (failures > 3) {
          expect(store.failWorkflowRun).toHaveBeenCalled();
          expect(store.completeWorkflowRun).not.toHaveBeenCalled();
        } else {
          expect(calls.slice(-2)).toEqual(['authorize-pr', 'create-pull-request']);
          expect(store.completeWorkflowRun).toHaveBeenCalledTimes(1);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

describe('executeDagWorkflow -- superseded plannotator supervisor', () => {
  let testDir: string;
  let executeGateSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-plannotator-superseded-${String(Date.now())}`);
    await mkdir(testDir, { recursive: true });
    executeGateSpy = spyOn(plannotatorGateExecutor, 'executePlannotatorGateNode').mockResolvedValue(
      {
        state: 'pending',
        output: '',
      }
    );
  });

  afterEach(async () => {
    executeGateSpy.mockRestore();
    await rm(testDir, { recursive: true, force: true });
  });

  it('stops before downstream work and terminal writes while status is running', async () => {
    const store = createMockStore();
    store.getWorkflowRunStatus = mock(() => Promise.resolve('running' as const));
    const deps = createMockDeps(store);

    await executeDagWorkflow(
      deps,
      createMockPlatform(),
      'conv-superseded',
      testDir,
      {
        name: 'superseded-gate',
        nodes: [
          {
            id: 'review',
            plannotator_gate: {
              document: 'plan.html',
              rework: { prompt: 'Revise $REVIEW_DOCUMENT using $REVIEW_ANNOTATIONS' },
            },
          },
          { id: 'downstream', command: 'downstream', depends_on: ['review'] },
        ],
      },
      makeWorkflowRun('run-superseded'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(executeGateSpy).toHaveBeenCalledTimes(1);
    expect(mockSendQueryDag).not.toHaveBeenCalled();
    expect(
      (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.some(
        call =>
          (call[0] as { event_type?: string; step_name?: string }).event_type ===
            'node_completed' && (call[0] as { step_name?: string }).step_name === 'review'
      )
    ).toBe(false);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });
});

describe('executeDagWorkflow -- command and prompt transcripts', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-transcript-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Command prompt for $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function transcriptTimeline(
    rows: Awaited<ReturnType<IWorkflowStore['listNodeMessages']>>
  ): string[] {
    return rows.map(row => (row.kind === 'status' ? row.payload.state : row.kind));
  }

  async function runNodes(
    store: IWorkflowStore,
    nodes: DagNode[],
    workflowRun: WorkflowRun = makeWorkflowRun(),
    provider = 'claude'
  ): Promise<WorkflowRun> {
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'transcript-test', provider, nodes },
      workflowRun,
      provider,
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: provider }
    );
    return workflowRun;
  }

  it.each([
    { kind: 'command', node: { id: 'agent', command: 'my-cmd' } },
    { kind: 'prompt', node: { id: 'agent', prompt: 'Inspect a.ts' } },
  ])('records $kind stream as started, text, tool, text, completed', async ({ node }) => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Reading file.' };
      yield {
        type: 'tool',
        toolName: 'Read',
        toolCallId: 'tool-1',
        toolInput: { path: 'a.ts' },
      };
      yield {
        type: 'tool_result',
        toolName: 'Read',
        toolCallId: 'tool-1',
        toolOutcome: 'success',
      };
      yield { type: 'assistant', content: 'Done reading.' };
      yield { type: 'result', sessionId: 'transcript-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [node]);
    const rows = await store.listNodeMessages(workflowRun.id, 'agent');

    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'text',
      'tool',
      'tool',
      'text',
      'completed',
    ]);
    expect(rows.every(row => row.workflow_run_id === workflowRun.id)).toBe(true);
    expect(rows.every(row => row.node_id === 'agent')).toBe(true);
    const toolRows = rows.filter(row => row.kind === 'tool');
    expect(toolRows.map(row => row.payload)).toEqual([
      { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
      { name: 'Read', id: 'tool-1' },
    ]);
    expect(toolRows[0]?.metadata?.tool_phase).toBe('call');
    expect(toolRows[1]?.metadata?.tool_phase).toBe('result');
    expect(toolRows[0]?.metadata?.execution?.occurrence_id).toBe(
      toolRows[1]?.metadata?.execution?.occurrence_id
    );
    expect(toolRows[0]?.metadata?.execution?.occurrence_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(
      rows.filter(row => row.kind === 'status' && row.payload.state === 'completed')
    ).toHaveLength(1);
  });

  it('records assistant text before a later-flushed batch tool row without duplicating it', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Reading file.' };
      yield {
        type: 'tool',
        toolName: 'Read',
        toolCallId: 'tool-1',
        toolInput: { path: 'a.ts' },
      };
      yield { type: 'result', sessionId: 'batch-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'agent', prompt: 'Inspect a.ts' }]);
    const rows = await store.listNodeMessages(workflowRun.id, 'agent');

    expect(transcriptTimeline(rows)).toEqual(['started', 'text', 'tool', 'completed']);
    expect(rows.filter(row => row.kind === 'text')).toHaveLength(1);
    expect(rows.find(row => row.kind === 'text')?.payload).toEqual({ text: 'Reading file.' });
  });

  it('records started then failed with the command-load error', async () => {
    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'missing', command: 'no-such-cmd' }]);
    const rows = await store.listNodeMessages(workflowRun.id, 'missing');
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string; step_name: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'missing'
    );
    expect(failedEvent).toBeDefined();
    const errorMsg = (failedEvent![0] as { data: { error: string } }).data.error;
    expect(errorMsg).toContain('Command prompt not found: no-such-cmd.md');
    expect(transcriptTimeline(rows)).toEqual(['started', 'failed']);
    expect(rows[1]?.kind === 'status' ? rows[1].payload.detail : undefined).toBe(errorMsg);
  });

  it('records started then failed with the exact OutputRefError for an invalid field ref', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '{"verdict":"review"}' };
      yield {
        type: 'result',
        sessionId: 'producer-session',
        structuredOutput: { verdict: 'review' },
      };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'producer',
        prompt: 'decide',
        output_format: {
          type: 'object',
          properties: { verdict: { type: 'string' } },
          required: ['verdict'],
        },
        retry: { max_attempts: 0 },
      },
      {
        id: 'consumer',
        prompt: 'Use $producer.output.nonexistent',
        depends_on: ['producer'],
        retry: { max_attempts: 0 },
      },
    ]);

    const expected = new OutputRefError('producer', 'nonexistent', 'not-in-schema').message;
    const rows = await store.listNodeMessages(workflowRun.id, 'consumer');
    expect(transcriptTimeline(rows)).toEqual(['started', 'failed']);
    expect(rows[1]?.kind === 'status' ? rows[1].payload.detail : undefined).toBe(expected);
  });

  it('records started then failed with the provider lookup error', async () => {
    mockGetAgentProviderDag.mockImplementation(() => {
      throw new Error('provider lookup failed');
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'agent', prompt: 'Inspect a.ts' }]);
    const rows = await store.listNodeMessages(workflowRun.id, 'agent');
    const eventCalls = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls;
    const failedEvent = eventCalls.find(
      (call: unknown[]) =>
        (call[0] as { event_type: string; step_name: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === 'agent'
    );
    expect(failedEvent).toBeDefined();
    expect((failedEvent![0] as { data: { error: string } }).data.error).toBe(
      'provider lookup failed'
    );
    expect(transcriptTimeline(rows)).toEqual(['started', 'failed']);
    expect(rows[1]?.kind === 'status' ? rows[1].payload.detail : undefined).toBe(
      'provider lookup failed'
    );
  });

  it('records exactly one completed terminal on a normal command node', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'All done.' };
      yield { type: 'result', sessionId: 'ok-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'agent', command: 'my-cmd' }]);
    const rows = await store.listNodeMessages(workflowRun.id, 'agent');
    expect(transcriptTimeline(rows)).toEqual(['started', 'text', 'completed']);
    expect(
      rows.filter(row => row.kind === 'status' && row.payload.state === 'completed')
    ).toHaveLength(1);
  });

  it('still completes the workflow when transcript append rejects', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'All done.' };
      yield { type: 'result', sessionId: 'ok-session' };
    });

    const store = createMockStore();
    store.appendNodeMessage = async () => {
      throw new Error('DO_NOT_LOG');
    };

    await runNodes(store, [{ id: 'agent', prompt: 'Inspect a.ts' }]);
    expect(store.completeWorkflowRun).toHaveBeenCalled();
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('does not record transcript rows for bash nodes', async () => {
    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'stats', bash: 'echo hi' }]);
    expect(await store.listNodeMessages(workflowRun.id, 'stats')).toEqual([]);
  });

  it('records two-iteration loop markers with cleaned assistant text between them', async () => {
    let callCount = 0;
    mockSendQueryDag.mockImplementation(function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: 'assistant', content: 'First pass.' };
        yield {
          type: 'tool',
          toolName: 'Read',
          toolCallId: 'tool-1',
          toolInput: { path: 'a.ts' },
        };
        yield { type: 'result', sessionId: 'loop-session-1' };
      } else {
        yield { type: 'assistant', content: 'Second pass. <promise>DONE</promise>' };
        yield { type: 'result', sessionId: 'loop-session-2' };
      }
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'refine',
        loop: {
          prompt: 'Iterate until done.',
          until: 'DONE',
          max_iterations: 5,
        },
      },
    ]);
    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'iteration_started',
      'text',
      'tool',
      'iteration_completed',
      'iteration_started',
      'text',
      'iteration_completed',
      'completed',
    ]);
    expect(
      rows.filter(row => row.kind === 'status' && row.payload.state === 'started')
    ).toHaveLength(1);
    const iterationStarts = rows.filter(
      row => row.kind === 'status' && row.payload.state === 'iteration_started'
    );
    const iterationCompletes = rows.filter(
      row => row.kind === 'status' && row.payload.state === 'iteration_completed'
    );
    expect(
      iterationStarts.map(row => (row.kind === 'status' ? row.payload.detail : undefined))
    ).toEqual(['1', '2']);
    expect(
      iterationCompletes.map(row => (row.kind === 'status' ? row.payload.detail : undefined))
    ).toEqual(['1', '2']);
    const textRows = rows.filter(row => row.kind === 'text');
    expect(textRows[0]?.payload).toEqual({ text: 'First pass.' });
    expect(textRows[1]?.payload).toEqual({ text: 'Second pass.' });
    expect(rows.find(row => row.kind === 'tool')?.payload).toEqual({
      name: 'Read',
      id: 'tool-1',
      input: { path: 'a.ts' },
    });
  });

  it('records iteration_failed before node-level failed on an iteration error', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'result', sessionId: 'empty-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'refine',
        loop: { prompt: 'Iterate.', until: 'DONE', max_iterations: 3 },
      },
    ]);
    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'iteration_started',
      'iteration_failed',
      'failed',
    ]);
    expect(rows[2]?.kind === 'status' ? rows[2].payload.detail : undefined).toBe('1');
  });

  it('closes an in-flight iteration when structured output validation fails', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: '{"confidence":0.9}' };
      yield {
        type: 'result',
        sessionId: 'invalid-structured-session',
        structuredOutput: { confidence: 0.9 },
      };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'refine',
        loop: { prompt: 'Iterate.', until: 'DONE', max_iterations: 3 },
        output_format: {
          type: 'object',
          properties: { verdict: { type: 'string' }, confidence: { type: 'number' } },
          required: ['verdict'],
        },
      },
    ]);
    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'iteration_started',
      'text',
      'iteration_failed',
      'failed',
    ]);
    expect(
      (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.some(
        call =>
          (call[0] as { event_type?: string; step_name?: string }).event_type ===
            'loop_iteration_failed' && (call[0] as { step_name?: string }).step_name === 'refine'
      )
    ).toBe(true);
  });

  it('closes an in-flight iteration when the deterministic completion check cannot start', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Work completed without a signal.' };
      yield { type: 'result', sessionId: 'until-bash-session' };
    });

    const previousBashPath = process.env.ARCHON_BASH_PATH;
    process.env.ARCHON_BASH_PATH = join(testDir, 'missing-bash');
    try {
      const store = createMockStore();
      const workflowRun = await runNodes(store, [
        {
          id: 'refine',
          loop: { prompt: 'Iterate.', until_bash: 'exit 1', max_iterations: 3 },
        },
      ]);
      const rows = await store.listNodeMessages(workflowRun.id, 'refine');
      expect(transcriptTimeline(rows)).toEqual([
        'started',
        'iteration_started',
        'text',
        'iteration_failed',
        'failed',
      ]);
    } finally {
      if (previousBashPath === undefined) {
        delete process.env.ARCHON_BASH_PATH;
      } else {
        process.env.ARCHON_BASH_PATH = previousBashPath;
      }
    }
  });

  it('records started then completed on finalize-on-approve resume without a new iteration marker', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'should never run' };
      yield { type: 'result', sessionId: 'never' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(
      store,
      [
        {
          id: 'refine',
          loop: {
            prompt: 'Refine.',
            until: 'APPROVED',
            max_iterations: 10,
            interactive: true,
            gate_message: 'Review.',
          },
        },
      ],
      makeWorkflowRun('finalize-run', {
        metadata: {
          approval: {
            type: 'interactive_loop',
            nodeId: 'refine',
            iteration: 1,
            sessionId: 'sig-session-1',
            message: 'gate',
            completionSignaled: true,
            signaledOutput: 'REPORT',
            signaledTokens: { input: 40, output: 4 },
          },
          loop_user_input: 'Approved',
          loop_feedback_given: false,
        },
      })
    );
    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(transcriptTimeline(rows)).toEqual(['started', 'completed']);
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('records failed on max-iteration exhaustion without a completed row', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'still working' };
      yield { type: 'result', sessionId: 'loop-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do task.', until: 'COMPLETE', max_iterations: 2 },
      },
    ]);
    const rows = await store.listNodeMessages(workflowRun.id, 'my-loop');
    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'iteration_started',
      'text',
      'iteration_completed',
      'iteration_started',
      'text',
      'iteration_completed',
      'failed',
    ]);
    expect(
      rows.filter(row => row.kind === 'status' && row.payload.state === 'completed')
    ).toHaveLength(0);
  });

  it('does not record completed when an interactive loop pauses at a declared approval gate', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Need review.' };
      yield { type: 'result', sessionId: 'loop-session-1' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'refine',
        loop: {
          prompt: 'Iterate.',
          until: 'DONE',
          max_iterations: 5,
          interactive: true,
          gate_message: 'Review.',
        },
      },
    ]);
    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(transcriptTimeline(rows)).toEqual([
      'started',
      'iteration_started',
      'text',
      'iteration_completed',
    ]);
    expect(
      rows.filter(row => row.kind === 'status' && row.payload.state === 'completed')
    ).toHaveLength(0);
  });

  it('does not record loop-group container output while recording prefixed body transcripts', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'done\nDONE' };
      yield { type: 'result', sessionId: 'lg-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      {
        id: 'grp',
        loop_group: {
          until: 'DONE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'body work' }],
        },
      },
    ]);
    expect(await store.listNodeMessages(workflowRun.id, 'grp')).toEqual([]);
    const bodyRows = await store.listNodeMessages(workflowRun.id, 'grp.body');
    expect(transcriptTimeline(bodyRows)).toEqual(['started', 'text', 'completed']);
  });

  it('persists provider-declared text_mode on direct node text rows and leaves untagged text untagged', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'Hel', textMode: 'delta' };
      yield { type: 'assistant', content: 'lo', textMode: 'delta' };
      yield { type: 'assistant', content: 'whole' };
      yield { type: 'result', sessionId: 'delta-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [{ id: 'agent', prompt: 'Hi' }]);
    const textRows = (await store.listNodeMessages(workflowRun.id, 'agent')).filter(
      row => row.kind === 'text'
    );

    expect(textRows.map(row => row.payload)).toEqual([
      { text: 'Hel' },
      { text: 'lo' },
      { text: 'whole' },
    ]);
    expect(textRows[0]?.metadata?.text_mode).toBe('delta');
    expect(textRows[1]?.metadata?.text_mode).toBe('delta');
    // A chunk the provider did not label stays unlabelled — no inferred text_mode.
    expect(textRows[2]?.metadata?.text_mode).toBeUndefined();
  });

  it('isolates a direct structured-output re-ask pass in a distinct transcript attempt', async () => {
    let call = 0;
    mockSendQueryDag.mockImplementation(function* () {
      call++;
      if (call === 1) {
        yield { type: 'assistant', content: 'bad pass', textMode: 'delta' };
        yield { type: 'result', sessionId: 's1', structuredOutput: { wrong: 'shape' } };
      } else {
        yield { type: 'assistant', content: 'good pass', textMode: 'delta' };
        yield { type: 'result', sessionId: 's2', structuredOutput: { verdict: 'review' } };
      }
    });

    const store = createMockStore();
    const workflowRun = await runNodes(
      store,
      [
        {
          id: 'classify',
          prompt: 'Classify.',
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
          },
        },
      ],
      makeWorkflowRun(),
      'pi'
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const textRows = (await store.listNodeMessages(workflowRun.id, 'classify')).filter(
      row => row.kind === 'text'
    );
    expect(textRows.map(row => row.payload)).toEqual([{ text: 'bad pass' }, { text: 'good pass' }]);
    expect(textRows[0]?.metadata?.text_mode).toBe('delta');
    expect(textRows[1]?.metadata?.text_mode).toBe('delta');
    const firstScope = textRows[0]?.metadata?.execution;
    const secondScope = textRows[1]?.metadata?.execution;
    expect(firstScope?.occurrence_id).toBe(secondScope?.occurrence_id);
    expect(firstScope?.attempt_id).not.toBe(secondScope?.attempt_id);
  });

  it('persists provider-declared text_mode on loop node text rows', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield {
        type: 'assistant',
        content: 'Iterated. <promise>DONE</promise>',
        textMode: 'delta',
      };
      yield { type: 'result', sessionId: 'loop-delta-session' };
    });

    const store = createMockStore();
    const workflowRun = await runNodes(store, [
      { id: 'refine', loop: { prompt: 'Iterate.', until: 'DONE', max_iterations: 3 } },
    ]);
    const textRows = (await store.listNodeMessages(workflowRun.id, 'refine')).filter(
      row => row.kind === 'text'
    );

    expect(textRows).toHaveLength(1);
    expect(textRows[0]?.payload).toEqual({ text: 'Iterated.' });
    expect(textRows[0]?.metadata?.text_mode).toBe('delta');
  });

  it('isolates an invalid-output loop re-ask pass in a distinct transcript attempt', async () => {
    let call = 0;
    mockSendQueryDag.mockImplementation(function* () {
      call++;
      if (call === 1) {
        yield { type: 'assistant', content: 'bad pass', textMode: 'delta' };
        yield { type: 'result', sessionId: 's1', structuredOutput: { wrong: 'shape' } };
      } else {
        yield { type: 'assistant', content: 'good pass', textMode: 'delta' };
        yield {
          type: 'result',
          sessionId: 's2',
          structuredOutput: { verdict: 'review', done: true },
        };
      }
    });

    const store = createMockStore();
    const workflowRun = await runNodes(
      store,
      [
        {
          id: 'refine',
          loop: { prompt: 'Iterate.', until_field: 'done', max_iterations: 3 },
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' }, done: { type: 'boolean' } },
            required: ['verdict', 'done'],
          },
        },
      ],
      makeWorkflowRun(),
      'pi'
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const textRows = (await store.listNodeMessages(workflowRun.id, 'refine')).filter(
      row => row.kind === 'text'
    );
    expect(textRows.map(row => row.payload)).toEqual([{ text: 'bad pass' }, { text: 'good pass' }]);
    expect(textRows[0]?.metadata?.text_mode).toBe('delta');
    expect(textRows[1]?.metadata?.text_mode).toBe('delta');
    const firstScope = textRows[0]?.metadata?.execution;
    const secondScope = textRows[1]?.metadata?.execution;
    expect(firstScope?.occurrence_id).toBe(secondScope?.occurrence_id);
    expect(firstScope?.attempt_id).not.toBe(secondScope?.attempt_id);
  });

  it('isolates a missing-output loop re-ask pass in a distinct transcript attempt', async () => {
    let call = 0;
    mockSendQueryDag.mockImplementation(function* () {
      call++;
      if (call === 1) {
        yield { type: 'assistant', content: 'prose pass', textMode: 'delta' };
        yield { type: 'result', sessionId: 's1' };
      } else {
        yield { type: 'assistant', content: 'fixed pass', textMode: 'delta' };
        yield {
          type: 'result',
          sessionId: 's2',
          structuredOutput: { verdict: 'review', done: true },
        };
      }
    });

    const store = createMockStore();
    const workflowRun = await runNodes(
      store,
      [
        {
          id: 'refine',
          loop: { prompt: 'Iterate.', until_field: 'done', max_iterations: 3 },
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' }, done: { type: 'boolean' } },
            required: ['verdict', 'done'],
          },
        },
      ],
      makeWorkflowRun(),
      'pi'
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const textRows = (await store.listNodeMessages(workflowRun.id, 'refine')).filter(
      row => row.kind === 'text'
    );
    expect(textRows.map(row => row.payload)).toEqual([
      { text: 'prose pass' },
      { text: 'fixed pass' },
    ]);
    expect(textRows[0]?.metadata?.text_mode).toBe('delta');
    expect(textRows[1]?.metadata?.text_mode).toBe('delta');
    const firstScope = textRows[0]?.metadata?.execution;
    const secondScope = textRows[1]?.metadata?.execution;
    expect(firstScope?.occurrence_id).toBe(secondScope?.occurrence_id);
    expect(firstScope?.attempt_id).not.toBe(secondScope?.attempt_id);
  });
});

describe('executeDagWorkflow -- AskHuman pause', () => {
  const askQuestions = [
    {
      id: 'q1',
      prompt: 'Ship it?',
      selection: 'single' as const,
      options: ['yes', 'no'],
      allowOther: false,
    },
  ];

  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-ask-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Ask the starter about $USER_MESSAGE');

    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function storedEventTypes(store: IWorkflowStore): string[] {
    return (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => (call[0] as { event_type: string }).event_type
    );
  }

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolvePromise: (() => void) | undefined;
    const promise = new Promise<void>(resolve => {
      resolvePromise = resolve;
    });
    return {
      promise,
      resolve: () => {
        if (!resolvePromise) throw new Error('Deferred resolver was not initialized');
        resolvePromise();
      },
    };
  }

  function wireAskPause(store: IWorkflowStore, onPause?: () => void): void {
    let status: WorkflowRun['status'] = 'running';
    store.getWorkflowRunStatus = mock(async () => status);
    store.pauseWorkflowRun = mock(async (_runId, approvalContext) => {
      if (approvalContext !== undefined) {
        throw new Error('AskHuman pause must not supply approval context');
      }
      if (status !== 'running' && status !== 'paused') {
        throw new Error(`Cannot pause AskHuman run from ${status}`);
      }
      status = 'paused';
      onPause?.();
    });
  }

  async function invokeInjectedAskHuman(
    options: SendQueryOptions | undefined,
    toolUseId = 'toolu_1',
    sessionId = 'sess-1'
  ): Promise<void> {
    const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
    if (!ask) throw new Error('AskHuman was not injected');
    await ask.handler({ questions: askQuestions }, { toolUseId, sessionId });
  }

  async function executeAskDag(
    store: IWorkflowStore,
    workflowRun: WorkflowRun,
    nodes: DagNode[]
  ): Promise<void> {
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'ask-several-outstanding', nodes },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
  }

  it.each([
    { kind: 'command', node: { id: 'review', command: 'my-cmd' } },
    { kind: 'prompt', node: { id: 'review', prompt: 'ask the starter' } },
  ])('pauses a Claude $kind node on AskHuman without completing the node', async ({ node }) => {
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      await invokeInjectedAskHuman(options);
    });

    const store = createMockStore();
    wireAskPause(store);
    const workflowRun = makeWorkflowRun('ask-pause-run');
    const live: WorkflowEmitterEvent[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe(event => {
      if ('runId' in event && event.runId === workflowRun.id) live.push(event);
    });

    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        { name: 'ask-pause', nodes: [node] },
        workflowRun,
        'claude',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      );
    } finally {
      unsubscribe();
    }

    expect(store.insertPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: workflowRun.id,
        node_id: 'review',
        tool_use_id: 'toolu_1',
        kind: 'ask',
        envelope: { questions: askQuestions },
        provider_session_id: 'sess-1',
        execution_scope: expect.objectContaining({
          occurrence_id: expect.any(String),
          attempt_id: expect.any(String),
          retry_epoch: 0,
        }),
      })
    );
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect((store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls[0]).toEqual([
      workflowRun.id,
    ]);

    const rows = await store.listNodeMessages(workflowRun.id, 'review');
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(true);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      false
    );
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(false);

    expect(live.filter(event => event.type === 'node_awaiting')).toEqual([
      { type: 'node_awaiting', runId: workflowRun.id, nodeId: 'review' },
    ]);
    expect(live.some(event => event.type === 'node_completed')).toBe(false);
    expect(live.some(event => event.type === 'node_failed')).toBe(false);
    expect(live.some(event => event.type === 'approval_pending')).toBe(false);

    const types = storedEventTypes(store);
    expect(types).not.toContain('node_completed');
    expect(types).not.toContain('node_failed');
    expect(types).not.toContain('approval_requested');
    expect(types).not.toContain('approval_pending');
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('injects AskHuman for a devin node (askHuman true, nativeTools false) and pauses on the control error', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'devin',
      getCapabilities: () => DEVIN_CAPABILITIES,
    }));
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      expect(options?.nativeTools?.map(tool => tool.name)).toEqual(['AskHuman']);
      await invokeInjectedAskHuman(options, 'call_ask_1', 'peach-country');
    });

    const store = createMockStore();
    wireAskPause(store);
    const workflowRun = makeWorkflowRun('devin-ask-pause-run');
    const live: WorkflowEmitterEvent[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe(event => {
      if ('runId' in event && event.runId === workflowRun.id) live.push(event);
    });
    try {
      await executeDagWorkflow(
        createMockDeps(store),
        createMockPlatform(),
        'conv-dag',
        testDir,
        { name: 'devin-ask-pause', nodes: [{ id: 'review', prompt: 'ask the starter' }] },
        workflowRun,
        'devin',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        {
          ...minimalConfig,
          assistant: 'devin' as const,
          assistants: { ...minimalConfig.assistants, devin: {} },
        }
      );
    } finally {
      unsubscribe();
    }

    expect(store.insertPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: workflowRun.id,
        node_id: 'review',
        tool_use_id: 'call_ask_1',
        kind: 'ask',
        envelope: { questions: askQuestions },
        provider_session_id: 'peach-country',
        execution_scope: expect.objectContaining({
          occurrence_id: expect.any(String),
          attempt_id: expect.any(String),
          retry_epoch: 0,
        }),
      })
    );
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect((store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls[0]).toEqual([
      workflowRun.id,
    ]);

    const rows = await store.listNodeMessages(workflowRun.id, 'review');
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(true);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      false
    );
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(false);

    expect(live.filter(event => event.type === 'node_awaiting')).toEqual([
      { type: 'node_awaiting', runId: workflowRun.id, nodeId: 'review' },
    ]);
    expect(live.some(event => event.type === 'node_completed')).toBe(false);
    expect(live.some(event => event.type === 'node_failed')).toBe(false);
    expect(live.some(event => event.type === 'approval_pending')).toBe(false);

    const types = storedEventTypes(store);
    expect(types).not.toContain('node_completed');
    expect(types).not.toContain('node_failed');
    expect(types).not.toContain('approval_requested');
    expect(types).not.toContain('approval_pending');
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
  });

  it('does not advance downstream when an answer races the pause cleanup', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      calls += 1;
      if (calls === 1) {
        await invokeInjectedAskHuman(options);
        return;
      }
      yield { type: 'assistant', content: 'downstream should not run' };
    });

    const store = createMockStore();
    let status: 'running' | 'paused' = 'running';
    store.getWorkflowRunStatus = mock(async () => status);
    store.pauseWorkflowRun = mock(async () => {
      status = 'running';
    });
    const workflowRun = makeWorkflowRun('ask-pause-race-run');

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'ask-pause-race',
        nodes: [
          { id: 'review', prompt: 'ask the starter', allowed_tools: ['AskHuman'] },
          { id: 'after', depends_on: ['review'], prompt: 'after' },
        ],
      },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(mockSendQueryDag).toHaveBeenCalledTimes(1);
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('does not inject AskHuman on a Codex command node', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: mockCodexCapabilities,
    }));
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'codex-sess' };
    });

    const store = createMockStore();
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'codex-no-ask',
        provider: 'codex',
        nodes: [{ id: 'review', command: 'my-cmd' }],
      },
      makeWorkflowRun('codex-ask-run'),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      { ...minimalConfig, assistant: 'codex' }
    );

    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as SendQueryOptions;
    expect(optionsArg.nativeTools === undefined || optionsArg.nativeTools.length === 0).toBe(true);
    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
  });

  it('fails the node on AskHumanNoStarterError without pausing', async () => {
    const workflowRun = makeWorkflowRun('ask-nostarter-run');
    const store = createMockStore();
    store.insertPendingInteraction = mock(async () => {
      throw new AskHumanNoStarterError(workflowRun.id);
    });
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      await invokeInjectedAskHuman(options);
    });

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'ask-nostarter', nodes: [{ id: 'review', prompt: 'ask' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).toHaveBeenCalled();
    expect(storedEventTypes(store)).toContain('node_failed');
    expect(storedEventTypes(store)).not.toContain('node_completed');
  });

  it('fails the node on pending persist errors without pausing', async () => {
    const store = createMockStore();
    store.insertPendingInteraction = mock(async () => {
      throw new Error('pending persist failed');
    });
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      await invokeInjectedAskHuman(options);
    });

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'ask-persist-fail', nodes: [{ id: 'review', prompt: 'ask' }] },
      makeWorkflowRun('ask-persist-run'),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.pauseWorkflowRun).not.toHaveBeenCalled();
    expect(store.failWorkflowRun).toHaveBeenCalled();
    expect(storedEventTypes(store)).toContain('node_failed');
  });

  it('fails the node on post-persist pause errors without completing or awaiting it', async () => {
    const store = createMockStore();
    store.pauseWorkflowRun = mock(async () => {
      throw new Error('pause failed');
    });
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      await invokeInjectedAskHuman(options);
    });
    const workflowRun = makeWorkflowRun('ask-pause-fail-run');

    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'ask-pause-fail', nodes: [{ id: 'review', prompt: 'ask' }] },
      workflowRun,
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );

    expect(store.insertPendingInteraction).toHaveBeenCalledTimes(1);
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(store.failWorkflowRun).toHaveBeenCalled();
    const rows = await store.listNodeMessages(workflowRun.id, 'review');
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(true);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(false);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      false
    );
    expect(storedEventTypes(store)).toContain('node_failed');
    expect(storedEventTypes(store)).not.toContain('node_completed');
    const failedEvent = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls
      .map(call => call[0] as { event_type: string; data?: { error?: string } })
      .find(event => event.event_type === 'node_failed');
    const expectedError = new AskHumanPauseFailedError(
      'toolu_1',
      'review',
      workflowRun.id,
      'pause failed'
    ).message;
    expect(failedEvent?.data?.error).toContain(expectedError);
    expect(failedEvent?.data?.error).not.toBe('Cancelled by user');
  });

  it('pauses a Pi loop on AskHuman while keeping accumulated text and usage', async () => {
    const usageBreakdown = [
      {
        provider: 'anthropic',
        model: 'pi-test',
        modelSource: 'reported' as const,
        inputTokens: 11,
        outputTokens: 7,
        costUsd: 0.02,
      },
    ];
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'pi',
      getCapabilities: mockClaudeCapabilities,
    }));
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      yield { type: 'assistant', content: 'Need a decision.' };
      yield {
        type: 'background_tasks',
        tasks: [{ taskId: 'keep-open', taskType: 'agent', description: 'ask' }],
      };
      yield {
        type: 'result',
        sessionId: 'sess-1',
        tokens: { input: 11, output: 7 },
        cost: 0.02,
        usageBreakdown,
      };
      await invokeInjectedAskHuman(options);
    });

    const store = createMockStore();
    wireAskPause(store);
    const mockDeps = createMockDeps(store);
    const workflowRun = makeWorkflowRun('ask-pi-loop-run');
    const live: WorkflowEmitterEvent[] = [];
    const unsubscribe = getWorkflowEventEmitter().subscribe(event => {
      if ('runId' in event && event.runId === workflowRun.id) live.push(event);
    });

    try {
      await executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'ask-pi-loop',
          provider: 'pi',
          nodes: [
            {
              id: 'refine',
              loop: {
                prompt: 'Ask then continue',
                until: 'DONE',
                max_iterations: 3,
              },
            },
          ],
        },
        workflowRun,
        'pi',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        { ...minimalConfig, assistant: 'pi', assistants: { ...minimalConfig.assistants, pi: {} } }
      );
    } finally {
      unsubscribe();
    }

    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect((store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls[0]).toEqual([
      workflowRun.id,
    ]);
    expect(store.insertPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: workflowRun.id,
        node_id: 'refine',
        tool_use_id: 'toolu_1',
        kind: 'ask',
        envelope: { questions: askQuestions },
        provider_session_id: 'sess-1',
        execution_scope: expect.objectContaining({
          occurrence_id: expect.any(String),
          attempt_id: expect.any(String),
          retry_epoch: 0,
          loop_ancestry: [{ node_id: 'refine', iteration: 1 }],
        }),
      })
    );

    const rows = await store.listNodeMessages(workflowRun.id, 'refine');
    expect(rows.some(row => row.kind === 'text' && row.payload.text === 'Need a decision.')).toBe(
      true
    );
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(true);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(false);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      false
    );

    const types = storedEventTypes(store);
    expect(types).not.toContain('node_completed');
    expect(types).not.toContain('node_failed');
    expect(types).not.toContain('loop_iteration_failed');
    expect(live.some(event => event.type === 'node_failed')).toBe(false);
    expect(live.filter(event => event.type === 'node_awaiting')).toEqual([
      { type: 'node_awaiting', runId: workflowRun.id, nodeId: 'refine' },
    ]);

    const usageCalls = (mockDeps.usageRecorder.recordWorkflowUsage as ReturnType<typeof mock>).mock
      .calls;
    expect(usageCalls.length).toBeGreaterThan(0);
    expect(usageCalls[0][0]).toMatchObject({
      runId: workflowRun.id,
      stepName: 'refine',
      agentProvider: 'pi',
      usageBreakdown,
    });
    expect(store.failWorkflowRun).not.toHaveBeenCalled();
    expect(store.completeWorkflowRun).not.toHaveBeenCalled();
  });

  it('persists a second sibling Ask after the first Ask has paused the run', async () => {
    const firstPause = deferred();
    mockSendQueryDag.mockImplementation(async function* (
      prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      if (prompt.includes('alpha asks')) {
        await invokeInjectedAskHuman(options, 'toolu_alpha', 'sess-alpha');
        return;
      }
      await firstPause.promise;
      await invokeInjectedAskHuman(options, 'toolu_beta', 'sess-beta');
    });

    const inserted: Array<{ node_id: string; tool_use_id: string }> = [];
    const store = createMockStore();
    store.insertPendingInteraction = mock(async input => {
      inserted.push({ node_id: input.node_id, tool_use_id: input.tool_use_id });
      return {
        id: `pending-${input.tool_use_id}`,
        ...input,
        status: 'pending' as const,
        answer: null,
        created_at: new Date(),
        resolved_at: null,
        resolved_by: null,
      };
    });
    wireAskPause(store, firstPause.resolve);
    const workflowRun = makeWorkflowRun('ask-two-nodes-run');

    await executeAskDag(store, workflowRun, [
      { id: 'alpha', prompt: 'alpha asks' },
      { id: 'beta', prompt: 'beta asks' },
      { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
    ]);

    expect(inserted).toEqual([
      { node_id: 'alpha', tool_use_id: 'toolu_alpha' },
      { node_id: 'beta', tool_use_id: 'toolu_beta' },
    ]);
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(2);
    expect((store.pauseWorkflowRun as ReturnType<typeof mock>).mock.calls).toEqual([
      [workflowRun.id],
      [workflowRun.id],
    ]);
    const nodeEvents = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => call[0] as { event_type: string; step_name?: string }
    );
    expect(nodeEvents.filter(event => event.event_type === 'node_completed')).toEqual([]);
    expect(mockSendQueryDag).toHaveBeenCalledTimes(2);
  });

  it('lets an already-started sibling finish streaming after another node pauses the run', async () => {
    const firstPause = deferred();
    mockSendQueryDag.mockImplementation(async function* (
      prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      if (prompt.includes('alpha asks')) {
        await invokeInjectedAskHuman(options, 'toolu_alpha', 'sess-alpha');
        return;
      }
      await firstPause.promise;
      yield { type: 'assistant', content: 'beta finished after pause' };
      yield { type: 'result', sessionId: 'sess-beta' };
    });

    const store = createMockStore();
    wireAskPause(store, firstPause.resolve);
    const workflowRun = makeWorkflowRun('ask-streaming-sibling-run');

    await executeAskDag(store, workflowRun, [
      { id: 'alpha', prompt: 'alpha asks' },
      { id: 'beta', prompt: 'beta streams' },
      { id: 'after', depends_on: ['alpha', 'beta'], prompt: 'must not run' },
    ]);

    const betaRows = await store.listNodeMessages(workflowRun.id, 'beta');
    expect(
      betaRows.some(row => row.kind === 'text' && row.payload.text === 'beta finished after pause')
    ).toBe(true);
    expect(betaRows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      true
    );
    expect(storedEventTypes(store).filter(type => type === 'node_completed')).toEqual([
      'node_completed',
    ]);
    expect(mockSendQueryDag).toHaveBeenCalledTimes(2);
  });

  it('persists two Ask calls from one node before unwinding it as awaiting', async () => {
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      const attempts = await Promise.allSettled([
        invokeInjectedAskHuman(options, 'toolu_one', 'sess-one'),
        invokeInjectedAskHuman(options, 'toolu_two', 'sess-two'),
      ]);
      const rejected = attempts.find(
        (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected'
      );
      if (!rejected) throw new Error('Expected AskHuman to unwind the provider invocation');
      if (rejected.reason instanceof Error) throw rejected.reason;
      throw new Error(String(rejected.reason));
    });

    const insertedToolUseIds: string[] = [];
    const store = createMockStore();
    store.insertPendingInteraction = mock(async input => {
      insertedToolUseIds.push(input.tool_use_id);
      return {
        id: `pending-${input.tool_use_id}`,
        ...input,
        status: 'pending' as const,
        answer: null,
        created_at: new Date(),
        resolved_at: null,
        resolved_by: null,
      };
    });
    wireAskPause(store);
    const workflowRun = makeWorkflowRun('ask-two-same-node-run');

    await executeAskDag(store, workflowRun, [{ id: 'review', prompt: 'ask twice' }]);

    expect(insertedToolUseIds.sort()).toEqual(['toolu_one', 'toolu_two']);
    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(2);
    const rows = await store.listNodeMessages(workflowRun.id, 'review');
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'awaiting')).toBe(true);
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'completed')).toBe(
      false
    );
    expect(rows.some(row => row.kind === 'status' && row.payload.state === 'failed')).toBe(false);
  });
});

describe('executeDagWorkflow -- AskHuman CAP-7 preflight', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-ask-cap7-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    mockSendQueryDag.mockClear();
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'cap7-sess' };
    });
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('rejects Codex allowed_tools AskHuman before any sendQuery', async () => {
    const mockDeps = createMockDeps();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
    }));
    await expect(
      executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'cap7-codex-ask',
          provider: 'codex',
          nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['AskHuman'] }],
        },
        makeWorkflowRun(),
        'codex',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      )
    ).rejects.toThrow(/AskHuman is not supported by provider 'codex'/);
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('starts the same Codex workflow when allowed_tools omits AskHuman', async () => {
    const mockDeps = createMockDeps();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'codex',
      getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
    }));
    await executeDagWorkflow(
      mockDeps,
      createMockPlatform(),
      'conv-dag',
      testDir,
      {
        name: 'cap7-codex-ok',
        provider: 'codex',
        nodes: [{ id: 'review', prompt: 'no ask', allowed_tools: ['Read'] }],
      },
      makeWorkflowRun(),
      'codex',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      minimalConfig
    );
    expect(mockSendQueryDag.mock.calls.length).toBeGreaterThan(0);
    const optionsArg = mockSendQueryDag.mock.calls[0][3] as { nativeTools?: unknown };
    expect(
      optionsArg.nativeTools === undefined || (optionsArg.nativeTools as unknown[]).length === 0
    ).toBe(true);
  });

  it('rejects mcp__archon__AskHuman on Grok at start', async () => {
    const mockDeps = createMockDeps();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'grok',
      getCapabilities: () => ({ ...mockClaudeCapabilities(), askHuman: false, nativeTools: false }),
    }));
    await expect(
      executeDagWorkflow(
        mockDeps,
        createMockPlatform(),
        'conv-dag',
        testDir,
        {
          name: 'cap7-grok-ask',
          provider: 'grok',
          nodes: [{ id: 'review', prompt: 'ask', allowed_tools: ['mcp__archon__AskHuman'] }],
        },
        makeWorkflowRun(),
        'grok',
        undefined,
        join(testDir, 'artifacts'),
        join(testDir, 'state'),
        join(testDir, 'logs'),
        'main',
        'docs/',
        minimalConfig
      )
    ).rejects.toThrow(/AskHuman is not supported by provider 'grok'/);
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });
});

describe('executeDagWorkflow -- AskHuman resume re-entry', () => {
  const ANSWER_SENTINEL = 'SENTINEL_ANSWER_ZX9';
  const ASK_RESUME_FAILED_MESSAGE = 'Could not resume the AskHuman session';
  const askQuestions = [
    {
      id: 'q1',
      prompt: 'Ship it?',
      selection: 'single' as const,
      options: ['yes', 'no'],
      allowOther: false,
    },
  ];

  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-ask-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const commandsDir = join(testDir, '.archon', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cmd.md'), 'Ask the starter about $USER_MESSAGE');
    mockSendQueryDag.mockClear();
    mockLogFn.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function makeAnsweredAsk(
    overrides: Partial<PendingInteraction> & { node_id: string; tool_use_id: string }
  ): PendingInteraction {
    return {
      id: 'ask-row-1',
      workflow_run_id: 'ask-resume-run',
      kind: 'ask',
      status: 'answered',
      envelope: { questions: askQuestions },
      answer: { answers: [{ questionId: 'q1', value: ANSWER_SENTINEL }] },
      provider_session_id: 'sess-ask',
      created_at: new Date('2026-09-06T00:00:00.000Z'),
      resolved_at: new Date('2026-09-06T00:01:00.000Z'),
      resolved_by: 'user-1',
      ...overrides,
    };
  }

  function wireAnsweredAsks(store: IWorkflowStore, rows: PendingInteraction[]): void {
    store.listPendingInteractions = mock(async () => rows);
  }

  function storedEventTypes(store: IWorkflowStore): string[] {
    return (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => (call[0] as { event_type: string }).event_type
    );
  }

  function payloadHasSentinel(value: unknown): boolean {
    return JSON.stringify(value).includes(ANSWER_SENTINEL);
  }

  async function invokeDag(
    store: IWorkflowStore,
    nodes: DagNode[],
    workflowRun = makeWorkflowRun('ask-resume-run'),
    assistant: 'claude' | 'pi' | 'devin' = 'claude'
  ): Promise<void> {
    const config =
      assistant === 'pi'
        ? {
            ...minimalConfig,
            assistant: 'pi' as const,
            assistants: { ...minimalConfig.assistants, pi: {} },
          }
        : assistant === 'devin'
          ? {
              ...minimalConfig,
              assistant: 'devin' as const,
              assistants: { ...minimalConfig.assistants, devin: {} },
            }
          : minimalConfig;
    await executeDagWorkflow(
      createMockDeps(store),
      createMockPlatform(),
      'conv-dag',
      testDir,
      { name: 'ask-resume', nodes },
      workflowRun,
      assistant,
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      config
    );
  }

  it('re-enters a command node with mapped resumeInteractions and no prompt leak', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-ask' };
    });
    const store = createMockStore();
    const row = makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' });
    wireAnsweredAsks(store, [row]);

    await invokeDag(store, [{ id: 'review', command: 'my-cmd' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    const [prompt, , resumeId, options] = mockSendQueryDag.mock.calls[0] as [
      string,
      string,
      string | undefined,
      SendQueryOptions,
    ];
    expect(prompt).toContain('Ask the starter about');
    expect(prompt).not.toContain(ANSWER_SENTINEL);
    expect(resumeId).toBe('sess-ask');
    expect(options.forkSession).toBe(false);
    expect(options.resumeInteractions).toEqual([
      {
        tool_use_id: 'toolu_1',
        payload: [{ questionId: 'q1', value: ANSWER_SENTINEL }],
        declined: false,
      },
    ]);
  });

  it('maps decline to declined payload', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-ask' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        node_id: 'review',
        tool_use_id: 'toolu_declined',
        answer: { decline: true },
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask the starter' }]);

    const options = mockSendQueryDag.mock.calls[0][3] as SendQueryOptions;
    expect(options.resumeInteractions).toEqual([
      { tool_use_id: 'toolu_declined', payload: 'declined', declined: true },
    ]);
  });

  it('re-enters a devin node with the stored Devin session id and mapped answers, without forking', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'devin',
      getCapabilities: () => DEVIN_CAPABILITIES,
    }));
    const calls: { prompt: string; resume?: string; options?: SendQueryOptions }[] = [];
    mockSendQueryDag.mockImplementation(async function* (
      prompt: string,
      _cwd: string,
      resume?: string,
      options?: SendQueryOptions
    ) {
      calls.push({ prompt, resume, options });
      yield { type: 'assistant', content: 'CHOSEN=blue' };
      yield { type: 'result', sessionId: resume, resumed: true };
    });

    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        workflow_run_id: 'devin-ask-resume-run',
        node_id: 'review',
        tool_use_id: 'call_ask_1',
        provider_session_id: 'peach-country',
        answer: { answers: [{ questionId: 'q0', value: 'blue' }] },
      }),
    ]);

    await invokeDag(
      store,
      [{ id: 'review', prompt: 'original prompt' }],
      makeWorkflowRun('devin-ask-resume-run'),
      'devin'
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe('original prompt');
    expect(calls[0]?.resume).toBe('peach-country');
    expect(calls[0]?.options?.forkSession).toBe(false);
    expect(calls[0]?.options?.resumeInteractions).toEqual([
      {
        tool_use_id: 'call_ask_1',
        payload: [{ questionId: 'q0', value: 'blue' }],
        declined: false,
      },
    ]);
    expect(calls[0]?.options?.nativeTools?.map(tool => tool.name)).toEqual(['AskHuman']);
  });

  it('orders two rows by created_at then id', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-ask' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        id: 'b',
        node_id: 'review',
        tool_use_id: 'toolu_second',
        created_at: new Date('2026-09-06T00:00:02.000Z'),
      }),
      makeAnsweredAsk({
        id: 'a',
        node_id: 'review',
        tool_use_id: 'toolu_first',
        created_at: new Date('2026-09-06T00:00:01.000Z'),
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask' }]);
    const options = mockSendQueryDag.mock.calls[0][3] as SendQueryOptions;
    expect(options.resumeInteractions?.map(item => item.tool_use_id)).toEqual([
      'toolu_first',
      'toolu_second',
    ]);
  });

  it('keeps a shared provider session across two rows on one node', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-shared' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        id: 'a',
        node_id: 'review',
        tool_use_id: 'toolu_a',
        provider_session_id: 'sess-shared',
        created_at: new Date('2026-09-06T00:00:01.000Z'),
      }),
      makeAnsweredAsk({
        id: 'b',
        node_id: 'review',
        tool_use_id: 'toolu_b',
        provider_session_id: 'sess-shared',
        created_at: new Date('2026-09-06T00:00:02.000Z'),
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask' }]);
    expect(mockSendQueryDag.mock.calls[0][2]).toBe('sess-shared');
    expect((mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).resumeInteractions).toHaveLength(
      2
    );
  });

  it('fails safely on conflicting provider session ids', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-ask' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        id: 'a',
        node_id: 'review',
        tool_use_id: 'toolu_a',
        provider_session_id: 'sess-1',
      }),
      makeAnsweredAsk({
        id: 'b',
        node_id: 'review',
        tool_use_id: 'toolu_b',
        provider_session_id: 'sess-2',
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask' }]);
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
    expect(store.failWorkflowRun).toHaveBeenCalled();
    expect(storedEventTypes(store)).toContain('node_failed');
    const failed = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call => (call[0] as { event_type: string }).event_type === 'node_failed'
    );
    expect((failed?.[0] as { data: { error: string } }).data.error).toBe(ASK_RESUME_FAILED_MESSAGE);
    expect(payloadHasSentinel(mockLogFn.mock.calls)).toBe(false);
  });

  it('fails safely on a malformed stored answer', async () => {
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        node_id: 'review',
        tool_use_id: 'toolu_bad',
        answer: { garbage: true } as unknown as PendingInteraction['answer'],
      }),
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask' }]);
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
    expect(storedEventTypes(store)).toContain('node_failed');
    expect(payloadHasSentinel(mockLogFn.mock.calls)).toBe(false);
  });

  it('does not attach interactions to an unrelated later node', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-later' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' })]);

    await invokeDag(store, [
      { id: 'review', prompt: 'ask' },
      { id: 'summarize', prompt: 'summarize without asking', depends_on: ['review'] },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const reviewOpts = mockSendQueryDag.mock.calls[0][3] as SendQueryOptions;
    const laterOpts = mockSendQueryDag.mock.calls[1][3] as SendQueryOptions;
    expect(reviewOpts.resumeInteractions).toHaveLength(1);
    expect(laterOpts.resumeInteractions).toBeUndefined();
  });

  it('re-enters two sibling asking nodes with their own interactions', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'sess-ask' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        id: 'row-a',
        node_id: 'alpha',
        tool_use_id: 'toolu_alpha',
        provider_session_id: 'sess-alpha',
      }),
      makeAnsweredAsk({
        id: 'row-b',
        node_id: 'beta',
        tool_use_id: 'toolu_beta',
        provider_session_id: 'sess-beta',
      }),
    ]);

    await invokeDag(store, [
      { id: 'alpha', prompt: 'ask alpha' },
      { id: 'beta', prompt: 'ask beta' },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    const bySession = new Map(
      mockSendQueryDag.mock.calls.map(call => [
        call[2] as string,
        (call[3] as SendQueryOptions).resumeInteractions?.[0]?.tool_use_id,
      ])
    );
    expect(bySession.get('sess-alpha')).toBe('toolu_alpha');
    expect(bySession.get('sess-beta')).toBe('toolu_beta');
  });

  it('omits resumeInteractions on a structured correction pass', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'pi',
      getCapabilities: mockClaudeCapabilities,
    }));
    let n = 0;
    mockSendQueryDag.mockImplementation(function* () {
      n++;
      if (n === 1) {
        yield { type: 'result', sessionId: 'sess-ask', structuredOutput: { other: 'x' } };
        return;
      }
      yield { type: 'assistant', content: 'ok' };
      yield {
        type: 'result',
        sessionId: 'sess-ask',
        structuredOutput: { verdict: 'yes' },
      };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' })]);

    await invokeDag(
      store,
      [
        {
          id: 'review',
          provider: 'pi',
          prompt: 'ask',
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
          },
        },
      ],
      makeWorkflowRun('ask-resume-run'),
      'pi'
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect((mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).resumeInteractions).toHaveLength(
      1
    );
    expect(
      (mockSendQueryDag.mock.calls[1][3] as SendQueryOptions).resumeInteractions
    ).toBeUndefined();
  });

  it('gives a loop resumeInteractions only on the first pass of the first resumed iteration', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'pi',
      getCapabilities: mockClaudeCapabilities,
    }));
    let n = 0;
    mockSendQueryDag.mockImplementation(function* () {
      n++;
      if (n === 1) {
        yield { type: 'result', sessionId: 'sess-loop', structuredOutput: { other: 'x' } };
        return;
      }
      if (n === 2) {
        yield { type: 'assistant', content: 'still going' };
        yield {
          type: 'result',
          sessionId: 'sess-loop',
          structuredOutput: { verdict: 'wait' },
        };
        return;
      }
      yield { type: 'assistant', content: 'DONE' };
      yield {
        type: 'result',
        sessionId: 'sess-loop',
        structuredOutput: { verdict: 'done' },
      };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        node_id: 'refine',
        tool_use_id: 'toolu_loop',
        provider_session_id: 'sess-loop',
      }),
    ]);

    await invokeDag(
      store,
      [
        {
          id: 'refine',
          provider: 'pi',
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
          },
          loop: {
            prompt: 'Do the work until DONE.',
            until: 'DONE',
            max_iterations: 5,
          },
        },
      ],
      makeWorkflowRun('ask-resume-run'),
      'pi'
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    expect(mockSendQueryDag.mock.calls[0][2]).toBe('sess-loop');
    expect((mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).forkSession).toBe(false);
    expect((mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).resumeInteractions).toEqual([
      {
        tool_use_id: 'toolu_loop',
        payload: [{ questionId: 'q1', value: ANSWER_SENTINEL }],
        declined: false,
      },
    ]);
    expect(
      (mockSendQueryDag.mock.calls[1][3] as SendQueryOptions).resumeInteractions
    ).toBeUndefined();
    expect(
      (mockSendQueryDag.mock.calls[2][3] as SendQueryOptions).resumeInteractions
    ).toBeUndefined();
    const prompts = mockSendQueryDag.mock.calls.map(call => call[0] as string);
    expect(prompts.every(prompt => !prompt.includes(ANSWER_SENTINEL))).toBe(true);
  });

  it('uses zero engine retries and a safe node_failed message on provider resume throw', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      throw new Error(`provider boom ${ANSWER_SENTINEL}`);
    });
    const store = createMockStore();
    const rows = [makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' })];
    wireAnsweredAsks(store, rows);

    await invokeDag(store, [
      {
        id: 'review',
        prompt: 'ask',
        retry: { max_attempts: 5, delay_ms: 1000, on_error: 'all' },
      },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(storedEventTypes(store)).toContain('node_failed');
    const failed = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call => (call[0] as { event_type: string }).event_type === 'node_failed'
    );
    expect((failed?.[0] as { data: { error: string } }).data.error).toBe(ASK_RESUME_FAILED_MESSAGE);
    const rowsAfter = await store.listPendingInteractions('ask-resume-run');
    expect(rowsAfter[0]?.status).toBe('answered');
    expect(mockLogFn.mock.calls.some(call => call[1] === 'workflow.ask_resume_failed')).toBe(true);
    expect(payloadHasSentinel(mockLogFn.mock.calls)).toBe(false);
    expect(
      payloadHasSentinel((store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls)
    ).toBe(false);
    const transcript = await store.listNodeMessages('ask-resume-run', 'review');
    expect(
      transcript.some(
        row =>
          row.kind === 'status' &&
          row.payload.state === 'failed' &&
          row.payload.detail === ASK_RESUME_FAILED_MESSAGE
      )
    ).toBe(true);
    const logPath = join(testDir, 'logs', 'ask-resume-run.jsonl');
    if (existsSync(logPath)) {
      expect(readFileSync(logPath, 'utf8')).not.toContain(ANSWER_SENTINEL);
    }
  });

  it('pauses normally when the resumed turn calls AskHuman again', async () => {
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
      if (!ask) throw new Error('AskHuman was not injected');
      await ask.handler(
        { questions: askQuestions },
        { toolUseId: 'toolu_2', sessionId: 'sess-ask' }
      );
    });
    const store = createMockStore();
    let status: 'running' | 'paused' = 'running';
    store.getWorkflowRunStatus = mock(async () => status);
    store.pauseWorkflowRun = mock(async () => {
      status = 'paused';
    });
    wireAnsweredAsks(store, [makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' })]);

    await invokeDag(store, [{ id: 'review', prompt: 'ask', allowed_tools: ['AskHuman'] }]);

    expect(store.pauseWorkflowRun).toHaveBeenCalledTimes(1);
    expect(storedEventTypes(store)).not.toContain('node_failed');
    expect(mockLogFn.mock.calls.some(call => call[1] === 'workflow.ask_resume_failed')).toBe(false);
  });

  it('rejects a run that still has a pending Ask row', async () => {
    const store = createMockStore();
    wireAnsweredAsks(store, [
      {
        ...makeAnsweredAsk({ node_id: 'review', tool_use_id: 'toolu_1' }),
        status: 'pending',
        answer: null,
        resolved_at: null,
        resolved_by: null,
      },
    ]);

    await expect(invokeDag(store, [{ id: 'review', prompt: 'ask' }])).rejects.toThrow(
      'Answer or decline the Ask before resuming run ask-resume-run'
    );
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
  });

  it('fails the workflow when an answered Ask names a node missing from the DAG', async () => {
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({ node_id: 'removed-node', tool_use_id: 'toolu_missing' }),
    ]);

    await expect(invokeDag(store, [{ id: 'review', prompt: 'ask' }])).rejects.toThrow(
      ASK_RESUME_FAILED_MESSAGE
    );
    expect(mockSendQueryDag.mock.calls.length).toBe(0);
    expect(store.failWorkflowRun).toHaveBeenCalledWith('ask-resume-run', ASK_RESUME_FAILED_MESSAGE);
    expect(mockLogFn.mock.calls.some(call => call[1] === 'workflow.ask_resume_failed')).toBe(true);
    expect(payloadHasSentinel(mockLogFn.mock.calls)).toBe(false);
    const rowsAfter = await store.listPendingInteractions('ask-resume-run');
    expect(rowsAfter[0]?.status).toBe('answered');
  });

  it('ignores answered Permission rows when mapping Ask resume', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 'fresh' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      {
        ...makeAnsweredAsk({ node_id: 'review', tool_use_id: 'perm_1' }),
        kind: 'permission',
      },
    ]);

    await invokeDag(store, [{ id: 'review', prompt: 'no ask' }]);
    expect(
      (mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).resumeInteractions
    ).toBeUndefined();
  });

  it('matches loop_group body step names when mapping answered Asks', async () => {
    mockSendQueryDag.mockImplementation(function* () {
      yield { type: 'assistant', content: 'COMPLETE' };
      yield { type: 'result', sessionId: 'sess-body' };
    });
    const store = createMockStore();
    wireAnsweredAsks(store, [
      makeAnsweredAsk({
        node_id: 'grp.body',
        tool_use_id: 'toolu_body',
        provider_session_id: 'sess-body',
      }),
    ]);

    await invokeDag(store, [
      {
        id: 'grp',
        loop_group: {
          until: 'COMPLETE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'emit COMPLETE' }],
        },
      },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(mockSendQueryDag.mock.calls[0][2]).toBe('sess-body');
    expect((mockSendQueryDag.mock.calls[0][3] as SendQueryOptions).resumeInteractions).toEqual([
      {
        tool_use_id: 'toolu_body',
        payload: [{ questionId: 'q1', value: ANSWER_SENTINEL }],
        declined: false,
      },
    ]);
  });
});

describe('executeDagWorkflow -- queued guidance (#181)', () => {
  const RUN_ID = 'steering-run-1';
  const askQuestions = [
    {
      id: 'q1',
      prompt: 'Ship it?',
      selection: 'single' as const,
      options: ['yes', 'no'],
      allowOther: false,
    },
  ];

  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-steer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    getSteeringRegistry().clearForTests();
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    getSteeringRegistry().clearForTests();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function liveHandle(runId: string, stepName: string): NodeSteeringHandle {
    const handle = getSteeringRegistry().get(runId, stepName);
    if (!handle) throw new Error(`expected live steering handle for ${runId}/${stepName}`);
    return handle;
  }

  function enqueue(
    runId: string,
    stepName: string,
    messageId: string,
    message: string,
    operatorUserId: string | null = 'op-1'
  ): void {
    const result = liveHandle(runId, stepName).enqueue({
      messageId,
      message,
      operatorUserId,
      receivedAt: new Date().toISOString(),
    });
    if (!result.ok) throw new Error(`enqueue refused: ${result.reason}`);
  }

  type SteeringNodeMsg = Awaited<ReturnType<IWorkflowStore['listNodeMessages']>>[number];
  function isOperatorTextRow(row: SteeringNodeMsg): row is SteeringNodeMsg & {
    kind: 'text';
    payload: { text: string };
    metadata: {
      origin: 'operator';
      operator_user_id: string | null;
      message_id?: string;
      execution?: { attempt_id: string; occurrence_id: string; loop_ancestry?: unknown };
    };
  } {
    return row.kind === 'text' && row.metadata?.origin === 'operator';
  }

  function storedEventTypes(store: IWorkflowStore): string[] {
    return (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => (call[0] as { event_type: string }).event_type
    );
  }

  function nodeFailedError(store: IWorkflowStore, stepName: string): string {
    const failed = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === stepName
    );
    if (!failed) throw new Error(`expected node_failed for ${stepName}`);
    return ((failed[0] as { data: { error: string } }).data.error ?? '') as string;
  }

  async function invokeDag(
    store: IWorkflowStore,
    nodes: DagNode[],
    opts?: { runId?: string; assistant?: 'claude' | 'pi' }
  ): Promise<IWorkflowPlatform> {
    const assistant = opts?.assistant ?? 'claude';
    const config =
      assistant === 'pi'
        ? {
            ...minimalConfig,
            assistant: 'pi' as const,
            assistants: { ...minimalConfig.assistants, pi: {} },
          }
        : minimalConfig;
    const platform = createMockPlatform();
    await executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      { name: 'steering-test', nodes },
      makeWorkflowRun(opts?.runId ?? RUN_ID),
      assistant,
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      config
    );
    return platform;
  }

  function sendQueryArg<T>(callIndex: number, argIndex: number): T {
    return mockSendQueryDag.mock.calls[callIndex][argIndex] as T;
  }

  it('drains queued guidance as one follow-up turn resuming the settled session', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'first note', 'op-a');
        enqueue(RUN_ID, 'review', 'm-2', 'second note', 'op-b');
        yield { type: 'assistant', content: 'turn one' };
        yield { type: 'result', sessionId: 'sess-turn-1' };
        return;
      }
      yield { type: 'assistant', content: 'turn two' };
      yield { type: 'result', sessionId: 'sess-turn-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('first note\n\nsecond note');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-turn-1');
    const options = sendQueryArg<SendQueryOptions>(1, 3);
    expect(options.forkSession).toBe(false);
    expect(options.resumeInteractions).toBeUndefined();
    // Exactly one node_started — guidance turns emit no extra lifecycle events.
    const started = storedEventTypes(store).filter(t => t === 'node_started');
    expect(started.length).toBe(1);
    expect(storedEventTypes(store)).toContain('node_completed');
    // Lifecycle teardown: the handle is gone once the node finishes.
    expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();

    const rows = await store.listNodeMessages(RUN_ID, 'review');
    const operatorRows = rows.filter(isOperatorTextRow);
    expect(operatorRows.map(r => r.payload.text)).toEqual(['first note', 'second note']);
    expect(operatorRows.map(r => r.metadata.operator_user_id)).toEqual(['op-a', 'op-b']);
    expect(operatorRows.map(r => r.metadata.message_id)).toEqual(['m-1', 'm-2']);
    const firstTurnText = rows.find(r => r.kind === 'text' && r.payload.text === 'turn one');
    const secondTurnText = rows.find(r => r.kind === 'text' && r.payload.text === 'turn two');
    expect(firstTurnText).toBeDefined();
    expect(secondTurnText).toBeDefined();
    expect(firstTurnText!.seq).toBeLessThan(operatorRows[0]!.seq);
    expect(operatorRows[1]!.seq).toBeLessThan(secondTurnText!.seq);
    const causedAttempt = secondTurnText!.metadata?.execution?.attempt_id;
    expect(causedAttempt).toBeDefined();
    expect(operatorRows[0]!.metadata.execution?.attempt_id).toBe(causedAttempt);
    expect(operatorRows[1]!.metadata.execution?.attempt_id).toBe(causedAttempt);
    expect(firstTurnText!.metadata?.execution?.attempt_id).not.toBe(causedAttempt);
  });

  it('flushes batch output once per settled turn and folds usage across turns', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'more work');
        yield { type: 'assistant', content: 'turn one' };
        yield { type: 'result', sessionId: 's-1', tokens: { input: 10, output: 5 }, cost: 0.01 };
        return;
      }
      yield { type: 'assistant', content: 'turn two' };
      yield { type: 'result', sessionId: 's-2', tokens: { input: 20, output: 7 }, cost: 0.02 };
    });
    const store = createMockStore();
    const platform = await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    // Batch mode flushes each turn's output as its own message — never merged.
    const texts = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(
      call => call[1] as string
    );
    expect(texts.filter(t => t === 'turn one').length).toBe(1);
    expect(texts.filter(t => t === 'turn two').length).toBe(1);

    const completedCall = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call => (call[0] as { event_type: string }).event_type === 'node_completed'
    );
    const data = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(data.tokens).toEqual({ input: 30, output: 12 });
    expect(data.cost_usd).toBeCloseTo(0.03, 5);
  });

  it('preserves accumulated token usage when a later guidance turn omits usage', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'more work');
        yield { type: 'assistant', content: 'turn one' };
        yield { type: 'result', sessionId: 's-1', tokens: { input: 10, output: 5 } };
        return;
      }
      yield { type: 'assistant', content: 'turn two' };
      yield { type: 'result', sessionId: 's-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    const completedCall = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call => (call[0] as { event_type: string }).event_type === 'node_completed'
    );
    const data = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(data.tokens).toEqual({ input: 10, output: 5 });
  });

  it('exposes no handle when the provider cannot resume sessions', async () => {
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: () => ({ ...mockClaudeCapabilities(), sessionResume: false }),
    }));
    let observed: NodeSteeringHandle | undefined | 'unset' = 'unset';
    mockSendQueryDag.mockImplementation(function* () {
      observed = getSteeringRegistry().get(RUN_ID, 'review');
      yield { type: 'assistant', content: 'ok' };
      yield { type: 'result', sessionId: 's' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(observed).toBeUndefined();
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('fails before draining when the settled turn returns no session id', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'stranded guidance');
      yield { type: 'assistant', content: 'output' };
      yield { type: 'result' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toContain('no session id');
    // The queue was left intact — never drained into a dead end.
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('never drains on empty output', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'undrained');
      yield { type: 'result', sessionId: 's-1' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toContain('produced no assistant output');
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('never drains on a provider error', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'undrained');
      yield { type: 'assistant', content: 'partial' };
      throw new Error('provider exploded');
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toBe('provider exploded');
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('never drains on cancel', async () => {
    let streaming = false;
    let handleRef: NodeSteeringHandle | undefined;
    const store = createMockStore();
    store.getWorkflowRunStatus = mock(async () => (streaming ? 'cancelled' : 'running'));
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'undrained');
      streaming = true;
      yield { type: 'assistant', content: 'partial' };
      yield { type: 'result', sessionId: 's-1' };
    });
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toBe('Cancelled by user');
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('never drains on credit exhaustion', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'undrained');
      yield { type: 'assistant', content: 'credit balance exhausted' };
      yield { type: 'result', sessionId: 's-1' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toContain('Credit exhaustion');
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('never drains on idle timeout', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'undrained');
      yield { type: 'assistant', content: 'partial work' };
      await new Promise(() => {}); // hang — the idle watchdog owns the exit
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work', idle_timeout: 50 }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('parks on AskHuman, refuses sends while parked, and the resumed execution inherits the queue', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      calls++;
      if (calls === 1) {
        // Guidance queued mid-turn survives the park on the same handle.
        enqueue(RUN_ID, 'review', 'm-1', 'pre-park guidance');
        const ask = options?.nativeTools?.find(tool => tool.name === 'AskHuman');
        if (!ask) throw new Error('AskHuman was not injected');
        await ask.handler(
          { questions: askQuestions },
          { toolUseId: 'toolu_1', sessionId: 'sess-park' }
        );
        return;
      }
      yield { type: 'assistant', content: 'resumed turn' };
      yield { type: 'result', sessionId: 'sess-resumed' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'ask something' }]);

    // Paused pending: the handle is parked and refuses new sends.
    const parked = getSteeringRegistry().get(RUN_ID, 'review');
    expect(parked).toBeDefined();
    expect(parked!.snapshot().phase).toBe('parked');
    const refused = parked!.enqueue({
      messageId: 'm-2',
      message: 'too late',
      operatorUserId: 'op-1',
      receivedAt: new Date().toISOString(),
    });
    expect(refused).toEqual({ ok: false, reason: 'not_live' });

    // Resume: the same run re-enters the node; register() revives the parked
    // handle with its retained queue, and the boundary drains it into a
    // follow-up turn on the resumed session.
    await invokeDag(store, [{ id: 'review', prompt: 'ask something' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    expect(sendQueryArg<string>(2, 0)).toBe('pre-park guidance');
    expect(sendQueryArg<string | undefined>(2, 2)).toBe('sess-resumed');
  });

  it('includes the guidance text when a guidance turn is re-asked', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'classify', 'm-1', 'steer the verdict');
        yield { type: 'result', sessionId: 's-1', structuredOutput: { verdict: 'ok' } };
        return;
      }
      if (calls === 2) {
        // Guidance turn returns schema-invalid output → re-ask fires.
        yield { type: 'result', sessionId: 's-2', structuredOutput: { wrong: true } };
        return;
      }
      yield { type: 'result', sessionId: 's-3', structuredOutput: { verdict: 'fixed' } };
    });
    const store = createMockStore();
    await invokeDag(
      store,
      [
        {
          id: 'classify',
          prompt: 'decide',
          provider: 'pi',
          output_format: {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
          },
        },
      ],
      { assistant: 'pi' }
    );

    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    const reaskPrompt = sendQueryArg<string>(2, 0);
    expect(reaskPrompt).toContain('steer the verdict');
    expect(reaskPrompt).toContain('did not satisfy the required JSON schema');
    const operatorRows = (await store.listNodeMessages(RUN_ID, 'classify')).filter(
      isOperatorTextRow
    );
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0]!.payload.text).toBe('steer the verdict');
    expect(operatorRows[0]!.metadata.message_id).toBe('m-1');
  });

  it('delivers loop guidance inside the current iteration', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'my-loop', 'm-1', 'adjust course');
        yield { type: 'assistant', content: 'iteration one work' };
        yield { type: 'result', sessionId: 'loop-sess-1' };
        return;
      }
      yield { type: 'assistant', content: 'adjusted. <promise>COMPLETE</promise>' };
      yield { type: 'result', sessionId: 'loop-sess-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
      },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('adjust course');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('loop-sess-1');
    expect(sendQueryArg<SendQueryOptions>(1, 3).forkSession).toBe(false);
    expect(storedEventTypes(store)).toContain('node_completed');
    expect(getSteeringRegistry().get(RUN_ID, 'my-loop')).toBeUndefined();

    const rows = await store.listNodeMessages(RUN_ID, 'my-loop');
    const operatorRows = rows.filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0]!.payload.text).toBe('adjust course');
    const caused = rows.find(r => r.kind === 'text' && r.payload.text.includes('adjusted'));
    expect(caused).toBeDefined();
    expect(operatorRows[0]!.seq).toBeLessThan(caused!.seq);
    expect(operatorRows[0]!.metadata.execution?.attempt_id).toBe(
      caused!.metadata?.execution?.attempt_id
    );
    expect(operatorRows[0]!.metadata.execution?.loop_ancestry).toEqual([
      { node_id: 'my-loop', iteration: 1 },
    ]);
  });

  it('fails without draining when the latest loop guidance turn omits a session id', async () => {
    let calls = 0;
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'my-loop', 'm-1', 'first follow-up');
        yield { type: 'assistant', content: 'iteration work' };
        yield { type: 'result', sessionId: 'loop-sess-1' };
        return;
      }
      if (calls === 2) {
        handleRef = liveHandle(RUN_ID, 'my-loop');
        enqueue(RUN_ID, 'my-loop', 'm-2', 'second follow-up');
        yield { type: 'assistant', content: 'first follow-up result' };
        yield { type: 'result' };
        return;
      }
      yield { type: 'assistant', content: 'unexpected extra turn' };
      yield { type: 'result', sessionId: 'loop-sess-extra' };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 2 },
      },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(nodeFailedError(store, 'my-loop')).toContain('no session id');
    expect(handleRef!.snapshot().queued.map(message => message.message)).toEqual([
      'second follow-up',
    ]);
  });

  it('lets pending guidance win a completion boundary in a loop', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'my-loop', 'm-1', 'one more thing');
        yield { type: 'assistant', content: 'done <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'loop-sess-1' };
        return;
      }
      yield { type: 'assistant', content: 'extra done <promise>COMPLETE</promise>' };
      yield { type: 'result', sessionId: 'loop-sess-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
      },
    ]);

    // Completion did not short-circuit the queued guidance turn.
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('one more thing');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('loop-sess-1');
  });

  it('lets pending guidance win a max-iterations boundary in a loop', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'my-loop', 'm-1', 'last word');
        yield { type: 'assistant', content: 'work without signal' };
        yield { type: 'result', sessionId: 'loop-sess-1' };
        return;
      }
      yield { type: 'assistant', content: 'still no signal' };
      yield { type: 'result', sessionId: 'loop-sess-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 1 },
      },
    ]);

    // The guidance turn ran inside iteration 1 even though the loop then fails
    // on max_iterations — guidance is never silently dropped.
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('last word');
    expect(nodeFailedError(store, 'my-loop')).toContain('exceeded max iterations');
  });

  it('registers loop-group body prompt nodes under the namespaced step name', async () => {
    let calls = 0;
    let sawNamespaced: NodeSteeringHandle | undefined;
    let sawBare: NodeSteeringHandle | undefined | 'unset' = 'unset';
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        sawNamespaced = getSteeringRegistry().get(RUN_ID, 'grp.body');
        sawBare = getSteeringRegistry().get(RUN_ID, 'body');
        enqueue(RUN_ID, 'grp.body', 'm-1', 'guided');
        yield { type: 'assistant', content: 'body output COMPLETE' };
        yield { type: 'result', sessionId: 'sess-body-1' };
        return;
      }
      yield { type: 'assistant', content: 'guided output COMPLETE' };
      yield { type: 'result', sessionId: 'sess-body-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'grp',
        loop_group: {
          until: 'COMPLETE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'emit COMPLETE' }],
        },
      },
    ]);

    expect(sawNamespaced).toBeDefined();
    expect(sawBare).toBeUndefined();
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('guided');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-body-1');

    const bodyRows = await store.listNodeMessages(RUN_ID, 'grp.body');
    const operatorRows = bodyRows.filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0]!.node_id).toBe('grp.body');
    expect(operatorRows[0]!.payload.text).toBe('guided');
  });

  it('operator natural drain writes null identity explicitly', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-null', 'anonymous steer', null);
        yield { type: 'assistant', content: 'prior' };
        yield { type: 'result', sessionId: 's-1' };
        return;
      }
      yield { type: 'assistant', content: 'after' };
      yield { type: 'result', sessionId: 's-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);
    const operatorRows = (await store.listNodeMessages(RUN_ID, 'review')).filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(operatorRows[0]!.metadata, 'operator_user_id')
    ).toBe(true);
    expect(operatorRows[0]!.metadata.operator_user_id).toBeNull();
  });

  it('operator append failure still completes the node and keeps other rows', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'one');
        enqueue(RUN_ID, 'review', 'm-2', 'two');
        enqueue(RUN_ID, 'review', 'm-3', 'three');
        yield { type: 'assistant', content: 'prior' };
        yield { type: 'result', sessionId: 's-1' };
        return;
      }
      yield { type: 'assistant', content: 'guided' };
      yield { type: 'result', sessionId: 's-2' };
    });
    const store = createMockStore();
    const originalAppend = store.appendNodeMessage.bind(store);
    let operatorAppends = 0;
    store.appendNodeMessage = async input => {
      if (input.kind === 'text' && input.metadata?.origin === 'operator') {
        operatorAppends += 1;
        if (operatorAppends === 2) {
          throw new Error('operator append boom');
        }
      }
      return originalAppend(input);
    };
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(sendQueryArg<string>(1, 0)).toBe('one\n\ntwo\n\nthree');
    expect(storedEventTypes(store)).toContain('node_completed');
    const operatorRows = (await store.listNodeMessages(RUN_ID, 'review')).filter(isOperatorTextRow);
    expect(operatorRows.map(r => r.payload.text)).toEqual(['one', 'three']);
  });

  it('operator startup throw before first yield writes no operator row', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'never written');
        yield { type: 'assistant', content: 'prior' };
        yield { type: 'result', sessionId: 's-1' };
        return;
      }
      throw new Error('provider startup boom');
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);
    expect(nodeFailedError(store, 'review')).toBe('provider startup boom');
    const operatorRows = (await store.listNodeMessages(RUN_ID, 'review')).filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(0);
  });

  it('operator first-yield seam records rows before the caused assistant chunk', async () => {
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const holdFirst = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let resolveEntered: (() => void) | undefined;
    const enteredGuidance = new Promise<void>(resolve => {
      resolveEntered = resolve;
    });
    let beginTurnSeen = false;
    const appendOrder: string[] = [];
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'held note');
        yield { type: 'assistant', content: 'prior' };
        yield { type: 'result', sessionId: 's-1' };
        return;
      }
      // beginTurn already registered before sendQuery runs.
      beginTurnSeen = liveHandle(RUN_ID, 'review').steeringSubState() === 'generating';
      resolveEntered!();
      await holdFirst;
      yield { type: 'assistant', content: 'caused' };
      yield { type: 'result', sessionId: 's-2' };
    });
    const store = createMockStore();
    const originalAppend = store.appendNodeMessage.bind(store);
    store.appendNodeMessage = async input => {
      if (input.kind === 'text' && input.metadata?.origin === 'operator') {
        appendOrder.push('operator');
      } else if (input.kind === 'text' && input.payload.text === 'caused') {
        appendOrder.push('caused');
      }
      return originalAppend(input);
    };
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);
    await enteredGuidance;
    expect(beginTurnSeen).toBe(true);
    // Held before first yield: no operator receipt yet.
    expect((await store.listNodeMessages(RUN_ID, 'review')).filter(isOperatorTextRow)).toHaveLength(
      0
    );
    releaseFirst!();
    await run;
    expect(appendOrder).toEqual(['operator', 'caused']);
    const operatorRows = (await store.listNodeMessages(RUN_ID, 'review')).filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0]!.payload.text).toBe('held note');
  });
});

describe('executeDagWorkflow -- interrupt and redirect (#183)', () => {
  const RUN_ID = 'interrupt-run-1';

  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dag-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    getSteeringRegistry().clearForTests();
    mockSendQueryDag.mockClear();
    mockGetAgentProviderDag.mockClear();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
  });

  afterEach(async () => {
    getSteeringRegistry().clearForTests();
    mockGetAgentProviderDag.mockImplementation(() => ({
      sendQuery: mockSendQueryDag,
      getType: () => 'claude',
      getCapabilities: mockClaudeCapabilities,
    }));
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function liveHandle(runId: string, stepName: string): NodeSteeringHandle {
    const handle = getSteeringRegistry().get(runId, stepName);
    if (!handle) throw new Error(`expected live steering handle for ${runId}/${stepName}`);
    return handle;
  }

  function steeringMessage(messageId: string, message: string) {
    return {
      messageId,
      message,
      operatorUserId: 'op-1',
      receivedAt: new Date().toISOString(),
    };
  }

  function enqueue(runId: string, stepName: string, messageId: string, message: string): void {
    const result = liveHandle(runId, stepName).enqueue(steeringMessage(messageId, message));
    if (!result.ok) throw new Error(`enqueue refused: ${result.reason}`);
  }

  type InterruptNodeMsg = Awaited<ReturnType<IWorkflowStore['listNodeMessages']>>[number];
  function isOperatorTextRow(row: InterruptNodeMsg): row is InterruptNodeMsg & {
    kind: 'text';
    payload: { text: string };
    metadata: {
      origin: 'operator';
      operator_user_id: string | null;
      message_id?: string;
      execution?: { attempt_id: string; occurrence_id: string };
    };
  } {
    return row.kind === 'text' && row.metadata?.origin === 'operator';
  }

  function sendNow(runId: string, stepName: string, messageId: string, message: string): void {
    const result = liveHandle(runId, stepName).accept(
      steeringMessage(messageId, message),
      'send_now'
    );
    if (!result.ok) throw new Error(`send_now refused: ${result.reason}`);
  }

  /** Poll until the handle projects the idle sub-state (or give up loudly). */
  async function awaitIdle(runId: string, stepName: string): Promise<NodeSteeringHandle> {
    for (let i = 0; i < 2000; i++) {
      const handle = getSteeringRegistry().get(runId, stepName);
      if (handle?.steeringSubState() === 'idle-after-interrupt') return handle;
      await Bun.sleep(1);
    }
    throw new Error(`handle ${runId}/${stepName} never reached idle-after-interrupt`);
  }

  function storedEventTypes(store: IWorkflowStore): string[] {
    return (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.map(
      call => (call[0] as { event_type: string }).event_type
    );
  }

  function nodeFailedError(store: IWorkflowStore, stepName: string): string {
    const failed = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call =>
        (call[0] as { event_type: string }).event_type === 'node_failed' &&
        (call[0] as { step_name: string }).step_name === stepName
    );
    if (!failed) throw new Error(`expected node_failed for ${stepName}`);
    return ((failed[0] as { data: { error: string } }).data.error ?? '') as string;
  }

  function toolCompletedOutcomes(store: IWorkflowStore): Map<string, string[]> {
    const outcomes = new Map<string, string[]>();
    for (const call of (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls) {
      const arg = call[0] as { event_type: string; data: Record<string, unknown> };
      if (arg.event_type !== 'tool_completed') continue;
      const id = arg.data.tool_call_id as string;
      const list = outcomes.get(id) ?? [];
      list.push(arg.data.tool_outcome as string);
      outcomes.set(id, list);
    }
    return outcomes;
  }

  async function transcriptStates(
    store: IWorkflowStore,
    runId: string,
    stepName: string
  ): Promise<string[]> {
    const rows = await store.listNodeMessages(runId, stepName);
    return rows.map(row => (row.kind === 'status' ? row.payload.state : row.kind));
  }

  async function invokeDag(
    store: IWorkflowStore,
    nodes: DagNode[],
    opts?: { runId?: string; assistant?: 'claude' | 'pi' | 'deepseek' }
  ): Promise<IWorkflowPlatform> {
    const assistant = opts?.assistant ?? 'claude';
    const config =
      assistant === 'pi'
        ? {
            ...minimalConfig,
            assistant: 'pi' as const,
            assistants: { ...minimalConfig.assistants, pi: {} },
          }
        : assistant === 'deepseek'
          ? {
              ...minimalConfig,
              assistant: 'deepseek' as const,
              assistants: { ...minimalConfig.assistants, deepseek: {} },
            }
          : minimalConfig;
    const platform = createMockPlatform();
    await executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      { name: 'interrupt-test', nodes },
      makeWorkflowRun(opts?.runId ?? RUN_ID),
      assistant,
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      config
    );
    return platform;
  }

  function sendQueryArg<T>(callIndex: number, argIndex: number): T {
    return mockSendQueryDag.mock.calls[callIndex][argIndex] as T;
  }

  it('interrupt parks an abort-marked result in idle and Send now drains old + new receipts in order on the same session', async () => {
    let calls = 0;
    let interruptOutcome: Promise<string> | undefined;
    const seenInterruptSignals: (AbortSignal | undefined)[] = [];
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      calls++;
      seenInterruptSignals.push(options?.interruptSignal);
      if (calls === 1) {
        interruptOutcome = liveHandle(RUN_ID, 'review').interrupt() as Promise<string>;
        yield { type: 'assistant', content: 'partial output' };
        yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
        return;
      }
      yield { type: 'assistant', content: 'redirected output' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    const idle = await awaitIdle(RUN_ID, 'review');
    expect(await interruptOutcome).toBe('idle-after-interrupt');
    // One committed 'interrupted' status row precedes the idle projection.
    const states = await transcriptStates(store, RUN_ID, 'review');
    expect(states.filter(s => s === 'interrupted').length).toBe(1);
    expect(states).not.toContain('failed');
    expect(storedEventTypes(store)).not.toContain('node_failed');

    // Two queue-intent rows land as awaiting_send_now; send_now drains all
    // three in receipt order into ONE redirect turn.
    enqueue(RUN_ID, 'review', 'm-old-1', 'old note one');
    enqueue(RUN_ID, 'review', 'm-old-2', 'old note two');
    expect(idle.snapshot().queued.length).toBe(2);
    sendNow(RUN_ID, 'review', 'm-new', 'new instruction');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('old note one\n\nold note two\n\nnew instruction');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
    expect(sendQueryArg<SendQueryOptions>(1, 3).forkSession).toBe(false);
    // Each provider pass got its own fresh interrupt signal.
    expect(seenInterruptSignals[0]).toBeDefined();
    expect(seenInterruptSignals[1]).toBeDefined();
    expect(seenInterruptSignals[0]).not.toBe(seenInterruptSignals[1]);
    expect(seenInterruptSignals[0]!.aborted).toBe(true);
    expect(seenInterruptSignals[1]!.aborted).toBe(false);
    expect(storedEventTypes(store)).toContain('node_completed');
    expect(storedEventTypes(store)).not.toContain('node_failed');
    expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();

    const rows = await store.listNodeMessages(RUN_ID, 'review');
    const operatorRows = rows.filter(isOperatorTextRow);
    expect(operatorRows.map(r => r.payload.text)).toEqual([
      'old note one',
      'old note two',
      'new instruction',
    ]);
    expect(operatorRows.map(r => r.metadata.message_id)).toEqual(['m-old-1', 'm-old-2', 'm-new']);
    const interrupted = rows.find(r => r.kind === 'status' && r.payload.state === 'interrupted');
    const resumed = rows.find(r => r.kind === 'text' && r.payload.text === 'redirected output');
    expect(interrupted).toBeDefined();
    expect(resumed).toBeDefined();
    expect(interrupted!.seq).toBeLessThan(operatorRows[0]!.seq);
    expect(operatorRows[2]!.seq).toBeLessThan(resumed!.seq);
    const resumedAttempt = resumed!.metadata?.execution?.attempt_id;
    expect(resumedAttempt).toBeDefined();
    expect(operatorRows.every(r => r.metadata.execution?.attempt_id === resumedAttempt)).toBe(true);
    expect(interrupted!.metadata?.execution?.attempt_id).not.toBe(resumedAttempt);
  });

  it('interrupt marker wins over an isError/errorSubtype result — idles instead of failing', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'review').interrupt();
        yield { type: 'assistant', content: 'partial' };
        yield {
          type: 'result',
          sessionId: 'sess-1',
          terminalReason: 'aborted_tools',
          isError: true,
          errorSubtype: 'error_during_execution',
        };
        return;
      }
      yield { type: 'assistant', content: 'resumed' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    sendNow(RUN_ID, 'review', 'm-1', 'carry on');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(storedEventTypes(store)).not.toContain('node_failed');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt classifies an abort-like throw as an interrupted end, not dag_node_failed', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'review').interrupt();
        yield { type: 'assistant', content: 'partial' };
        // Live background tasks keep the stream open past the result, so the
        // SDK's trailing abort throw reaches the consumer — the realistic
        // shape of an interrupted stream (US-001 spike).
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 'task-1', description: 'still running' }],
        };
        yield { type: 'result', sessionId: 'sess-1' };
        throw new Error(
          'Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null'
        );
      }
      yield { type: 'assistant', content: 'resumed' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    sendNow(RUN_ID, 'review', 'm-1', 'carry on');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
    expect(storedEventTypes(store)).not.toContain('node_failed');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt does not convert an unrelated throw racing Stop into an interrupted end', async () => {
    mockSendQueryDag.mockImplementation(async function* () {
      void liveHandle(RUN_ID, 'review').interrupt();
      yield { type: 'assistant', content: 'partial' };
      throw new Error('provider exploded for a different reason');
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toBe('provider exploded for a different reason');
  });

  it('interrupt does not convert an unrelated Claude error-result throw into an interrupted end', async () => {
    const providerError =
      "Claude Code returned an error result: You've hit your limit · resets 4:50pm (UTC)";
    mockSendQueryDag.mockImplementation(async function* () {
      void liveHandle(RUN_ID, 'review').interrupt();
      yield { type: 'assistant', content: 'partial' };
      throw new Error(providerError);
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toBe(providerError);
  });

  it('interrupt racing a natural unmarked result still drains queued guidance and settles generating', async () => {
    let calls = 0;
    let interruptOutcome: Promise<string> | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        enqueue(RUN_ID, 'review', 'm-1', 'queued steer');
        interruptOutcome = liveHandle(RUN_ID, 'review').interrupt() as Promise<string>;
        yield { type: 'assistant', content: 'turn one' };
        yield { type: 'result', sessionId: 'sess-1' };
        return;
      }
      yield { type: 'assistant', content: 'turn two' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(await interruptOutcome).toBe('generating');
    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('queued steer');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt racing a natural unmarked result on an empty queue settles node_finished', async () => {
    let interruptOutcome: Promise<string> | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      interruptOutcome = liveHandle(RUN_ID, 'review').interrupt() as Promise<string>;
      yield { type: 'assistant', content: 'all done' };
      yield { type: 'result', sessionId: 'sess-1' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(await interruptOutcome).toBe('node_finished');
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(storedEventTypes(store)).toContain('node_completed');
    expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();
  });

  it('interrupt losing to node Cancel keeps the existing Cancel failure — no idle', async () => {
    let cancelled = false;
    let interruptOutcome: Promise<string> | undefined;
    const store = createMockStore();
    store.getWorkflowRunStatus = mock(async () => (cancelled ? 'cancelled' : 'running'));
    mockSendQueryDag.mockImplementation(async function* () {
      interruptOutcome = liveHandle(RUN_ID, 'review').interrupt() as Promise<string>;
      cancelled = true; // terminal status lands before the first chunk's poll
      yield { type: 'assistant', content: 'partial' };
      yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
    });
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(nodeFailedError(store, 'review')).toBe('Cancelled by user');
    expect(await interruptOutcome).toBe('node_finished');
    expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();
  });

  it('interrupt discards the idle waiter into the existing Cancel path', async () => {
    mockSendQueryDag.mockImplementation(async function* () {
      void liveHandle(RUN_ID, 'review').interrupt();
      yield { type: 'assistant', content: 'partial' };
      yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    getSteeringRegistry().discardRun(RUN_ID);
    await run;

    expect(nodeFailedError(store, 'review')).toBe('Cancelled by user');
    expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();
  });

  it('interrupt skips structured-output validation and the re-ask on an abort-marked result', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'classify').interrupt();
        // Abort-marked result with NO structuredOutput — validation would
        // re-ask a natural miss; an interrupted end must not.
        yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
        return;
      }
      yield { type: 'result', sessionId: 'sess-2', structuredOutput: { verdict: 'ok' } };
    });
    const store = createMockStore();
    const run = invokeDag(store, [
      {
        id: 'classify',
        prompt: 'decide',
        output_format: {
          type: 'object',
          properties: { verdict: { type: 'string' } },
          required: ['verdict'],
        },
      },
    ]);

    await awaitIdle(RUN_ID, 'classify');
    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    sendNow(RUN_ID, 'classify', 'm-1', 'retry properly');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('retry properly');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt flag blocks a re-ask after Stop raced an invalid natural result', async () => {
    let interruptOutcome: Promise<string> | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      interruptOutcome = liveHandle(RUN_ID, 'classify').interrupt() as Promise<string>;
      // UNMARKED result wins the race — but the Stop flag must prevent a
      // re-ask pass from claiming the turn slot; the miss fails normally.
      yield { type: 'result', sessionId: 'sess-1', structuredOutput: { wrong: true } };
    });
    const store = createMockStore();
    await invokeDag(store, [
      {
        id: 'classify',
        prompt: 'decide',
        output_format: {
          type: 'object',
          properties: { verdict: { type: 'string' } },
          required: ['verdict'],
        },
      },
    ]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'classify')).toContain('structured output');
    expect(await interruptOutcome).toBe('node_finished');
  });

  it('interrupt settles an outstanding tool interrupted and leaves a settled one untouched — one status row', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'review').interrupt();
        yield { type: 'tool', toolName: 'Read', toolCallId: 'tool-done', toolInput: {} };
        yield {
          type: 'tool_result',
          toolName: 'Read',
          toolCallId: 'tool-done',
          toolOutcome: 'success',
        };
        yield { type: 'tool', toolName: 'Bash', toolCallId: 'tool-open', toolInput: {} };
        yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_tools' };
        return;
      }
      yield { type: 'assistant', content: 'resumed' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    const outcomes = toolCompletedOutcomes(store);
    expect(outcomes.get('tool-done')).toEqual(['success']);
    expect(outcomes.get('tool-open')).toEqual(['interrupted']);
    sendNow(RUN_ID, 'review', 'm-1', 'carry on');
    await run;

    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt suppresses the live-background-task wait and the incomplete warning', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        yield {
          type: 'background_tasks',
          tasks: [{ taskId: 'task-1', description: 'still running' }],
        };
        void liveHandle(RUN_ID, 'review').interrupt();
        yield { type: 'assistant', content: 'partial' };
        yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
        return;
      }
      yield { type: 'assistant', content: 'resumed' };
      yield { type: 'result', sessionId: 'sess-2' };
    });
    const store = createMockStore();
    const platform = createMockPlatform();
    const config = minimalConfig;
    const run = executeDagWorkflow(
      createMockDeps(store),
      platform,
      'conv-dag',
      testDir,
      { name: 'interrupt-test', nodes: [{ id: 'review', prompt: 'do work' }] },
      makeWorkflowRun(RUN_ID),
      'claude',
      undefined,
      join(testDir, 'artifacts'),
      join(testDir, 'state'),
      join(testDir, 'logs'),
      'main',
      'docs/',
      config
    );

    await awaitIdle(RUN_ID, 'review');
    const sent = (platform.sendMessage as ReturnType<typeof mock>).mock.calls.map(
      call => call[1] as string
    );
    expect(sent.some(text => text.includes('background agent task'))).toBe(false);
    sendNow(RUN_ID, 'review', 'm-1', 'carry on');
    await run;
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt preserves usage and cost exactly once across the redirect turn', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'review').interrupt();
        yield {
          type: 'result',
          sessionId: 'sess-1',
          terminalReason: 'aborted_streaming',
          tokens: { input: 10, output: 5 },
          cost: 0.01,
        };
        return;
      }
      yield { type: 'assistant', content: 'redirected' };
      yield { type: 'result', sessionId: 'sess-2', tokens: { input: 20, output: 7 }, cost: 0.02 };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    sendNow(RUN_ID, 'review', 'm-1', 'carry on');
    await run;

    const completedCall = (store.createWorkflowEvent as ReturnType<typeof mock>).mock.calls.find(
      call => (call[0] as { event_type: string }).event_type === 'node_completed'
    );
    const data = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(data.tokens).toEqual({ input: 30, output: 12 });
    expect(data.cost_usd).toBeCloseTo(0.03, 5);
  });

  it('interrupt without a session id fails explicitly instead of losing resumability', async () => {
    let handleRef: NodeSteeringHandle | undefined;
    mockSendQueryDag.mockImplementation(async function* () {
      handleRef = liveHandle(RUN_ID, 'review');
      enqueue(RUN_ID, 'review', 'm-1', 'stranded');
      void handleRef.interrupt();
      yield { type: 'assistant', content: 'partial' };
      yield { type: 'result', terminalReason: 'aborted_streaming' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    expect(mockSendQueryDag.mock.calls.length).toBe(1);
    expect(nodeFailedError(store, 'review')).toContain('no session id');
    expect(handleRef!.snapshot().queued.length).toBe(1);
  });

  it('interrupt twice uses a fresh token and controller per turn with no stale-flag contamination', async () => {
    let calls = 0;
    const outcomes: Promise<string>[] = [];
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls <= 2) {
        outcomes.push(liveHandle(RUN_ID, 'review').interrupt() as Promise<string>);
        yield { type: 'assistant', content: `partial ${String(calls)}` };
        yield {
          type: 'result',
          sessionId: `sess-${String(calls)}`,
          terminalReason: 'aborted_streaming',
        };
        return;
      }
      yield { type: 'assistant', content: 'final' };
      yield { type: 'result', sessionId: 'sess-3' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

    await awaitIdle(RUN_ID, 'review');
    expect(await outcomes[0]).toBe('idle-after-interrupt');
    sendNow(RUN_ID, 'review', 'm-1', 'first redirect');
    await awaitIdle(RUN_ID, 'review');
    expect(await outcomes[1]).toBe('idle-after-interrupt');
    sendNow(RUN_ID, 'review', 'm-2', 'second redirect');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
    expect(sendQueryArg<string | undefined>(2, 2)).toBe('sess-2');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt stays unavailable on a queue-only provider', async () => {
    let observed: { subState: unknown; interruptSignal: unknown; outcome?: string } | undefined;
    mockSendQueryDag.mockImplementation(async function* (
      _prompt: string,
      _cwd: string,
      _resume?: string,
      options?: SendQueryOptions
    ) {
      const handle = getSteeringRegistry().get(RUN_ID, 'review');
      observed = {
        subState: handle?.steeringSubState(),
        interruptSignal: options?.interruptSignal,
      };
      if (handle) {
        observed.outcome = await handle.interrupt();
      }
      yield { type: 'assistant', content: 'done' };
      yield { type: 'result', sessionId: 'sess-pi' };
    });
    const store = createMockStore();
    await invokeDag(store, [{ id: 'review', prompt: 'do work', provider: 'pi' }], {
      assistant: 'pi',
    });

    expect(observed).toBeDefined();
    expect(observed!.subState).toBeUndefined();
    expect(observed!.interruptSignal).toBeUndefined();
    expect(observed!.outcome).toBe('not_steerable_here');
    expect(storedEventTypes(store)).toContain('node_completed');
  });

  it('interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'my-loop').interrupt();
        yield { type: 'assistant', content: 'iteration work' };
        yield { type: 'result', sessionId: 'loop-sess-1', terminalReason: 'aborted_streaming' };
        return;
      }
      yield { type: 'assistant', content: 'redirected. <promise>COMPLETE</promise>' };
      yield { type: 'result', sessionId: 'loop-sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
      },
    ]);

    await awaitIdle(RUN_ID, 'my-loop');
    const states = await transcriptStates(store, RUN_ID, 'my-loop');
    expect(states).toContain('interrupted');
    sendNow(RUN_ID, 'my-loop', 'm-1', 'redirect the loop');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('redirect the loop');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('loop-sess-1');
    // The redirect ran inside iteration 1 — only one iteration ran at all.
    const iterationCompleted = (
      store.createWorkflowEvent as ReturnType<typeof mock>
    ).mock.calls.filter(
      call =>
        (call[0] as { event_type: string }).event_type === 'loop_iteration_completed' ||
        (call[0] as { event_type: string }).event_type === 'node_completed'
    );
    expect(iterationCompleted.length).toBeGreaterThan(0);
    expect(storedEventTypes(store)).toContain('node_completed');
    expect(storedEventTypes(store)).not.toContain('node_failed');
    expect(getSteeringRegistry().get(RUN_ID, 'my-loop')).toBeUndefined();

    const rows = await store.listNodeMessages(RUN_ID, 'my-loop');
    const operatorRows = rows.filter(isOperatorTextRow);
    expect(operatorRows).toHaveLength(1);
    expect(operatorRows[0]!.payload.text).toBe('redirect the loop');
    const interrupted = rows.find(r => r.kind === 'status' && r.payload.state === 'interrupted');
    const resumed = rows.find(r => r.kind === 'text' && r.payload.text.includes('redirected'));
    expect(interrupted).toBeDefined();
    expect(resumed).toBeDefined();
    expect(interrupted!.seq).toBeLessThan(operatorRows[0]!.seq);
    expect(operatorRows[0]!.seq).toBeLessThan(resumed!.seq);
    expect(operatorRows[0]!.metadata.execution?.attempt_id).toBe(
      resumed!.metadata?.execution?.attempt_id
    );
    expect(operatorRows[0]!.metadata.execution?.attempt_id).not.toBe(
      interrupted!.metadata?.execution?.attempt_id
    );
  });

  it('interrupt throw in an AI loop resumes the threaded session, not the dead pass', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        // Iteration 1 completes naturally — its session threads iteration 2.
        yield { type: 'assistant', content: 'iteration one, no signal' };
        yield { type: 'result', sessionId: 'loop-sess-1' };
        return;
      }
      if (calls === 2) {
        void liveHandle(RUN_ID, 'my-loop').interrupt();
        yield { type: 'assistant', content: 'partial' };
        throw new Error('Query interrupted');
      }
      yield { type: 'assistant', content: 'redirected. <promise>COMPLETE</promise>' };
      yield { type: 'result', sessionId: 'loop-sess-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [
      {
        id: 'my-loop',
        loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
      },
    ]);

    await awaitIdle(RUN_ID, 'my-loop');
    sendNow(RUN_ID, 'my-loop', 'm-1', 'redirect');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(3);
    // The aborted pass emitted no result — the redirect resumed the loop's
    // threaded conversation (loop-sess-1), never a fresh session.
    expect(sendQueryArg<string>(2, 0)).toBe('redirect');
    expect(sendQueryArg<string | undefined>(2, 2)).toBe('loop-sess-1');
    expect(storedEventTypes(store)).toContain('node_completed');
    expect(storedEventTypes(store)).not.toContain('node_failed');
  });

  it('interrupt of a loop-group body node parks under the namespaced step name', async () => {
    let calls = 0;
    mockSendQueryDag.mockImplementation(async function* () {
      calls++;
      if (calls === 1) {
        void liveHandle(RUN_ID, 'grp.body').interrupt();
        yield { type: 'assistant', content: 'body partial' };
        yield { type: 'result', sessionId: 'sess-body-1', terminalReason: 'aborted_streaming' };
        return;
      }
      yield { type: 'assistant', content: 'body done COMPLETE' };
      yield { type: 'result', sessionId: 'sess-body-2' };
    });
    const store = createMockStore();
    const run = invokeDag(store, [
      {
        id: 'grp',
        loop_group: {
          until: 'COMPLETE',
          max_iterations: 1,
          nodes: [{ id: 'body', prompt: 'emit COMPLETE' }],
        },
      },
    ]);

    const idle = await awaitIdle(RUN_ID, 'grp.body');
    expect(idle.steeringSubState()).toBe('idle-after-interrupt');
    sendNow(RUN_ID, 'grp.body', 'm-1', 'redirect the body');
    await run;

    expect(mockSendQueryDag.mock.calls.length).toBe(2);
    expect(sendQueryArg<string>(1, 0)).toBe('redirect the body');
    expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-body-1');
    expect(getSteeringRegistry().get(RUN_ID, 'grp.body')).toBeUndefined();
  });

  /**
   * DeepSeek interrupt conformance (#187 / US-002).
   *
   * Phase 1 spike recorded Block (missing-env), so product
   * `DEEPSEEK_CAPABILITIES.interrupt` stays `false`. This fixture temporarily
   * replaces only the registered test capability so it can exercise the
   * native path without adding a production capability override.
   */
  describe('deepseek conformance', () => {
    const DEEPSEEK_RUN = 'deepseek-interrupt-run';

    /** Exact Phase 1 abort result — no terminalReason. */
    function abortedResult(sessionId: string) {
      return {
        type: 'result' as const,
        sessionId,
        stopReason: 'aborted' as const,
        isError: true as const,
        errorSubtype: 'deepseek_aborted' as const,
      };
    }

    /** Test-local native interrupt; product capability remains false under Block. */
    const deepseekTestCapabilities = {
      ...DEEPSEEK_CAPABILITIES,
      interrupt: 'native' as const,
    };

    beforeEach(() => {
      const registered = getRegistration('deepseek');
      Reflect.set(registered, 'capabilities', deepseekTestCapabilities);
      mockGetAgentProviderDag.mockImplementation(() => ({
        sendQuery: mockSendQueryDag,
        getType: () => 'deepseek',
        getCapabilities: () => DEEPSEEK_CAPABILITIES,
      }));
    });

    afterEach(() => {
      const registered = getRegistration('deepseek');
      Reflect.set(registered, 'capabilities', DEEPSEEK_CAPABILITIES);
      mockGetAgentProviderDag.mockImplementation(() => ({
        sendQuery: mockSendQueryDag,
        getType: () => 'claude',
        getCapabilities: mockClaudeCapabilities,
      }));
    });

    it('direct path: exact abort triple + operator flag idles, drains queue+Send now on same session, one interrupted tool, no re-ask', async () => {
      let calls = 0;
      let interruptOutcome: Promise<string> | undefined;
      mockSendQueryDag.mockImplementation(async function* () {
        calls++;
        if (calls === 1) {
          interruptOutcome = liveHandle(DEEPSEEK_RUN, 'review').interrupt() as Promise<string>;
          yield { type: 'tool', toolName: 'Bash', toolCallId: 'ds-tool-open', toolInput: {} };
          // Abort-marked DeepSeek result with NO structuredOutput — a natural
          // miss would re-ask; interrupt must skip the re-ask entirely.
          yield abortedResult('ds-sess-1');
          return;
        }
        yield { type: 'assistant', content: 'redirected' };
        yield { type: 'result', sessionId: 'ds-sess-2', structuredOutput: { verdict: 'ok' } };
      });
      const store = createMockStore();
      const run = invokeDag(
        store,
        [
          {
            id: 'review',
            prompt: 'do work',
            output_format: {
              type: 'object',
              properties: { verdict: { type: 'string' } },
              required: ['verdict'],
            },
          },
        ],
        { runId: DEEPSEEK_RUN, assistant: 'deepseek' }
      );

      const idle = await awaitIdle(DEEPSEEK_RUN, 'review');
      expect(await interruptOutcome).toBe('idle-after-interrupt');
      const states = await transcriptStates(store, DEEPSEEK_RUN, 'review');
      expect(states.filter(s => s === 'interrupted').length).toBe(1);
      expect(storedEventTypes(store)).not.toContain('node_failed');
      // Open tool settled interrupted exactly once.
      expect(toolCompletedOutcomes(store).get('ds-tool-open')).toEqual(['interrupted']);
      // Interrupted pass must not have re-asked structured output.
      expect(mockSendQueryDag.mock.calls.length).toBe(1);

      enqueue(DEEPSEEK_RUN, 'review', 'm-old', 'older guidance');
      expect(idle.snapshot().queued.length).toBe(1);
      sendNow(DEEPSEEK_RUN, 'review', 'm-new', 'new instruction');
      await run;

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      expect(sendQueryArg<string>(1, 0)).toBe('older guidance\n\nnew instruction');
      expect(sendQueryArg<string | undefined>(1, 2)).toBe('ds-sess-1');
      expect(storedEventTypes(store)).toContain('node_completed');
      expect(storedEventTypes(store)).not.toContain('node_failed');
      expect(getSteeringRegistry().get(DEEPSEEK_RUN, 'review')).toBeUndefined();
    });

    it('exact abort triple without operator flag follows SDK deepseek_aborted failure path', async () => {
      mockSendQueryDag.mockImplementation(async function* () {
        yield { type: 'assistant', content: 'partial' };
        yield abortedResult('ds-sess-fail');
      });
      const store = createMockStore();
      await invokeDag(store, [{ id: 'review', prompt: 'do work' }], {
        runId: DEEPSEEK_RUN,
        assistant: 'deepseek',
      });

      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      expect(nodeFailedError(store, 'review')).toContain('SDK returned deepseek_aborted');
      expect(storedEventTypes(store)).toContain('node_failed');
      expect(getSteeringRegistry().get(DEEPSEEK_RUN, 'review')).toBeUndefined();
    });

    it('operator flag + near-miss result (missing triple member) is normal failure, not idle', async () => {
      let interruptOutcome: Promise<string> | undefined;
      mockSendQueryDag.mockImplementation(async function* () {
        interruptOutcome = liveHandle(DEEPSEEK_RUN, 'review').interrupt() as Promise<string>;
        // Missing errorSubtype — exactness guard must NOT classify as interrupt.
        yield {
          type: 'result',
          sessionId: 'ds-sess-near',
          stopReason: 'aborted',
          isError: true,
          errorSubtype: 'something_else',
        };
      });
      const store = createMockStore();
      await invokeDag(store, [{ id: 'review', prompt: 'do work' }], {
        runId: DEEPSEEK_RUN,
        assistant: 'deepseek',
      });

      expect(mockSendQueryDag.mock.calls.length).toBe(1);
      expect(nodeFailedError(store, 'review')).toContain('SDK returned something_else');
      expect(storedEventTypes(store)).toContain('node_failed');
      expect(storedEventTypes(store)).not.toContain('node_completed');
      // Never entered idle — interrupt settles as node_finished on failure path.
      expect(await interruptOutcome).toBe('node_finished');
      expect(getSteeringRegistry().get(DEEPSEEK_RUN, 'review')).toBeUndefined();
    });

    it('AI loop: exact abort triple idles inside iteration; Send now resumes same session without consuming one', async () => {
      let calls = 0;
      mockSendQueryDag.mockImplementation(async function* () {
        calls++;
        if (calls === 1) {
          void liveHandle(DEEPSEEK_RUN, 'my-loop').interrupt();
          yield { type: 'assistant', content: 'iteration work' };
          yield abortedResult('ds-loop-sess-1');
          return;
        }
        yield { type: 'assistant', content: 'redirected. <promise>COMPLETE</promise>' };
        yield { type: 'result', sessionId: 'ds-loop-sess-2' };
      });
      const store = createMockStore();
      const run = invokeDag(
        store,
        [
          {
            id: 'my-loop',
            loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
          },
        ],
        { runId: DEEPSEEK_RUN, assistant: 'deepseek' }
      );

      await awaitIdle(DEEPSEEK_RUN, 'my-loop');
      const states = await transcriptStates(store, DEEPSEEK_RUN, 'my-loop');
      expect(states).toContain('interrupted');
      sendNow(DEEPSEEK_RUN, 'my-loop', 'm-1', 'redirect the loop');
      await run;

      expect(mockSendQueryDag.mock.calls.length).toBe(2);
      expect(sendQueryArg<string>(1, 0)).toBe('redirect the loop');
      expect(sendQueryArg<string | undefined>(1, 2)).toBe('ds-loop-sess-1');
      expect(storedEventTypes(store)).toContain('node_completed');
      expect(storedEventTypes(store)).not.toContain('node_failed');
      expect(getSteeringRegistry().get(DEEPSEEK_RUN, 'my-loop')).toBeUndefined();
    });
  });
});
