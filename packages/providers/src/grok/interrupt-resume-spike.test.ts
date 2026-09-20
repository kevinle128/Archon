import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  consumeStdout,
  sanitizeSpikeDocument,
  type SpikeDocument,
  writeSlowToolScript,
} from './interrupt-resume-spike';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Grok interrupt spike evidence helpers', () => {
  test('processes a final end event without a trailing newline', async () => {
    const child = {
      stdout: Readable.from([
        '{"type":"usage"}\n',
        '{"type":"end","stopReason":"end_turn","sessionId":"session-secret","usage":{"inputTokens":1}}',
      ]),
    } as Parameters<typeof consumeStdout>[0];

    const result = await consumeStdout(child);

    expect(result.eventTypes).toEqual(['usage', 'end']);
    expect(result.endStopReason).toBe('end_turn');
    expect(result.reportedSessionId).toBe('session-secret');
    expect(result.standaloneUsageSeen).toBe(true);
    expect(result.finalUsageSeen).toBe(true);
  });

  test('removes a stale slow-tool PID before the next experiment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'archon-grok-spike-test-'));
    tempDirectories.push(directory);
    const stalePidPath = join(directory, 'slow_tool.pid');
    writeFileSync(stalePidPath, '12345', 'utf8');

    const result = writeSlowToolScript(directory);

    expect(result.pidPath).toBe(stalePidPath);
    expect(existsSync(stalePidPath)).toBe(false);
  });

  test('omits successful session identifiers and process IDs from JSON evidence', () => {
    const document: SpikeDocument = {
      schemaVersion: 1,
      kind: 'grok-interrupt-resume-spike',
      cliVersion: 'grok 1.0.34',
      binaryPathBasename: 'grok',
      platform: 'darwin/arm64',
      arch: 'arm64',
      hostKind: 'native',
      experiments: [
        {
          id: 'S0',
          platform: 'darwin/arm64',
          eventTypes: ['end'],
          endStopReason: 'end_turn',
          assignedSessionId: 'assigned-secret',
          reportedSessionId: 'reported-secret',
          sessionIdEqual: true,
          standaloneUsageSeen: true,
          finalUsageSeen: true,
          exitCode: 0,
          signalToExitMs: null,
          usedSigkill: false,
          childPid: 4321,
          childAliveAfterParentExit: null,
          resumeExitCode: null,
          resumeSameSession: null,
          resumeContextRetained: null,
          passed: true,
          notes: [],
        },
      ],
      releaseGates: [],
      minimumVersionDecision: 'test floor',
      processGroupDecision: 'not required',
      proposedGraceMs: 5_000,
      cleanup: {
        sessionsDeleted: ['deleted-secret'],
        sessionsDeleteFailed: ['manual-cleanup-id'],
        tempDirRemoved: true,
      },
      overall: 'PASS',
    };

    const serialized = JSON.stringify(sanitizeSpikeDocument(document));

    expect(serialized).not.toContain('assigned-secret');
    expect(serialized).not.toContain('reported-secret');
    expect(serialized).not.toContain('deleted-secret');
    expect(serialized).not.toContain('4321');
    expect(serialized).toContain('manual-cleanup-id');
    expect(sanitizeSpikeDocument(document).cleanup.sessionsDeleted).toBe(1);
  });
});
