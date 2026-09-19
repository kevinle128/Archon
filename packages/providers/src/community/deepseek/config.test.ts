import { describe, expect, test } from 'bun:test';

import { DEEPSEEK_CAPABILITIES } from './capabilities';
import {
  DEFAULT_DEEPSEEK_PERMISSION_MODE,
  DEFAULT_DEEPSEEK_PROFILE,
  DEFAULT_DEEPSEEK_PROVIDER_ROUTE,
  parseDeepseekConfig,
  resolveDeepseekEffort,
} from './config';
import { DeepseekProviderError } from './errors';

describe('parseDeepseekConfig', () => {
  test('applies ACP defaults for empty input', () => {
    expect(parseDeepseekConfig({})).toEqual({
      profile: 'acp',
      providerRoute: 'deepseek-official',
      permissionMode: 'workspace-write',
    });
    expect(DEFAULT_DEEPSEEK_PROFILE).toBe('acp');
    expect(DEFAULT_DEEPSEEK_PROVIDER_ROUTE).toBe('deepseek-official');
    expect(DEFAULT_DEEPSEEK_PERMISSION_MODE).toBe('workspace-write');
  });

  test('trims model, baseUrl, providerRoute, and nodeBin', () => {
    expect(
      parseDeepseekConfig({
        model: '  deepseek-v4-flash  ',
        baseUrl: '  https://api.example.com/v1  ',
        providerRoute: '  deepseek-official  ',
        nodeBin: '  /usr/bin/node  ',
      })
    ).toEqual({
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.example.com/v1',
      providerRoute: 'deepseek-official',
      profile: 'acp',
      permissionMode: 'workspace-write',
      nodeBin: '/usr/bin/node',
    });
  });

  test('accepts only http: and https: base URLs', () => {
    expect(parseDeepseekConfig({ baseUrl: 'http://127.0.0.1:8080' }).baseUrl).toBe(
      'http://127.0.0.1:8080'
    );
    expect(parseDeepseekConfig({ baseUrl: 'https://dashscope.example/v1' }).baseUrl).toBe(
      'https://dashscope.example/v1'
    );
    expect(() => parseDeepseekConfig({ baseUrl: 'ftp://api.example.com' })).toThrow(/http:|https:/);
    expect(() => parseDeepseekConfig({ baseUrl: 'not-a-url' })).toThrow(/http:|https:/);
  });

  test('accepts only profile acp', () => {
    expect(parseDeepseekConfig({ profile: 'acp' }).profile).toBe('acp');
    expect(() => parseDeepseekConfig({ profile: 'sdk' })).toThrow(/acp/);
    expect(() => parseDeepseekConfig({ profile: 'tui' })).toThrow(/acp/);
  });

  test('accepts only workspace-write and danger-full-access permission modes', () => {
    expect(parseDeepseekConfig({ permissionMode: 'workspace-write' }).permissionMode).toBe(
      'workspace-write'
    );
    expect(parseDeepseekConfig({ permissionMode: 'danger-full-access' }).permissionMode).toBe(
      'danger-full-access'
    );
    expect(() => parseDeepseekConfig({ permissionMode: 'ask' })).toThrow(/permissionMode/);
  });

  test('allows providerRoute without a config model so request-level models can supply the pair', () => {
    expect(parseDeepseekConfig({ providerRoute: 'deepseek-official' })).toMatchObject({
      providerRoute: 'deepseek-official',
    });
    expect(parseDeepseekConfig({ providerRoute: 'custom-route' })).toMatchObject({
      providerRoute: 'custom-route',
    });
  });

  test('rejects defined maxTokens naming the unsupported pinned ACP surface', () => {
    expect(() => parseDeepseekConfig({ maxTokens: 65536 })).toThrow(DeepseekProviderError);
    try {
      parseDeepseekConfig({ maxTokens: 65536 });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DeepseekProviderError);
      expect((error as DeepseekProviderError).subtype).toBe('deepseek_unsupported_config');
      expect((error as Error).message).toMatch(/pinned ACP|reasoning_effort/);
    }
    expect(() => parseDeepseekConfig({ maxTokens: null })).toThrow(/pinned ACP|reasoning_effort/);
  });

  test('maps configured effort onto the returned config', () => {
    expect(parseDeepseekConfig({ effort: 'minimal' }).effort).toBe('off');
    expect(parseDeepseekConfig({ effort: 'high' }).effort).toBe('high');
  });
});

describe('resolveDeepseekEffort', () => {
  test('maps ladder rungs onto the DSH reasoning_effort vocabulary', () => {
    expect(resolveDeepseekEffort('minimal')).toBe('off');
    expect(resolveDeepseekEffort('medium')).toBe('low');
    expect(resolveDeepseekEffort('xhigh')).toBe('high');
  });

  test('preserves off, low, high, and max', () => {
    expect(resolveDeepseekEffort('off')).toBe('off');
    expect(resolveDeepseekEffort('low')).toBe('low');
    expect(resolveDeepseekEffort('high')).toBe('high');
    expect(resolveDeepseekEffort('max')).toBe('max');
  });

  test('returns undefined when effort is omitted', () => {
    expect(resolveDeepseekEffort(undefined)).toBeUndefined();
  });

  test('rejects unknown or blank values', () => {
    expect(() => resolveDeepseekEffort('')).toThrow(/effort/);
    expect(() => resolveDeepseekEffort('   ')).toThrow(/effort/);
    expect(() => resolveDeepseekEffort('ultra')).toThrow(/effort/);
    expect(() => resolveDeepseekEffort(3)).toThrow(/effort/);
  });
});

describe('DEEPSEEK_CAPABILITIES', () => {
  test('matches the exact DeepSeek capability object', () => {
    expect(DEEPSEEK_CAPABILITIES).toEqual({
      sessionResume: true,
      mcp: true,
      hooks: false,
      skills: false,
      agents: false,
      toolRestrictions: false,
      structuredOutput: 'best-effort',
      envInjection: true,
      costControl: false,
      effortControl: true,
      thinkingControl: false,
      fallbackModel: false,
      sandbox: false,
      settingSources: false,
      nativeTools: false,
      containerExec: false,
      askHuman: false,
      interrupt: false,
    });
  });
});
