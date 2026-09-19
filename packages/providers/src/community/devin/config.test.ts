import { describe, expect, test } from 'bun:test';

import { DEVIN_CAPABILITIES } from './capabilities';
import { buildDevinSpawnArgs, DEVIN_PERMISSION_MODE, parseDevinConfig } from './config';

describe('parseDevinConfig', () => {
  test('applies no defaults and keeps only supported keys', () => {
    expect(parseDevinConfig({})).toEqual({});
    expect(
      parseDevinConfig({
        model: ' claude-opus-5-low ',
        binaryPath: '/opt/devin/bin/devin',
        agentType: 'review',
        refusalFallback: ['claude-sonnet-5-medium', 'gpt-5-medium'],
        unrelated: true,
      })
    ).toEqual({
      model: 'claude-opus-5-low',
      binaryPath: '/opt/devin/bin/devin',
      agentType: 'review',
      refusalFallback: ['claude-sonnet-5-medium', 'gpt-5-medium'],
    });
  });

  test('rejects blank strings, bad agent types, and bad fallback lists', () => {
    expect(() => parseDevinConfig({ model: '  ' })).toThrow(/assistants\.devin\.model/);
    expect(() => parseDevinConfig({ binaryPath: 42 })).toThrow(/assistants\.devin\.binaryPath/);
    expect(() => parseDevinConfig({ agentType: 'planner' })).toThrow(
      /assistants\.devin\.agentType: expected 'summarizer' or 'review'/
    );
    expect(() => parseDevinConfig({ refusalFallback: 'opus' })).toThrow(
      /assistants\.devin\.refusalFallback: expected an array of non-empty strings/
    );
    expect(() => parseDevinConfig({ refusalFallback: [''] })).toThrow(
      /assistants\.devin\.refusalFallback/
    );
  });

  test('rejects permissionMode and sandbox because yolo is fixed', () => {
    expect(() => parseDevinConfig({ permissionMode: 'auto' })).toThrow(
      /assistants\.devin\.permissionMode is unsupported: Archon always runs Devin in yolo mode/
    );
    expect(() => parseDevinConfig({ sandbox: true })).toThrow(
      /assistants\.devin\.sandbox is unsupported/
    );
  });
});

describe('buildDevinSpawnArgs', () => {
  test('always pins yolo and the acp subcommand', () => {
    expect(buildDevinSpawnArgs({})).toEqual(['--permission-mode', DEVIN_PERMISSION_MODE, 'acp']);
  });

  test('appends agent type and comma-joined refusal fallbacks, never --model', () => {
    expect(
      buildDevinSpawnArgs({
        model: 'claude-opus-5-low',
        agentType: 'summarizer',
        refusalFallback: ['a', 'b'],
      })
    ).toEqual([
      '--permission-mode',
      'yolo',
      'acp',
      '--agent-type',
      'summarizer',
      '--refusal-fallback',
      'a,b',
    ]);
  });
});

describe('DEVIN_CAPABILITIES', () => {
  test('declares only the wired capabilities', () => {
    expect(DEVIN_CAPABILITIES).toEqual({
      sessionResume: true,
      mcp: false,
      hooks: false,
      skills: false,
      agents: false,
      toolRestrictions: false,
      structuredOutput: 'best-effort',
      envInjection: true,
      costControl: false,
      effortControl: false,
      thinkingControl: false,
      fallbackModel: false,
      sandbox: false,
      settingSources: false,
      nativeTools: false,
      containerExec: false,
      askHuman: true,
      interrupt: false,
    });
  });
});
