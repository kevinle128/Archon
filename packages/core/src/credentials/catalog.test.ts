import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerBuiltinProviders, registerCommunityProviders } from '@archon/providers';
import {
  getVendorCatalog,
  listConnectableVendors,
  isConnectableVendor,
  buildAgentCredentialMatrix,
} from './catalog';

beforeAll(() => {
  // The catalog derives from the provider registry — bootstrap like entrypoints do.
  registerBuiltinProviders();
  registerCommunityProviders();
});

const TOUCHED_ENV = ['OPENROUTER_API_KEY', 'AWS_PROFILE', 'CURSOR_API_KEY'];
const savedEnv = new Map<string, string | undefined>(TOUCHED_ENV.map(k => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('credentials/catalog', () => {
  test('union catalog merges vendors across agents with agent attribution', () => {
    const catalog = getVendorCatalog();
    // anthropic is consumed by both Claude Code and Pi.
    const anthropic = catalog.get('anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.agents).toContain('claude');
    expect(anthropic!.agents).toContain('pi');
    expect(anthropic!.kinds).toContain('api_key');
    expect(anthropic!.kinds).toContain('subscription');
    // Pi-only backends carry only Pi.
    expect(catalog.get('openrouter')?.agents).toEqual(['pi']);
    const cursor = catalog.get('cursor');
    expect(cursor).toEqual({
      vendor: 'cursor',
      displayName: 'Cursor',
      kinds: ['api_key'],
      agents: ['cursor'],
    });
    // Ambient-only vendors are present but not api_key-connectable.
    expect(catalog.get('amazon-bedrock')?.kinds).toEqual(['ambient']);
  });

  test('legacy agent ids are not catalog vendors; opencode contributes nothing static', () => {
    const catalog = getVendorCatalog();
    for (const legacy of ['claude', 'codex', 'copilot']) {
      expect(catalog.has(legacy)).toBe(false);
    }
    // The OpenCode HARNESS is dynamic (no static specs) — but 'opencode' the
    // vendor id exists via Pi's OpenCode Zen backend. Its only agent is pi.
    expect(catalog.get('opencode')?.agents).toEqual(['pi']);
  });

  test('listConnectableVendors is sorted and excludes ambient-only vendors', () => {
    const vendors = listConnectableVendors();
    expect(vendors).toEqual([...vendors].sort());
    expect(vendors).toContain('anthropic');
    expect(vendors).toContain('cursor');
    expect(vendors).toContain('github-copilot');
    expect(vendors).toContain('google-vertex'); // api_key-capable despite also-ambient
    expect(vendors).not.toContain('amazon-bedrock');
  });

  test('throws when a registration declares an undeliverable api_key vendor', async () => {
    const { registerProvider, clearRegistry } = await import('@archon/providers');
    try {
      registerProvider({
        id: 'broken-test-agent',
        displayName: 'Broken Test Agent',
        builtIn: false,
        capabilities: {} as never,
        factory: () => ({}) as never,
        credentials: {
          kind: 'static',
          specs: [{ vendor: 'no-such-vendor', displayName: 'Nope', kinds: ['api_key'] }],
        },
      });
      expect(() => getVendorCatalog()).toThrow(/no-such-vendor/);
    } finally {
      clearRegistry();
      registerBuiltinProviders();
      registerCommunityProviders();
    }
  });

  test('isConnectableVendor accepts legacy ids via normalization', () => {
    expect(isConnectableVendor('claude')).toBe(true);
    expect(isConnectableVendor('codex')).toBe(true);
    expect(isConnectableVendor('copilot')).toBe(true);
    expect(isConnectableVendor('amazon-bedrock')).toBe(false);
    expect(isConnectableVendor('bogus')).toBe(false);
  });

  describe('buildAgentCredentialMatrix', () => {
    test('marks user connections per vendor (legacy rows normalize)', () => {
      const matrix = buildAgentCredentialMatrix([
        { provider: 'claude', kind: 'oauth' },
        { provider: 'openrouter', kind: 'api_key' },
      ]);
      const claude = matrix.find(a => a.id === 'claude')!;
      expect(claude.catalog).toBe('static');
      expect(claude.credentials[0]!.vendor).toBe('anthropic');
      expect(claude.credentials[0]!.connected).toBe('oauth');
      expect(claude.ready).toBe(true);

      const pi = matrix.find(a => a.id === 'pi')!;
      expect(pi.credentials.find(s => s.vendor === 'openrouter')!.connected).toBe('api_key');
      expect(pi.credentials.find(s => s.vendor === 'anthropic')!.connected).toBe('oauth');
      expect(pi.ready).toBe(true);
    });

    test('subscriptionAvailable: all three subscription vendors connectable (#1924 gate lifted)', () => {
      const matrix = buildAgentCredentialMatrix([]);
      const codex = matrix.find(a => a.id === 'codex')!;
      expect(codex.credentials[0]!.vendor).toBe('openai');
      expect(codex.credentials[0]!.subscriptionAvailable).toBe(true);
      const claude = matrix.find(a => a.id === 'claude')!;
      expect(claude.credentials[0]!.subscriptionAvailable).toBe(true);
      const copilot = matrix.find(a => a.id === 'copilot')!;
      expect(copilot.credentials[0]!.subscriptionAvailable).toBe(true);
    });

    test('cursor is API-key only: install env or a stored key is ready, OAuth is not', () => {
      delete process.env.CURSOR_API_KEY;
      let cursor = buildAgentCredentialMatrix([]).find(a => a.id === 'cursor');
      expect(cursor).toBeDefined();
      if (!cursor) throw new Error('cursor agent missing from credential matrix');
      expect(cursor.credentials).toEqual([
        {
          vendor: 'cursor',
          displayName: 'Cursor',
          kinds: ['api_key'],
          connected: null,
          subscriptionAvailable: false,
          installEnv: false,
        },
      ]);
      expect(cursor.ready).toBe(false);

      process.env.CURSOR_API_KEY = 'cursor-install-key';
      cursor = buildAgentCredentialMatrix([]).find(a => a.id === 'cursor');
      if (!cursor) throw new Error('cursor agent missing from credential matrix');
      expect(cursor.credentials[0]?.installEnv).toBe(true);
      expect(cursor.credentials[0]?.subscriptionAvailable).toBe(false);
      expect(cursor.ready).toBe(true);

      delete process.env.CURSOR_API_KEY;
      cursor = buildAgentCredentialMatrix([{ provider: 'cursor', kind: 'api_key' }]).find(
        a => a.id === 'cursor'
      );
      if (!cursor) throw new Error('cursor agent missing from credential matrix');
      expect(cursor.credentials[0]?.connected).toBe('api_key');
      expect(cursor.credentials[0]?.installEnv).toBe(false);
      expect(cursor.credentials[0]?.subscriptionAvailable).toBe(false);
      expect(cursor.ready).toBe(true);
    });

    test('install-env detection feeds readiness without any stored connection', () => {
      delete process.env.OPENROUTER_API_KEY;
      let matrix = buildAgentCredentialMatrix([]);
      let pi = matrix.find(a => a.id === 'pi')!;
      const before = pi.credentials.find(s => s.vendor === 'openrouter')!;
      expect(before.installEnv).toBe(false);

      process.env.OPENROUTER_API_KEY = 'sk-or-env';
      matrix = buildAgentCredentialMatrix([]);
      pi = matrix.find(a => a.id === 'pi')!;
      const after = pi.credentials.find(s => s.vendor === 'openrouter')!;
      expect(after.installEnv).toBe(true);
      expect(pi.ready).toBe(true);
    });

    test('ambient detection reports amazon-bedrock from the AWS env chain', () => {
      delete process.env.AWS_PROFILE;
      let matrix = buildAgentCredentialMatrix([]);
      let bedrock = matrix
        .find(a => a.id === 'pi')!
        .credentials.find(s => s.vendor === 'amazon-bedrock')!;
      expect(bedrock.ambientConfigured).toBe(false);

      process.env.AWS_PROFILE = 'test-profile';
      matrix = buildAgentCredentialMatrix([]);
      bedrock = matrix
        .find(a => a.id === 'pi')!
        .credentials.find(s => s.vendor === 'amazon-bedrock')!;
      expect(bedrock.ambientConfigured).toBe(true);
    });

    test('ambient detection reports devin from the local CLI plus shared login', () => {
      const dir = mkdtempSync(join(tmpdir(), 'archon-devin-catalog-'));
      const fakeBin = join(dir, 'devin');
      writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n');
      if (process.platform !== 'win32') chmodSync(fakeBin, 0o755);
      const dataHome = join(dir, 'data');
      mkdirSync(join(dataHome, 'devin'), { recursive: true });
      const saved = { bin: process.env.DEVIN_BIN_PATH, xdg: process.env.XDG_DATA_HOME };
      try {
        process.env.DEVIN_BIN_PATH = fakeBin;
        process.env.XDG_DATA_HOME = dataHome;
        let devin = buildAgentCredentialMatrix([]).find(a => a.id === 'devin')!;
        expect(devin.credentials).toEqual([
          {
            vendor: 'devin',
            displayName: 'Devin',
            kinds: ['ambient'],
            connected: null,
            subscriptionAvailable: false,
            installEnv: false,
            ambientConfigured: false,
          },
        ]);
        expect(devin.ready).toBe(false);

        writeFileSync(join(dataHome, 'devin', 'credentials.toml'), '');
        devin = buildAgentCredentialMatrix([]).find(a => a.id === 'devin')!;
        expect(devin.credentials[0]?.ambientConfigured).toBe(true);
        expect(devin.ready).toBe(true);
      } finally {
        if (saved.bin === undefined) delete process.env.DEVIN_BIN_PATH;
        else process.env.DEVIN_BIN_PATH = saved.bin;
        if (saved.xdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = saved.xdg;
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('opencode is dynamic: empty credentials, never ready from the matrix', () => {
      const matrix = buildAgentCredentialMatrix([{ provider: 'anthropic', kind: 'api_key' }]);
      const opencode = matrix.find(a => a.id === 'opencode')!;
      expect(opencode.catalog).toBe('dynamic');
      expect(opencode.credentials).toEqual([]);
      expect(opencode.ready).toBe(false);
    });
  });
});
