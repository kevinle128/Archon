import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  JSONL_READ_CHUNK_BYTES,
  MAX_CANDIDATE_FILES,
  MAX_DISCOVERY_ENTRIES,
  MAX_FILE_BYTES,
  MAX_LINE_BYTES,
  MAX_TOTAL_BYTES,
  collectHiddenSessionUsage,
  encodeOmpSessionCwdDirName,
  enrichResultWithHiddenUsage,
  findMainTranscriptPath,
  getDiscoveryMetricsForTest,
  getObservedMaxChunkAllocForTest,
  isMainTranscriptFileName,
  isTaskAgentFileName,
  parseTranscriptUsageEntries,
  resetDiscoveryMetricsForTest,
  resetObservedMaxChunkAllocForTest,
  resolveOmpSessionDir,
  setSessionUsageBoundsForTest,
  snapshotHiddenSessionFiles,
  type SessionUsageSnapshot,
} from './session-usage';

const tempRoots: string[] = [];

afterEach(async () => {
  setSessionUsageBoundsForTest(undefined);
  resetObservedMaxChunkAllocForTest();
  resetDiscoveryMetricsForTest();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) break;
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeTempRoot(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `omp-session-usage-${label}-`));
  tempRoots.push(root);
  return root;
}

function sessionHeader(id: string, cwd: string): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: '2026-09-04T00:00:00.000Z',
    cwd,
  });
}

function assistantLine(opts: {
  provider?: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  text?: string;
}): string {
  const input = opts.input ?? 10;
  const output = opts.output ?? 4;
  const cacheRead = opts.cacheRead ?? 1;
  const cacheWrite = opts.cacheWrite ?? 0;
  return JSON.stringify({
    type: 'message',
    id: 'msg-1',
    parentId: null,
    timestamp: '2026-09-04T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? 'secret-prompt-should-not-leak' }],
      provider: opts.provider ?? 'openai-codex',
      model: opts.model ?? 'gpt-test',
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        cost: { total: opts.cost ?? 0.2 },
      },
      stopReason: 'stop',
    },
  });
}

function userLine(text: string): string {
  return JSON.stringify({
    type: 'message',
    id: 'user-1',
    parentId: null,
    timestamp: '2026-09-04T00:00:00.500Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

/** Parent main-transcript ownership proof via assistant task toolCall names. */
function taskSpawnAssistantCall(names: string[]): string {
  return JSON.stringify({
    type: 'message',
    id: 'task-call-1',
    parentId: null,
    timestamp: '2026-09-04T00:00:01.500Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'call-task-1',
          name: 'task',
          arguments: {
            tasks: names.map(name => ({ name, agent: 'scout', task: `work for ${name}` })),
          },
        },
      ],
      provider: 'openai-codex',
      model: 'gpt-test',
      usage: {
        input: 1,
        output: 1,
        totalTokens: 2,
        cost: { total: 0 },
      },
      stopReason: 'toolUse',
    },
  });
}

/** Parent main-transcript ownership proof via task toolResult progress/results ids. */
function taskSpawnToolResult(names: string[]): string {
  return JSON.stringify({
    type: 'message',
    id: 'task-result-1',
    parentId: 'task-call-1',
    timestamp: '2026-09-04T00:00:02.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call-task-1',
      toolName: 'task',
      content: [{ type: 'text', text: 'spawned' }],
      details: {
        progress: names.map((id, index) => ({
          index,
          id,
          agent: 'scout',
          status: 'completed',
        })),
        results: names.map(id => ({ id, status: 'completed' })),
      },
    },
  });
}

async function proveTaskOwnership(mainPath: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await fs.appendFile(mainPath, `${taskSpawnAssistantCall(names)}\n`, 'utf8');
}

async function writeTranscript(filePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function layoutFresh(opts?: {
  cwd?: string;
  sessionId?: string;
  withAdvisor?: boolean;
  withTask?: boolean;
  nestedAdvisor?: boolean;
}): Promise<{
  root: string;
  cwd: string;
  sessionId: string;
  sessionDir: string;
  mainPath: string;
  artifactDir: string;
  env: Record<string, string>;
}> {
  const root = await makeTempRoot('fresh');
  const cwd = opts?.cwd ?? path.join(root, 'project');
  await fs.mkdir(cwd, { recursive: true });
  const sessionId = opts?.sessionId ?? 'sess-fresh-1';
  const sessionDir = path.join(root, 'sessions');
  await fs.mkdir(sessionDir, { recursive: true });
  const mainPath = path.join(sessionDir, `2026-09-04T00-00-00-000Z_${sessionId}.jsonl`);
  const artifactDir = mainPath.slice(0, -'.jsonl'.length);
  await writeTranscript(mainPath, [
    sessionHeader(sessionId, cwd),
    userLine('primary user prompt must stay out of usage'),
    assistantLine({ input: 5, output: 2, cost: 0.05, text: 'primary' }),
    ...(opts?.withTask !== false ? [taskSpawnAssistantCall(['ScoutTask'])] : []),
  ]);

  await fs.mkdir(artifactDir, { recursive: true });
  if (opts?.withAdvisor !== false) {
    await writeTranscript(path.join(artifactDir, '__advisor.default.jsonl'), [
      sessionHeader(`${sessionId}-advisor`, cwd),
      userLine('advisor prompt content'),
      assistantLine({
        provider: 'anthropic',
        model: 'claude-advisor',
        input: 20,
        output: 3,
        cost: 0.3,
        text: 'advisor reply',
      }),
    ]);
  }
  if (opts?.withTask !== false) {
    await writeTranscript(path.join(artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${sessionId}-task`, cwd),
      userLine('task prompt content'),
      assistantLine({
        provider: 'openai-codex',
        model: 'gpt-task',
        input: 30,
        output: 6,
        cost: 0.4,
        text: 'task reply',
      }),
    ]);
  }
  if (opts?.nestedAdvisor) {
    const nestedDir = path.join(artifactDir, 'ScoutTask');
    await fs.mkdir(nestedDir, { recursive: true });
    await writeTranscript(path.join(nestedDir, '__advisor.jsonl'), [
      sessionHeader(`${sessionId}-nested-adv`, cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'nested-advisor',
        input: 7,
        output: 1,
        cost: 0.07,
        text: 'nested advisor',
      }),
    ]);
  }
  return {
    root,
    cwd,
    sessionId,
    sessionDir,
    mainPath,
    artifactDir,
    env: { PI_CODING_AGENT_SESSION_DIR: sessionDir },
  };
}

describe('resolveOmpSessionDir', () => {
  test('prefers exact PI_CODING_AGENT_SESSION_DIR', () => {
    const result = resolveOmpSessionDir({
      env: { PI_CODING_AGENT_SESSION_DIR: '/tmp/exact-session' },
      cwd: '/any',
    });
    expect(result).toEqual({
      ok: true,
      sessionDir: path.resolve('/tmp/exact-session'),
      source: 'session_dir_env',
    });
  });

  test('derives from PI_CODING_AGENT_DIR and encoded cwd', async () => {
    const root = await makeTempRoot('derive');
    const cwd = path.join(root, 'repo');
    await fs.mkdir(cwd, { recursive: true });
    const agentDir = path.join(root, 'agent');
    const result = resolveOmpSessionDir({
      env: { PI_CODING_AGENT_DIR: agentDir },
      cwd,
      homeDir: root,
      tmpDir: path.join(root, 'tmp'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('derived');
    expect(result.sessionDir).toBe(
      path.join(agentDir, 'sessions', encodeOmpSessionCwdDirName(cwd, root, path.join(root, 'tmp')))
    );
  });
});

describe('collectHiddenSessionUsage', () => {
  test('fresh session reads advisor, task, and nested advisor files once', async () => {
    const fx = await layoutFresh({ nestedAdvisor: true });
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeDefined();
    expect(
      hidden?.entries.map(e => ({ kind: e.kind, model: e.model, costUsd: e.costUsd }))
    ).toEqual([
      { kind: 'advisor', model: 'claude-advisor', costUsd: 0.3 },
      { kind: 'subagent', model: 'gpt-task', costUsd: 0.4 },
      { kind: 'advisor', model: 'nested-advisor', costUsd: 0.07 },
    ]);
    expect(hidden?.tokens.cost).toBeCloseTo(0.77);
    const serialized = JSON.stringify(hidden);
    expect(serialized).not.toContain('advisor reply');
    expect(serialized).not.toContain('task reply');
    expect(serialized).not.toContain('secret-prompt');
    expect(serialized).not.toContain('primary user prompt');
  });

  test('no-session skips transcript search', async () => {
    const fx = await layoutFresh();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      noSession: true,
    });
    expect(hidden).toBeUndefined();
  });

  test('wrong session header/cwd omits hidden usage', async () => {
    const fx = await layoutFresh();
    const wrongCwd = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: path.join(fx.root, 'other-cwd'),
      sessionId: fx.sessionId,
    });
    expect(wrongCwd).toBeUndefined();

    await writeTranscript(fx.mainPath, [
      sessionHeader('other-id', fx.cwd),
      assistantLine({ input: 1, output: 1, cost: 0.01 }),
    ]);
    const wrongId = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(wrongId).toBeUndefined();
  });

  test('resume parses only appended bytes and rejects mid-record snapshots', async () => {
    const fx = await layoutFresh({ withTask: false, nestedAdvisor: false });
    const advisorPath = path.join(fx.artifactDir, '__advisor.default.jsonl');
    const prior = await fs.readFile(advisorPath);
    const snapshot: SessionUsageSnapshot = {
      sessionDir: fx.sessionDir,
      artifactRoot: fx.artifactDir,
      files: [
        {
          relativePath: path.relative(fx.artifactDir, advisorPath),
          byteLength: prior.byteLength,
          prefixDigest: createHash('sha256').update(prior).digest('hex'),
          endsAtRecordBoundary: prior[prior.length - 1] === 0x0a,
          kind: 'advisor',
        },
      ],
    };

    await fs.appendFile(
      advisorPath,
      `${assistantLine({
        provider: 'anthropic',
        model: 'claude-advisor-2',
        input: 11,
        output: 2,
        cost: 0.11,
        text: 'new advisor turn',
      })}\n`
    );

    const delta = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot,
    });
    expect(delta?.entries).toEqual([
      expect.objectContaining({
        kind: 'advisor',
        model: 'claude-advisor-2',
        costUsd: 0.11,
        inputTokens: 11,
      }),
    ]);

    const cut = Math.max(1, prior.length - 3);
    const midRecord: SessionUsageSnapshot = {
      ...snapshot,
      files: snapshot.files.map(file => ({
        ...file,
        byteLength: cut,
        endsAtRecordBoundary: false,
        prefixDigest: createHash('sha256').update(prior.subarray(0, cut)).digest('hex'),
      })),
    };
    const rejected = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: midRecord,
    });
    expect(rejected?.entries ?? []).toEqual([]);
  });

  test('forked copied history is not counted; new files are', async () => {
    const source = await layoutFresh({ sessionId: 'source-sess', withTask: true });
    const dest = await layoutFresh({
      sessionId: 'dest-sess',
      cwd: source.cwd,
      withAdvisor: false,
      withTask: false,
    });
    const copiedAdvisor = path.join(dest.artifactDir, '__advisor.default.jsonl');
    await fs.copyFile(path.join(source.artifactDir, '__advisor.default.jsonl'), copiedAdvisor);
    const copiedBytes = await fs.readFile(copiedAdvisor);
    const snapshot: SessionUsageSnapshot = {
      sessionDir: source.sessionDir,
      artifactRoot: source.artifactDir,
      files: [
        {
          relativePath: '__advisor.default.jsonl',
          byteLength: copiedBytes.byteLength,
          prefixDigest: createHash('sha256').update(copiedBytes).digest('hex'),
          endsAtRecordBoundary: true,
          kind: 'advisor',
        },
      ],
    };
    await writeTranscript(path.join(dest.artifactDir, 'NewTask.jsonl'), [
      sessionHeader('dest-task', dest.cwd),
      assistantLine({
        provider: 'openai-codex',
        model: 'new-task',
        input: 9,
        output: 1,
        cost: 0.09,
      }),
    ]);
    await proveTaskOwnership(dest.mainPath, ['NewTask']);

    const hidden = await collectHiddenSessionUsage({
      env: dest.env,
      cwd: dest.cwd,
      sessionId: dest.sessionId,
      snapshot,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['new-task']);
    expect(hidden?.entries.some(e => e.model === 'claude-advisor')).toBe(false);
  });

  test('changed prefix omits unsafe file rather than double-count', async () => {
    const fx = await layoutFresh({ withTask: false });
    const snapshot: SessionUsageSnapshot = {
      sessionDir: fx.sessionDir,
      files: [
        {
          relativePath: '__advisor.default.jsonl',
          byteLength: 32,
          prefixDigest: 'deadbeef',
          endsAtRecordBoundary: true,
          kind: 'advisor',
        },
      ],
    };
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('symlink path escape is rejected', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const outside = path.join(fx.root, 'outside.jsonl');
    await writeTranscript(outside, [
      sessionHeader('outside', fx.cwd),
      assistantLine({ input: 99, output: 9, cost: 9.9, model: 'escaped' }),
    ]);
    await fs.symlink(outside, path.join(fx.artifactDir, 'escape.jsonl'));

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('non-session JSONL artifacts are not treated as subagents', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, 'tool-dump.jsonl'), [
      JSON.stringify({ type: 'tool', name: 'bash', output: 'not a session' }),
      assistantLine({ model: 'should-not-count', input: 50, output: 50, cost: 5 }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('malformed JSONL lines are omitted without failing the run', async () => {
    const fx = await layoutFresh({ withTask: false });
    const advisorPath = path.join(fx.artifactDir, '__advisor.default.jsonl');
    await fs.appendFile(advisorPath, '{not-json\n');
    await fs.appendFile(
      advisorPath,
      `${assistantLine({ model: 'after-malformed', input: 2, output: 1, cost: 0.02 })}\n`
    );
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.some(e => e.model === 'after-malformed')).toBe(true);
    expect(hidden?.entries.some(e => e.model === 'claude-advisor')).toBe(true);
  });

  test('oversized line omits all hidden enrichment', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const huge = 'x'.repeat(MAX_LINE_BYTES + 10);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      `{"type":"message","message":{"role":"assistant","provider":"x","model":"y","usage":{"input":1,"output":1,"cost":{"total":1}},"content":[{"type":"text","text":"${huge}"}]}}`,
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  }, 60_000);

  test('missing files and null snapshot skip enrichment safely', async () => {
    const fx = await layoutFresh();
    const missing = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: 'does-not-exist',
    });
    expect(missing).toBeUndefined();

    const nullSnap = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: null,
    });
    expect(nullSnap).toBeUndefined();
  });

  test('snapshotHiddenSessionFiles captures existing candidates', async () => {
    const fx = await layoutFresh({ withTask: true });
    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    expect(snap).not.toBeNull();
    expect(snap?.files.some(f => f.relativePath.includes('__advisor'))).toBe(true);
    expect(snap?.files.some(f => f.relativePath.includes('ScoutTask'))).toBe(true);
    expect(snap?.files.every(f => f.endsAtRecordBoundary)).toBe(true);
    expect(snap?.files.every(f => f.kind === 'advisor' || f.kind === 'subagent')).toBe(true);
  }, 30000);

  test('negative token rows are rejected by the normalizer', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-neg', fx.cwd),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: 'x',
          model: 'bad',
          content: [],
          usage: { input: -5, output: 1, cost: { total: 1 } },
        },
      }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });
});

describe('enrichResultWithHiddenUsage', () => {
  test('appends hidden rows and costs without changing numTurns', () => {
    const enriched = enrichResultWithHiddenUsage(
      {
        tokens: { input: 5, output: 2, total: 7, cost: 0.05 },
        cost: 0.05,
        numTurns: 2,
        usageBreakdown: [
          {
            provider: 'openai-codex',
            model: 'primary',
            modelSource: 'reported' as const,
            inputTokens: 5,
            outputTokens: 2,
            requests: 1,
            costUsd: 0.05,
          },
        ],
      },
      {
        entries: [
          {
            provider: 'anthropic',
            model: 'advisor',
            modelSource: 'reported',
            inputTokens: 20,
            outputTokens: 3,
            requests: 1,
            costUsd: 0.3,
            kind: 'advisor',
          },
        ],
        tokens: { input: 20, output: 3, total: 23, cost: 0.3 },
      }
    );
    expect(enriched.numTurns).toBe(2);
    expect(enriched.tokens).toEqual({ input: 25, output: 5, total: 30, cost: 0.35 });
    expect(enriched.usageBreakdown).toHaveLength(2);
    expect(enriched.usageBreakdown?.[1]?.kind).toBe('advisor');
  });
});

describe('bounds constants', () => {
  test('file byte bound is 64 MiB', () => {
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('hidden transcript missingness (US-017)', () => {
  test('omits blank/missing provider rows while keeping valid sibling order', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-miss', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'keep-first',
        input: 2,
        output: 1,
        cost: 0.2,
      }),
      // blank provider — must not become unknown
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: '',
          model: 'blank',
          content: [],
          usage: { input: 9, output: 9, cost: { total: 0.9 } },
        },
      }),
      // missing provider
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'missing',
          content: [],
          usage: { input: 4, output: 1, cost: { total: 0.04 } },
        },
      }),
      assistantLine({
        provider: 'openai-codex',
        model: 'keep-last',
        input: 3,
        output: 2,
        cost: 0.03,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => ({ provider: e.provider, model: e.model }))).toEqual([
      { provider: 'anthropic', model: 'keep-first' },
      { provider: 'openai-codex', model: 'keep-last' },
    ]);
    expect(hidden?.entries.some(e => e.provider === 'unknown')).toBe(false);
    expect(hidden?.entries[0]?.kind).toBe('advisor');
    expect(hidden?.entries[1]?.kind).toBe('advisor');
  });
});

describe('US-018 harden OMP hidden-session discovery', () => {
  test('multiple matching main transcripts fail closed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(
      path.join(fx.sessionDir, `2026-09-04T01-00-00-000Z_${fx.sessionId}.jsonl`),
      [sessionHeader(fx.sessionId, fx.cwd), assistantLine({ input: 1, output: 1, cost: 0.01 })]
    );
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      assistantLine({ model: 'should-not-run', input: 9, output: 9, cost: 9 }),
    ]);

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('unrelated valid session-shaped JSONL under artifact is never billed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Main-transcript constructor dropped into the artifact dir.
    await writeTranscript(
      path.join(fx.artifactDir, `2026-09-04T00-00-00-000Z_${fx.sessionId}.jsonl`),
      [
        sessionHeader('foreign-main', fx.cwd),
        assistantLine({
          model: 'foreign-main',
          input: 40,
          output: 4,
          cost: 4,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]
    );
    // Reserved non-advisor dump.
    await writeTranscript(path.join(fx.artifactDir, '__debug.jsonl'), [
      sessionHeader('debug', fx.cwd),
      assistantLine({
        model: 'debug-model',
        input: 11,
        output: 1,
        cost: 1.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Orphan nested dir without a sibling task-agent transcript.
    await writeTranscript(path.join(fx.artifactDir, 'orphan-dir', 'Nested.jsonl'), [
      sessionHeader('orphan', fx.cwd),
      assistantLine({
        model: 'orphan-nested',
        input: 22,
        output: 2,
        cost: 2.2,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Valid advisor still bills.
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-ok', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'advisor-ok',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['advisor-ok']);
    expect(hidden?.entries.some(e => e.model === 'foreign-main')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'debug-model')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'orphan-nested')).toBe(false);
  });

  test('pathname swap after prefix verify cannot redirect the open handle', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const artifactRoot = await fs.realpath(fx.artifactDir);
    const goodPath = path.join(artifactRoot, '__advisor.jsonl');
    const priorLines = [
      sessionHeader('adv-swap', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'history',
        input: 5,
        output: 1,
        cost: 0.05,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ];
    await writeTranscript(goodPath, priorLines);
    const prior = await fs.readFile(goodPath);
    const delta = `${assistantLine({
      provider: 'anthropic',
      model: 'delta-good',
      input: 7,
      output: 2,
      cost: 0.07,
      cacheRead: 0,
      cacheWrite: 0,
      text: 'good-delta',
    })}\n`;
    await fs.appendFile(goodPath, delta);

    const evilPath = path.join(artifactRoot, 'evil-tmp.jsonl');
    await writeTranscript(evilPath, [
      sessionHeader('evil', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'evil-model',
        input: 99,
        output: 9,
        cost: 9.9,
        cacheRead: 0,
        cacheWrite: 0,
        text: 'evil-bytes',
      }),
    ]);

    const parsed = await parseTranscriptUsageEntries(
      goodPath,
      artifactRoot,
      'advisor',
      prior.byteLength,
      {
        requireSessionHeader: false,
        expectedPrefix: {
          byteLength: prior.byteLength,
          digest: createHash('sha256').update(prior).digest('hex'),
        },
        afterPrefixVerified: async () => {
          // Replace the pathname with a different inode after verification.
          await fs.rename(goodPath, `${goodPath}.bak`);
          await fs.rename(evilPath, goodPath);
        },
      }
    );

    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.entries.map(e => e.model)).toEqual(['delta-good']);
    expect(parsed.entries.some(e => e.model === 'evil-model')).toBe(false);
    expect(JSON.stringify(parsed.entries)).not.toContain('evil-bytes');
  });

  test('chunked JSONL parsing handles records split across read chunks and UTF-8 boundaries', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const artifactRoot = await fs.realpath(fx.artifactDir);
    const filePath = path.join(artifactRoot, '__advisor.jsonl');
    // Build a multi-kilobyte line so a 64KiB chunk boundary falls mid-record, and include
    // a multi-byte UTF-8 character that can straddle an arbitrary byte split.
    const pad = '字'.repeat(40_000); // 3 bytes each → ~120KiB payload
    const lines = [
      sessionHeader('chunked', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'chunk-model',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
        text: pad,
      }),
      assistantLine({
        provider: 'anthropic',
        model: 'after-chunk',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
        text: 'tail',
      }),
    ];
    await writeTranscript(filePath, lines);

    const parsed = await parseTranscriptUsageEntries(filePath, artifactRoot, 'advisor', 0);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.entries.map(e => e.model)).toEqual(['chunk-model', 'after-chunk']);
    // Content is never returned — only usage rows.
    expect(JSON.stringify(parsed.entries)).not.toContain(pad.slice(0, 32));
  });

  test('exact file count bound succeeds and one-over omits all hidden enrichment', async () => {
    // Seam shrinks the production 1_000-file ceiling so the test stays cheap while
    // exercising the same exclusive comparison used at MAX_CANDIDATE_FILES.
    expect(MAX_CANDIDATE_FILES).toBe(1_000);
    setSessionUsageBoundsForTest({ maxCandidateFiles: 3 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    for (let i = 0; i < 3; i++) {
      const name = i === 0 ? '__advisor.jsonl' : `Task${i}.jsonl`;
      await writeTranscript(path.join(fx.artifactDir, name), [
        sessionHeader(`id-${i}`, fx.cwd),
        assistantLine({
          model: `m-${i}`,
          input: 1,
          output: 0,
          cost: 0.001,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]);
    }
    await proveTaskOwnership(fx.mainPath, ['Task1', 'Task2']);
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries).toHaveLength(3);

    await writeTranscript(path.join(fx.artifactDir, 'TaskOverflow.jsonl'), [
      sessionHeader('overflow', fx.cwd),
      assistantLine({
        model: 'overflow',
        input: 1,
        output: 0,
        cost: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['TaskOverflow']);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });

    expect(over).toBeUndefined();
  });

  test('exact and one-over file byte bound', async () => {
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
    setSessionUsageBoundsForTest({ maxFileBytes: 2_000 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const header = sessionHeader('file-bound', fx.cwd);
    const body = assistantLine({
      model: 'exact-file',
      input: 1,
      output: 1,
      cost: 0.01,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const exactContent = `${header}\n${body}\n`;
    const pad = 2_000 - Buffer.byteLength(exactContent, 'utf8') - 1;
    expect(pad).toBeGreaterThan(0);
    const content = `${exactContent}${' '.repeat(pad)}\n`;
    expect(Buffer.byteLength(content, 'utf8')).toBe(2_000);
    await fs.writeFile(path.join(fx.artifactDir, '__advisor.jsonl'), content);

    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.some(e => e.model === 'exact-file')).toBe(true);

    await fs.writeFile(path.join(fx.artifactDir, '__advisor.jsonl'), `${content}x`);
    expect((await fs.stat(path.join(fx.artifactDir, '__advisor.jsonl'))).size).toBe(2_001);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('exact and one-over total byte bound', async () => {
    expect(MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
    setSessionUsageBoundsForTest({ maxTotalBytes: 4_000 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    const makeSized = async (name: string, model: string, targetSize: number) => {
      const header = sessionHeader(`s-${model}`, fx.cwd);
      const body = assistantLine({
        model,
        input: 1,
        output: 0,
        cost: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
      });
      const base = `${header}\n${body}\n`;
      const pad = targetSize - Buffer.byteLength(base, 'utf8') - 1;
      expect(pad).toBeGreaterThanOrEqual(0);
      const content = `${base}${' '.repeat(pad)}\n`;
      expect(Buffer.byteLength(content, 'utf8')).toBe(targetSize);
      await fs.writeFile(path.join(fx.artifactDir, name), content);
    };

    await makeSized('TaskA.jsonl', 'a', 2_000);
    await makeSized('TaskB.jsonl', 'b', 2_000);
    await proveTaskOwnership(fx.mainPath, ['TaskA', 'TaskB']);
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.map(e => e.model).sort()).toEqual(['a', 'b']);

    await makeSized('TaskB.jsonl', 'b', 2_001);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });
  test('exact line bound succeeds and one-over omits all hidden enrichment', async () => {
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
    // Bound must sit above ordinary main-transcript lines (~325B) so ownership
    // extraction still runs; the hidden advisor line is built to this exact size.
    const lineBound = 400;
    setSessionUsageBoundsForTest({ maxLineBytes: lineBound });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const header = sessionHeader('line-bound', fx.cwd);
    const prefix =
      '{"type":"message","message":{"role":"assistant","provider":"x","model":"exact-line","usage":{"input":1,"output":1,"cost":{"total":1}},"content":[{"type":"text","text":"';
    const suffix = '"}]}}';
    const fill = lineBound - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8');
    expect(fill).toBeGreaterThan(0);
    const exactLine = `${prefix}${'a'.repeat(fill)}${suffix}`;
    expect(Buffer.byteLength(exactLine, 'utf8')).toBe(lineBound);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [header, exactLine]);
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.some(e => e.model === 'exact-line')).toBe(true);

    const overLine = `${prefix}${'a'.repeat(fill + 1)}${suffix}`;
    expect(Buffer.byteLength(overLine, 'utf8')).toBe(lineBound + 1);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [header, overLine]);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('hidden legacy totals include cache-read and cache-write dimensions', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('cache-adv', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'cache-model',
        input: 10,
        output: 4,
        cacheRead: 6,
        cacheWrite: 2,
        cost: 0.5,
      }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries[0]).toEqual(
      expect.objectContaining({
        model: 'cache-model',
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 6,
        cacheWriteTokens: 2,
        costUsd: 0.5,
      })
    );
    // Pi totalTokens = input + output + cacheRead + cacheWrite
    expect(hidden?.tokens).toEqual({ input: 10, output: 4, total: 22, cost: 0.5 });

    const enriched = enrichResultWithHiddenUsage(
      {
        tokens: { input: 1, output: 1, total: 2, cost: 0.01 },
        cost: 0.01,
        numTurns: 3,
        usageBreakdown: [],
      },
      hidden!
    );
    expect(enriched.numTurns).toBe(3);
    expect(enriched.tokens).toEqual({ input: 11, output: 5, total: 24, cost: 0.51 });
  });
});

describe('US-026 OMP hidden-session ownership and bounded streaming', () => {
  test('Orphan.jsonl without parent ownership is omitted; owned task + nested advisor remain', async () => {
    const fx = await layoutFresh({
      withAdvisor: false,
      withTask: false,
      nestedAdvisor: false,
    });

    // Billable-looking orphan with a valid session header — no parent spawn linkage.
    await writeTranscript(path.join(fx.artifactDir, 'Orphan.jsonl'), [
      sessionHeader('orphan-sess', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'orphan-model',
        input: 99,
        output: 9,
        cost: 9.9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    // Owned task-agent + nested advisor under its stem directory.
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-task`, fx.cwd),
      assistantLine({
        provider: 'openai-codex',
        model: 'owned-task',
        input: 30,
        output: 6,
        cost: 0.4,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested-adv`, fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'owned-nested-advisor',
        input: 7,
        output: 1,
        cost: 0.07,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    // Parent ownership via toolResult progress/results ids (not just filename).
    await fs.appendFile(fx.mainPath, `${taskSpawnToolResult(['ScoutTask'])}\n`, 'utf8');

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual([
      'owned-nested-advisor',
      'owned-task',
    ]);
    expect(hidden?.entries.some(e => e.model === 'orphan-model')).toBe(false);
  });

  test('snapshot and resume prefix digests stay chunked at the exact file bound', async () => {
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
    const exactBound = 200_000;
    setSessionUsageBoundsForTest({ maxFileBytes: exactBound });

    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    const header = sessionHeader('chunk-bound', fx.cwd);
    const body = assistantLine({
      model: 'chunk-exact',
      input: 1,
      output: 1,
      cost: 0.01,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const base = `${header}\n${body}\n`;
    const pad = exactBound - Buffer.byteLength(base, 'utf8') - 1;
    expect(pad).toBeGreaterThan(JSONL_READ_CHUNK_BYTES);
    const content = `${base}${' '.repeat(pad)}\n`;
    expect(Buffer.byteLength(content, 'utf8')).toBe(exactBound);
    await fs.writeFile(path.join(fx.artifactDir, '__advisor.jsonl'), content);

    resetObservedMaxChunkAllocForTest();
    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    expect(snap).not.toBeNull();
    expect(snap?.files).toHaveLength(1);
    expect(snap?.files[0]?.byteLength).toBe(exactBound);
    // Chunk path never allocates the full prefix length (exactBound).
    expect(getObservedMaxChunkAllocForTest()).toBeLessThan(exactBound);
    expect(getObservedMaxChunkAllocForTest()).toBeLessThanOrEqual(
      JSONL_READ_CHUNK_BYTES + MAX_LINE_BYTES
    );

    const prior = snap!.files[0]!;
    resetObservedMaxChunkAllocForTest();
    const artifactRoot = await fs.realpath(fx.artifactDir);
    const parsed = await parseTranscriptUsageEntries(
      path.join(artifactRoot, '__advisor.jsonl'),
      artifactRoot,
      'advisor',
      prior.byteLength,
      { expectedPrefix: { byteLength: prior.byteLength, digest: prior.prefixDigest } }
    );
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') {
      expect(parsed.entries).toEqual([]);
      expect(parsed.openedSize).toBe(exactBound);
    }
    expect(getObservedMaxChunkAllocForTest()).toBeLessThan(exactBound);
    expect(getObservedMaxChunkAllocForTest()).toBeLessThanOrEqual(
      JSONL_READ_CHUNK_BYTES + MAX_LINE_BYTES
    );
  });

  test('growth after discovery uses opened sizes and omits all hidden enrichment', async () => {
    setSessionUsageBoundsForTest({ maxTotalBytes: 500 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('grow', fx.cwd),
      assistantLine({
        model: 'grow-model',
        input: 1,
        output: 1,
        cost: 0.01,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      afterCandidatesListed: async candidates => {
        expect(candidates.length).toBe(1);
        const target = candidates[0]!.absolutePath;
        // Discovery saw a small file; inflate past the total bound before verified open.
        await fs.appendFile(target, `${'x'.repeat(600)}\n`, 'utf8');
      },
    });
    expect(hidden).toBeUndefined();
  });

  test('OMP-allocated __advisor-2 task stem is billable when parent-owned; unowned __debug is not', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor-2.jsonl'), [
      sessionHeader('adv2-task', fx.cwd),
      assistantLine({
        model: 'advisor-bumped-task',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, '__debug.jsonl'), [
      sessionHeader('debug', fx.cwd),
      assistantLine({
        model: 'debug-dump',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['__advisor-2']);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['advisor-bumped-task']);
    expect(hidden?.entries.some(e => e.model === 'debug-dump')).toBe(false);
  });

  test('ownership extract rejects main transcripts whose session header does not match', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Rewrite main with a foreign session id but plant a task ownership record.
    await writeTranscript(fx.mainPath, [
      sessionHeader('foreign-session', fx.cwd),
      taskSpawnAssistantCall(['ScoutTask']),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader('task', fx.cwd),
      assistantLine({
        model: 'should-not-bill',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('path replacement after discovery is rejected by identity check', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const advisorPath = path.join(fx.artifactDir, '__advisor.jsonl');
    await writeTranscript(advisorPath, [
      sessionHeader('orig', fx.cwd),
      assistantLine({
        model: 'original-model',
        input: 1,
        output: 1,
        cost: 0.01,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      afterCandidatesListed: async candidates => {
        expect(candidates.length).toBe(1);
        const target = candidates[0]!.absolutePath;
        const original = await fs.lstat(target);
        // Unlink+recreate can reuse the inode on tmpfs/overlay. Write a sibling
        // first, then rename over the discovered path so the identity check
        // sees a different ino (same pattern as the prefix-swap test).
        const replacement = `${target}.replacement`;
        await writeTranscript(replacement, [
          sessionHeader('replaced', fx.cwd),
          assistantLine({
            model: 'replaced-model',
            input: 50,
            output: 5,
            cost: 5,
            cacheRead: 0,
            cacheWrite: 0,
          }),
        ]);
        expect((await fs.lstat(replacement)).ino).not.toBe(original.ino);
        await fs.rm(target);
        await fs.rename(replacement, target);
      },
    });
    // Fail closed: replacement inode is not billed.
    expect(hidden?.entries ?? []).toEqual([]);
    expect(hidden?.entries.some(e => e.model === 'replaced-model') ?? false).toBe(false);
  });

  test('snapshot omits when a historical line after the session header exceeds the line bound', async () => {
    // Header is found early; a later oversize line in the same prefix must still fail closed.
    const lineBound = 400;
    setSessionUsageBoundsForTest({ maxLineBytes: lineBound });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const header = sessionHeader('post-header-oversize', fx.cwd);
    const okBody = assistantLine({
      model: 'before-oversize',
      input: 1,
      output: 1,
      cost: 0.01,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const oversize = `${'x'.repeat(lineBound + 1)}`;
    expect(Buffer.byteLength(oversize, 'utf8')).toBe(lineBound + 1);
    await fs.writeFile(
      path.join(fx.artifactDir, '__advisor.jsonl'),
      `${header}\n${okBody}\n${oversize}\n`,
      'utf8'
    );

    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    // Snapshot fails closed — no files accepted when any historical line exceeds the bound.
    expect(snap).toBeNull();
  });
});

describe('US-033 recognize only exact OMP main transcripts', () => {
  const sid = 'sess-exact-1';

  test('isMainTranscriptFileName accepts only ISO-dash constructor', () => {
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(true);
    expect(isMainTranscriptFileName(`2026-12-31T23-59-59-999Z_${sid}.jsonl`, sid)).toBe(true);

    // Suffix decoys
    expect(isMainTranscriptFileName(`notes_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`${sid}.jsonl`, sid)).toBe(false);

    // Malformed / non-canonical timestamps (colons/dots left, missing millis, wrong sep)
    expect(isMainTranscriptFileName(`2026-09-04T00:00:00.000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-00Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-9-4T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04_00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`prefix-2026-09-04T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(
      false
    );
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z-extra_${sid}.jsonl`, sid)).toBe(
      false
    );
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z_${sid}-x.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z_other.jsonl`, sid)).toBe(false);
  });

  test('findMainTranscriptPath ignores decoys and never selects them alone', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Remove the exact main; plant only decoys with valid-looking session headers.
    await fs.rm(fx.mainPath);
    const decoys = [
      `notes_${fx.sessionId}.jsonl`,
      `_${fx.sessionId}.jsonl`,
      // Colon timestamps are illegal Windows filenames; the predicate still
      // rejects that shape in the name-only test above.
      ...(process.platform === 'win32' ? [] : [`2026-09-04T00:00:00.000Z_${fx.sessionId}.jsonl`]),
      `2026-09-04T00-00-00Z_${fx.sessionId}.jsonl`,
      `2026-09-04_00-00-00-000Z_${fx.sessionId}.jsonl`,
    ];
    for (const name of decoys) {
      await writeTranscript(path.join(fx.sessionDir, name), [
        sessionHeader(fx.sessionId, fx.cwd),
        assistantLine({ input: 1, output: 1, cost: 0.01 }),
      ]);
    }

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    // Decoys must not seed ownership either.
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader('task', fx.cwd),
      assistantLine({
        model: 'should-not-bill',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Plant ownership claim inside a decoy "main" — still no trusted parent.
    await fs.appendFile(
      path.join(fx.sessionDir, decoys[0]!),
      `${taskSpawnAssistantCall(['ScoutTask'])}\n`,
      'utf8'
    );
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('one exact main wins over suffix decoys without ambiguity warning', async () => {
    const fx = await layoutFresh({ withAdvisor: true, withTask: true });
    // Suffix decoys beside the exact constructor.
    await writeTranscript(path.join(fx.sessionDir, `notes_${fx.sessionId}.jsonl`), [
      sessionHeader(fx.sessionId, fx.cwd),
      assistantLine({ model: 'decoy-notes', input: 99, output: 9, cost: 9 }),
    ]);
    await writeTranscript(path.join(fx.sessionDir, `_${fx.sessionId}.jsonl`), [
      sessionHeader(fx.sessionId, fx.cwd),
      assistantLine({ model: 'decoy-bare', input: 88, output: 8, cost: 8 }),
    ]);
    if (process.platform !== 'win32') {
      await writeTranscript(
        path.join(fx.sessionDir, `2026-09-04T00:00:00.000Z_${fx.sessionId}.jsonl`),
        [
          sessionHeader(fx.sessionId, fx.cwd),
          assistantLine({ model: 'decoy-colon', input: 1, output: 1, cost: 0.01 }),
        ]
      );
    }

    const found = await findMainTranscriptPath(fx.sessionDir, fx.sessionId);
    expect(found).toBe(fx.mainPath);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    // Exact main still owns ScoutTask + advisor; decoys do not suppress enrichment.
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(['claude-advisor', 'gpt-task'].sort());
  });

  test('two exact main constructors remain ambiguous and fail closed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(
      path.join(fx.sessionDir, `2026-09-04T01-00-00-000Z_${fx.sessionId}.jsonl`),
      [sessionHeader(fx.sessionId, fx.cwd), assistantLine({ input: 1, output: 1, cost: 0.01 })]
    );
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      assistantLine({ model: 'should-not-run', input: 9, output: 9, cost: 9 }),
    ]);

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('task-file classification uses the same exact main predicate', async () => {
    const sidLocal = 'sess-task-cls';
    // Exact main constructor is never a task-agent file (copied-main exclusion).
    expect(isTaskAgentFileName(`2026-09-04T00-00-00-000Z_${sidLocal}.jsonl`, sidLocal)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z_${sidLocal}.jsonl`, sidLocal)).toBe(
      true
    );

    // Suffix decoys are NOT main → remain eligible task constructors (ownership still gates).
    expect(isTaskAgentFileName(`notes_${sidLocal}.jsonl`, sidLocal)).toBe(true);
    expect(isMainTranscriptFileName(`notes_${sidLocal}.jsonl`, sidLocal)).toBe(false);
    expect(isTaskAgentFileName(`ScoutTask.jsonl`, sidLocal)).toBe(true);

    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Parent owns a suffix-decoy stem AND a plain task; exact copied-main shape is never billed.
    const decoyStem = `notes_${fx.sessionId}`;
    await proveTaskOwnership(fx.mainPath, [decoyStem, 'PlainTask']);

    await writeTranscript(path.join(fx.artifactDir, `${decoyStem}.jsonl`), [
      sessionHeader('notes-task', fx.cwd),
      assistantLine({
        model: 'notes-task-model',
        input: 4,
        output: 1,
        cost: 0.04,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'PlainTask.jsonl'), [
      sessionHeader('plain', fx.cwd),
      assistantLine({
        model: 'plain-task-model',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Exact main constructor under artifact — same predicate excludes it from task candidates.
    await writeTranscript(
      path.join(fx.artifactDir, `2026-09-04T12-00-00-000Z_${fx.sessionId}.jsonl`),
      [
        sessionHeader('copied-main', fx.cwd),
        assistantLine({
          model: 'copied-main-model',
          input: 40,
          output: 4,
          cost: 4,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]
    );

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['notes-task-model', 'plain-task-model'].sort()
    );
    expect(hidden?.entries.some(e => e.model === 'copied-main-model')).toBe(false);
  });
});

describe('US-041 reject calendar-impossible OMP main transcript names', () => {
  const sid = 'sess-cal-1';

  test('isMainTranscriptFileName rejects impossible calendar decoys and keeps leap/boundary', () => {
    // Canonical accepted boundaries
    expect(isMainTranscriptFileName(`2024-02-29T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(true);
    expect(isMainTranscriptFileName(`2026-12-31T23-59-59-999Z_${sid}.jsonl`, sid)).toBe(true);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(true);

    // Impossible months / zero day / out-of-range day
    expect(isMainTranscriptFileName(`2026-13-01T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-00-15T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-00T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-31T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-04-31T12-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);

    // Non-leap February 29
    expect(isMainTranscriptFileName(`2025-02-29T00-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-02-29T12-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);

    // Hour 24/99, minute/second 60/99
    expect(isMainTranscriptFileName(`2026-09-04T24-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T99-00-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-60-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-99-00-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-60-000Z_${sid}.jsonl`, sid)).toBe(false);
    expect(isMainTranscriptFileName(`2026-09-04T00-00-99-000Z_${sid}.jsonl`, sid)).toBe(false);
  });

  test('impossible-date decoy alone is never a trusted main; one valid exact wins', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await fs.rm(fx.mainPath);

    const impossible = `2026-02-29T00-00-00-000Z_${fx.sessionId}.jsonl`;
    await writeTranscript(path.join(fx.sessionDir, impossible), [
      sessionHeader(fx.sessionId, fx.cwd),
      assistantLine({ input: 1, output: 1, cost: 0.01 }),
      taskSpawnAssistantCall(['ShouldNotOwn']),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ShouldNotOwn.jsonl'), [
      sessionHeader('task', fx.cwd),
      assistantLine({
        model: 'should-not-bill',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    await expect(
      collectHiddenSessionUsage({
        env: fx.env,
        cwd: fx.cwd,
        sessionId: fx.sessionId,
      })
    ).resolves.toBeUndefined();

    // One calendar-valid exact main selects only that file.
    const validMain = path.join(fx.sessionDir, `2026-09-04T12-00-00-000Z_${fx.sessionId}.jsonl`);
    await writeTranscript(validMain, [
      sessionHeader(fx.sessionId, fx.cwd),
      assistantLine({ input: 2, output: 1, cost: 0.02 }),
    ]);
    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBe(validMain);
  });

  test('task-file exclusion uses the same calendar-valid constructor predicate', async () => {
    const sidLocal = 'sess-cal-task';
    const impossibleTaskId = `2025-02-29T00-00-00-000Z_${sidLocal}.jsonl`;
    // Impossible timestamp is NOT a trusted main → remains a task-agent constructor candidate.
    expect(isMainTranscriptFileName(impossibleTaskId, sidLocal)).toBe(false);
    expect(isTaskAgentFileName(impossibleTaskId, sidLocal)).toBe(true);

    // Real leap-day main constructor still excluded from task candidates.
    expect(isMainTranscriptFileName(`2024-02-29T00-00-00-000Z_${sidLocal}.jsonl`, sidLocal)).toBe(
      true
    );
    expect(isTaskAgentFileName(`2024-02-29T00-00-00-000Z_${sidLocal}.jsonl`, sidLocal)).toBe(false);

    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Parent owns an impossible-timestamp-shaped task stem; it must bill as a task, not main.
    const impossibleStem = `2026-09-31T00-00-00-000Z_${fx.sessionId}`;
    await proveTaskOwnership(fx.mainPath, [impossibleStem, 'PlainCalTask']);

    await writeTranscript(path.join(fx.artifactDir, `${impossibleStem}.jsonl`), [
      sessionHeader('impossible-task', fx.cwd),
      assistantLine({
        model: 'impossible-task-model',
        input: 4,
        output: 1,
        cost: 0.04,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'PlainCalTask.jsonl'), [
      sessionHeader('plain-cal', fx.cwd),
      assistantLine({
        model: 'plain-cal-model',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['impossible-task-model', 'plain-cal-model'].sort()
    );
  });

  test('multiple real exact constructors remain ambiguous and fail closed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(
      path.join(fx.sessionDir, `2024-02-29T12-00-00-000Z_${fx.sessionId}.jsonl`),
      [sessionHeader(fx.sessionId, fx.cwd), assistantLine({ input: 1, output: 1, cost: 0.01 })]
    );
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      assistantLine({ model: 'should-not-run', input: 9, output: 9, cost: 9 }),
    ]);

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });
});

describe('US-042 follow OMP task ownership recursively through task transcripts', () => {
  test('main→ScoutTask→NestedTask chain bills tasks and nested advisors once', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        provider: 'openai-codex',
        model: 'scout-task',
        input: 30,
        output: 6,
        cost: 0.4,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        provider: 'openai-codex',
        model: 'nested-task',
        input: 12,
        output: 3,
        cost: 0.12,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested-adv`, fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'nested-task-advisor',
        input: 4,
        output: 1,
        cost: 0.04,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout-adv`, fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'scout-advisor',
        input: 5,
        output: 1,
        cost: 0.05,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['nested-task', 'nested-task-advisor', 'scout-advisor', 'scout-task'].sort()
    );
    // Exactly once each — no double-count.
    expect(hidden?.entries.filter(e => e.model === 'nested-task')).toHaveLength(1);
    expect(hidden?.entries.filter(e => e.model === 'scout-task')).toHaveLength(1);
  });

  test('orphan nested task and cross-subtree same-name task are omitted without immediate parent proof', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    // Main owns ScoutTask + OtherTask. Only ScoutTask names NestedTask.
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        model: 'scout-task',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested-owned`, fx.cwd),
      assistantLine({
        model: 'owned-nested',
        input: 8,
        output: 2,
        cost: 0.08,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    // OtherTask is owned by main but does NOT name NestedTask — same stem under OtherTask is orphan.
    await writeTranscript(path.join(fx.artifactDir, 'OtherTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-other`, fx.cwd),
      assistantLine({
        model: 'other-task',
        input: 6,
        output: 1,
        cost: 0.06,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'OtherTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested-cross`, fx.cwd),
      assistantLine({
        model: 'cross-subtree-nested',
        input: 99,
        output: 9,
        cost: 9.9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    // Orphan nested dir with no parent task file ownership at all.
    await writeTranscript(path.join(fx.artifactDir, 'OrphanParent', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-orphan-nested`, fx.cwd),
      assistantLine({
        model: 'orphan-nested',
        input: 50,
        output: 5,
        cost: 5,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    // Global main naming NestedTask must not authorize OtherTask/NestedTask.
    await proveTaskOwnership(fx.mainPath, ['ScoutTask', 'OtherTask', 'NestedTask']);
    await writeTranscript(path.join(fx.artifactDir, 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-root-nested`, fx.cwd),
      assistantLine({
        model: 'root-nested-from-main',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['other-task', 'owned-nested', 'root-nested-from-main', 'scout-task'].sort()
    );
    expect(hidden?.entries.some(e => e.model === 'cross-subtree-nested')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'orphan-nested')).toBe(false);
  });

  test('resume nested-task layout excludes copied prefixes, includes appends and new descendants', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    const scoutPath = path.join(fx.artifactDir, 'ScoutTask.jsonl');
    const nestedPath = path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl');
    await writeTranscript(scoutPath, [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        model: 'scout-prior',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(nestedPath, [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        model: 'nested-prior',
        input: 8,
        output: 2,
        cost: 0.08,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    expect(snap).not.toBeNull();
    expect(snap?.files.map(f => f.relativePath).sort()).toEqual(
      ['ScoutTask.jsonl', path.join('ScoutTask', 'NestedTask.jsonl')].sort()
    );

    // Append new usage to both parents; add a brand-new nested advisor descendant.
    await fs.appendFile(
      scoutPath,
      `${assistantLine({
        model: 'scout-delta',
        input: 1,
        output: 1,
        cost: 0.01,
        cacheRead: 0,
        cacheWrite: 0,
      })}\n`,
      'utf8'
    );
    await fs.appendFile(
      nestedPath,
      `${assistantLine({
        model: 'nested-delta',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      })}\n`,
      'utf8'
    );
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-new-adv`, fx.cwd),
      assistantLine({
        model: 'new-descendant-advisor',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: snap,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['nested-delta', 'new-descendant-advisor', 'scout-delta'].sort()
    );
    expect(hidden?.entries.some(e => e.model === 'scout-prior')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'nested-prior')).toBe(false);
  });

  test('unverifiable parent prefix omits the descendant subtree on resume', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    const scoutPath = path.join(fx.artifactDir, 'ScoutTask.jsonl');
    const nestedPath = path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl');
    await writeTranscript(scoutPath, [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        model: 'scout-prior',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(nestedPath, [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        model: 'nested-should-omit',
        input: 8,
        output: 2,
        cost: 0.08,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout-adv`, fx.cwd),
      assistantLine({
        model: 'scout-adv-should-omit',
        input: 4,
        output: 1,
        cost: 0.04,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    expect(snap).not.toBeNull();

    // Corrupt ScoutTask prefix so resume verification fails; NestedTask file itself is intact.
    const tamperedSnap: SessionUsageSnapshot = {
      ...snap!,
      files: snap!.files.map(f =>
        f.relativePath === 'ScoutTask.jsonl' ? { ...f, prefixDigest: '0'.repeat(64) } : f
      ),
    };

    // NestedTask also grew after snapshot — must still be omitted with parent.
    await fs.appendFile(
      nestedPath,
      `${assistantLine({
        model: 'nested-delta-also-omit',
        input: 1,
        output: 1,
        cost: 0.01,
        cacheRead: 0,
        cacheWrite: 0,
      })}
`,
      'utf8'
    );

    // Sibling root advisor created after snapshot: fully new, outside omitted subtree.
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-root-adv`, fx.cwd),
      assistantLine({
        model: 'root-advisor-kept',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: tamperedSnap,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['root-advisor-kept']);
    expect(hidden?.entries.some(e => e.model === 'nested-should-omit')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'nested-delta-also-omit')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'scout-adv-should-omit')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'scout-prior')).toBe(false);
  });

  test('unverified parent cwd blocks subtree (nested task + advisor) while parent usage still bills', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, path.join(fx.root, 'other-cwd')),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        model: 'scout-wrong-cwd',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        model: 'nested-blocked',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-adv-blocked`, fx.cwd),
      assistantLine({
        model: 'advisor-blocked',
        input: 7,
        output: 1,
        cost: 0.07,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    // Parent still bills (main proved ownership); subtree blocked because parent handle
    // was unverified (cwd mismatch) — distinct from a verified parent with zero children.
    expect(hidden?.entries.map(e => e.model)).toEqual(['scout-wrong-cwd']);
    expect(hidden?.entries.some(e => e.model === 'nested-blocked')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'advisor-blocked')).toBe(false);
  });

  test('fork nested-task layout excludes copied history and bills only new descendants', async () => {
    const source = await layoutFresh({
      sessionId: 'fork-src',
      withAdvisor: false,
      withTask: false,
    });
    await writeTranscript(path.join(source.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${source.sessionId}-scout`, source.cwd),
      taskSpawnToolResult(['NestedTask']),
      assistantLine({
        model: 'src-scout',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(source.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${source.sessionId}-nested`, source.cwd),
      assistantLine({
        model: 'src-nested',
        input: 8,
        output: 2,
        cost: 0.08,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(source.mainPath, ['ScoutTask']);

    const snap = await snapshotHiddenSessionFiles({
      env: source.env,
      cwd: source.cwd,
      resumeSessionId: source.sessionId,
    });
    expect(snap).not.toBeNull();
    expect(snap!.files.map(f => f.relativePath).sort()).toEqual(
      ['ScoutTask.jsonl', path.join('ScoutTask', 'NestedTask.jsonl')].sort()
    );

    // Destination fork session: copy historical nested files, then append + add new descendant.
    const dest = await layoutFresh({
      sessionId: 'fork-dst',
      cwd: source.cwd,
      withAdvisor: false,
      withTask: false,
    });
    await fs.mkdir(path.join(dest.artifactDir, 'ScoutTask', 'NestedTask'), { recursive: true });
    await fs.copyFile(
      path.join(source.artifactDir, 'ScoutTask.jsonl'),
      path.join(dest.artifactDir, 'ScoutTask.jsonl')
    );
    await fs.copyFile(
      path.join(source.artifactDir, 'ScoutTask', 'NestedTask.jsonl'),
      path.join(dest.artifactDir, 'ScoutTask', 'NestedTask.jsonl')
    );
    await proveTaskOwnership(dest.mainPath, ['ScoutTask']);

    await fs.appendFile(
      path.join(dest.artifactDir, 'ScoutTask.jsonl'),
      `${assistantLine({
        model: 'fork-scout-delta',
        input: 1,
        output: 1,
        cost: 0.01,
        cacheRead: 0,
        cacheWrite: 0,
      })}\n`,
      'utf8'
    );
    await fs.appendFile(
      path.join(dest.artifactDir, 'ScoutTask', 'NestedTask.jsonl'),
      `${assistantLine({
        model: 'fork-nested-delta',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      })}\n`,
      'utf8'
    );
    await writeTranscript(
      path.join(dest.artifactDir, 'ScoutTask', 'NestedTask', '__advisor.jsonl'),
      [
        sessionHeader(`${dest.sessionId}-new-adv`, dest.cwd),
        assistantLine({
          model: 'fork-new-descendant',
          input: 3,
          output: 1,
          cost: 0.03,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]
    );

    // Snapshot relative paths/digests still match the copied prefixes under dest.
    const destSnap: SessionUsageSnapshot = {
      sessionDir: dest.sessionDir,
      artifactRoot: dest.artifactDir,
      files: snap!.files.map(f => ({ ...f })),
    };

    const hidden = await collectHiddenSessionUsage({
      env: dest.env,
      cwd: dest.cwd,
      sessionId: dest.sessionId,
      snapshot: destSnap,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['fork-nested-delta', 'fork-new-descendant', 'fork-scout-delta'].sort()
    );
    expect(hidden?.entries.some(e => e.model === 'src-scout')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'src-nested')).toBe(false);
  });

  test('verified parent with zero child stems still hosts nested advisors', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      // No NestedTask spawn — verified empty child set.
      assistantLine({
        model: 'scout-only',
        input: 10,
        output: 2,
        cost: 0.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-adv`, fx.cwd),
      assistantLine({
        model: 'zero-child-advisor',
        input: 4,
        output: 1,
        cost: 0.04,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        model: 'should-not-bill',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model).sort()).toEqual(
      ['scout-only', 'zero-child-advisor'].sort()
    );
    expect(hidden?.entries.some(e => e.model === 'should-not-bill')).toBe(false);
  });
});

describe('US-046 bound OMP directory enumeration before entry allocation', () => {
  test('production discovery-entry ceiling is independent of candidate-file limit', () => {
    expect(MAX_DISCOVERY_ENTRIES).toBe(10_000);
    expect(MAX_CANDIDATE_FILES).toBe(1_000);
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
  });

  test('main-transcript discovery: exact-bound succeeds and one-over omits before full scan', async () => {
    // layoutFresh session dir always has main.jsonl + artifact directory (2 entries).
    // Bound counts every name, not only mains.
    setSessionUsageBoundsForTest({ maxDiscoveryEntries: 6 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    // Exact: main + artifact dir + 4 noise files = 6 entries.
    for (let i = 0; i < 4; i++) {
      await fs.writeFile(path.join(fx.sessionDir, `noise-${i}.txt`), `n${i}`, 'utf8');
    }
    resetDiscoveryMetricsForTest();
    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBe(fx.mainPath);
    expect(getDiscoveryMetricsForTest().entriesExamined).toBe(6);

    // One-over: 7th name forces fail-closed before any further materialization.
    await fs.writeFile(path.join(fx.sessionDir, 'noise-overflow.txt'), 'x', 'utf8');
    resetDiscoveryMetricsForTest();
    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    expect(getDiscoveryMetricsForTest().entriesExamined).toBe(7);

    // Hidden enrichment omits entirely (deterministic, not a partial prefix).
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('artifact traversal: noise + candidates exact-bound succeeds; one-over omits without statting all', async () => {
    setSessionUsageBoundsForTest({ maxDiscoveryEntries: 4 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    // Exact 4 entries under artifact root: 1 advisor + 1 owned task + 2 noise files.
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-adv`, fx.cwd),
      assistantLine({
        model: 'adv-exact',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      assistantLine({
        model: 'scout-exact',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await fs.writeFile(path.join(fx.artifactDir, 'noise-a.bin'), 'aa', 'utf8');
    await fs.writeFile(path.join(fx.artifactDir, 'noise-b.bin'), 'bb', 'utf8');
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    resetDiscoveryMetricsForTest();
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.map(e => e.model).sort()).toEqual(['adv-exact', 'scout-exact'].sort());
    // listHiddenCandidates ends with artifact examined=4 (main discovery uses a separate counter).
    expect(getDiscoveryMetricsForTest().entriesExamined).toBe(4);
    expect(getDiscoveryMetricsForTest().lstatCalls).toBe(2); // only billable JSONL

    // One-over: add filler so artifact root has 5 names. Fail closed with no candidate lstats.
    await fs.writeFile(path.join(fx.artifactDir, 'noise-overflow.bin'), 'cc', 'utf8');
    resetDiscoveryMetricsForTest();
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
    const overMetrics = getDiscoveryMetricsForTest();
    expect(overMetrics.entriesExamined).toBe(5);
    expect(overMetrics.lstatCalls).toBe(0);
  });

  test('recursive artifact dirs share one discovery-entry counter', async () => {
    // Root: ScoutTask.jsonl + ScoutTask/ dir = 2 entries.
    // Nested: NestedTask.jsonl + 2 noise = 3 more → total examined 5 at exact bound.
    setSessionUsageBoundsForTest({ maxDiscoveryEntries: 5 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      assistantLine({
        model: 'scout-nested-bound',
        input: 5,
        output: 1,
        cost: 0.05,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask', 'NestedTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-nested`, fx.cwd),
      assistantLine({
        model: 'nested-exact',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await fs.appendFile(
      path.join(fx.artifactDir, 'ScoutTask.jsonl'),
      `${taskSpawnToolResult(['NestedTask'])}\n`,
      'utf8'
    );
    await fs.writeFile(path.join(fx.artifactDir, 'ScoutTask', 'noise-a.txt'), 'a', 'utf8');
    await fs.writeFile(path.join(fx.artifactDir, 'ScoutTask', 'noise-b.txt'), 'b', 'utf8');
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    resetDiscoveryMetricsForTest();
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.map(e => e.model).sort()).toEqual(
      ['nested-exact', 'scout-nested-bound'].sort()
    );
    expect(getDiscoveryMetricsForTest().entriesExamined).toBe(5);

    // One more nested noise → examined 6 > bound 5 → omit all.
    await fs.writeFile(path.join(fx.artifactDir, 'ScoutTask', 'noise-c.txt'), 'c', 'utf8');
    resetDiscoveryMetricsForTest();
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
    expect(getDiscoveryMetricsForTest().entriesExamined).toBe(6);
  });

  test('candidate-file limit still independent when discovery entries fit', async () => {
    setSessionUsageBoundsForTest({ maxDiscoveryEntries: 50, maxCandidateFiles: 2 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    for (let i = 0; i < 3; i++) {
      const name = i === 0 ? '__advisor.jsonl' : `Task${i}.jsonl`;
      await writeTranscript(path.join(fx.artifactDir, name), [
        sessionHeader(`id-${i}`, fx.cwd),
        assistantLine({
          model: `m-${i}`,
          input: 1,
          output: 0,
          cost: 0.001,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]);
    }
    await proveTaskOwnership(fx.mainPath, ['Task1', 'Task2']);
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(fx.artifactDir, `pad-${i}.txt`), 'p', 'utf8');
    }
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('result is order-independent: overflow omits regardless of which name is last', async () => {
    setSessionUsageBoundsForTest({ maxDiscoveryEntries: 3 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // 4 entries under artifact — always one-over, whichever readdir order.
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader(`${fx.sessionId}-adv`, fx.cwd),
      assistantLine({
        model: 'should-not-appear',
        input: 9,
        output: 9,
        cost: 9,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await writeTranscript(path.join(fx.artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${fx.sessionId}-scout`, fx.cwd),
      assistantLine({
        model: 'also-omitted',
        input: 8,
        output: 8,
        cost: 8,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    await fs.writeFile(path.join(fx.artifactDir, 'zzz-noise.txt'), 'z', 'utf8');
    await fs.writeFile(path.join(fx.artifactDir, 'aaa-noise.txt'), 'a', 'utf8');
    await proveTaskOwnership(fx.mainPath, ['ScoutTask']);

    for (let i = 0; i < 3; i++) {
      const hidden = await collectHiddenSessionUsage({
        env: fx.env,
        cwd: fx.cwd,
        sessionId: fx.sessionId,
      });
      expect(hidden).toBeUndefined();
    }
  });
});
