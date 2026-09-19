import { describe, test, expect, beforeEach } from 'bun:test';
import {
  getAgentProvider,
  getProviderCapabilities,
  registerProvider,
  getRegistration,
  getRegisteredProviders,
  getProviderInfoList,
  isRegisteredProvider,
  registerBuiltinProviders,
  registerCommunityProviders,
  clearRegistry,
} from './registry';
import { registerPiProvider } from './community/pi/registration';
import { registerCopilotProvider } from './community/copilot/registration';
import { registerOpencodeProvider } from './community/opencode/registration';
import { registerQoderCliProvider } from './community/qodercli/registration';
import { registerOmpProvider } from './community/omp/registration';
import { registerDeepseekProvider } from './community/deepseek/registration';
import { DEEPSEEK_CAPABILITIES } from './community/deepseek/capabilities';
import { registerDevinProvider } from './community/devin/registration';
import { DEVIN_CAPABILITIES } from './community/devin/capabilities';
import { UnknownProviderError } from './errors';
import type { ProviderRegistration, IAgentProvider, ProviderCapabilities } from './types';

/** Minimal mock provider for testing registration. */
function makeMockProvider(id: string): IAgentProvider {
  return {
    getType: () => id,
    getCapabilities: () => ({
      sessionResume: false,
      mcp: false,
      hooks: false,
      skills: false,
      agents: false,
      toolRestrictions: false,
      structuredOutput: false,
      envInjection: false,
      costControl: false,
      effortControl: false,
      thinkingControl: false,
      fallbackModel: false,
      sandbox: false,
      nativeTools: false,
      containerExec: false,
      askHuman: false,
      interrupt: false,
    }),
    async *sendQuery() {
      yield { type: 'result' as const };
    },
  };
}

function makeMockRegistration(
  id: string,
  overrides?: Partial<ProviderRegistration>
): ProviderRegistration {
  return {
    id,
    displayName: `Mock ${id}`,
    factory: () => makeMockProvider(id),
    capabilities: makeMockProvider(id).getCapabilities(),
    builtIn: false,
    credentials: { kind: 'static', specs: [] },
    ...overrides,
  };
}

describe('registry', () => {
  beforeEach(() => {
    clearRegistry();
    registerBuiltinProviders();
  });

  describe('getAgentProvider', () => {
    test('returns ClaudeProvider for claude type', () => {
      const provider = getAgentProvider('claude');

      expect(provider).toBeDefined();
      expect(provider.getType()).toBe('claude');
      expect(typeof provider.sendQuery).toBe('function');
    });

    test('returns CodexProvider for codex type', () => {
      const provider = getAgentProvider('codex');

      expect(provider).toBeDefined();
      expect(provider.getType()).toBe('codex');
      expect(typeof provider.sendQuery).toBe('function');
    });

    test('returns GrokProvider for grok type', () => {
      const provider = getAgentProvider('grok');
      expect(provider.getType()).toBe('grok');
      expect(typeof provider.sendQuery).toBe('function');
    });

    test('throws UnknownProviderError for unknown type', () => {
      expect(() => getAgentProvider('unknown')).toThrow(UnknownProviderError);
      expect(() => getAgentProvider('unknown')).toThrow(
        "Unknown provider: 'unknown'. Available: claude, codex, grok"
      );
    });

    test('throws UnknownProviderError for empty string', () => {
      expect(() => getAgentProvider('')).toThrow(UnknownProviderError);
      expect(() => getAgentProvider('')).toThrow("Unknown provider: ''");
    });

    test('is case sensitive - Claude throws', () => {
      expect(() => getAgentProvider('Claude')).toThrow(UnknownProviderError);
      expect(() => getAgentProvider('Claude')).toThrow("Unknown provider: 'Claude'");
    });

    test('each call returns new instance', () => {
      const provider1 = getAgentProvider('claude');
      const provider2 = getAgentProvider('claude');

      expect(provider1).not.toBe(provider2);
    });

    test('providers expose getCapabilities', () => {
      const claude = getAgentProvider('claude');
      const codex = getAgentProvider('codex');

      expect(typeof claude.getCapabilities).toBe('function');
      expect(typeof codex.getCapabilities).toBe('function');

      const claudeCaps = claude.getCapabilities();
      const codexCaps = codex.getCapabilities();

      expect(claudeCaps.mcp).toBe(true);
      expect(codexCaps.mcp).toBe(true);
      expect(claudeCaps.hooks).toBe(true);
      expect(codexCaps.hooks).toBe(false);
    });
  });

  describe('getProviderCapabilities', () => {
    test('returns Claude capabilities without instantiation', () => {
      const caps = getProviderCapabilities('claude');
      expect(caps.mcp).toBe(true);
      expect(caps.hooks).toBe(true);
      expect(caps.envInjection).toBe(true);
      expect(caps.askHuman).toBe(true);
    });

    test('returns Codex capabilities without instantiation', () => {
      const caps = getProviderCapabilities('codex');
      expect(caps.mcp).toBe(true);
      expect(caps.hooks).toBe(false);
      expect(caps.envInjection).toBe(true);
    });

    test('returns Grok capabilities without instantiation', () => {
      expect(getProviderCapabilities('grok')).toMatchObject({
        sessionResume: true,
        agents: true,
        toolRestrictions: true,
        structuredOutput: 'enforced',
        envInjection: true,
        effortControl: true,
        mcp: false,
        nativeTools: false,
      });
    });

    test('matches runtime getCapabilities for Claude', () => {
      const staticCaps = getProviderCapabilities('claude');
      const runtimeCaps = getAgentProvider('claude').getCapabilities();
      expect(staticCaps).toEqual(runtimeCaps);
    });

    test('matches runtime getCapabilities for Codex', () => {
      const staticCaps = getProviderCapabilities('codex');
      const runtimeCaps = getAgentProvider('codex').getCapabilities();
      expect(staticCaps).toEqual(runtimeCaps);
    });

    test('only Claude, Devin, and Pi advertise AskHuman', () => {
      registerCommunityProviders();
      const capable = getProviderInfoList()
        .filter(info => info.capabilities.askHuman)
        .map(info => info.id)
        .sort();
      expect(capable).toEqual(['claude', 'devin', 'pi']);
    });

    test('every registered provider declares a total interrupt axis value', () => {
      registerCommunityProviders();
      for (const info of getProviderInfoList()) {
        expect(['native', 'stream-abort', false]).toContainEqual(info.capabilities.interrupt);
      }
    });

    test('only Claude advertises native interrupt', () => {
      registerCommunityProviders();
      const capable = getProviderInfoList()
        .filter(info => info.capabilities.interrupt === 'native')
        .map(info => info.id)
        .sort();
      // e2e-fake stays unregistered here (ARCHON_E2E_FAKE_PROVIDER unset).
      expect(capable).toEqual(['claude']);
    });

    test('throws UnknownProviderError for unknown type', () => {
      expect(() => getProviderCapabilities('unknown')).toThrow(UnknownProviderError);
    });

    test('throws UnknownProviderError for empty string', () => {
      expect(() => getProviderCapabilities('')).toThrow(UnknownProviderError);
    });

    test('is case sensitive - Claude throws', () => {
      expect(() => getProviderCapabilities('Claude')).toThrow(UnknownProviderError);
    });
  });

  describe('registerProvider', () => {
    test('registers a new provider', () => {
      const entry = makeMockRegistration('my-llm');
      registerProvider(entry);

      expect(isRegisteredProvider('my-llm')).toBe(true);
      const provider = getAgentProvider('my-llm');
      expect(provider.getType()).toBe('my-llm');
    });

    test('throws on duplicate registration', () => {
      expect(() => registerProvider(makeMockRegistration('claude'))).toThrow(
        "Provider 'claude' is already registered"
      );
    });
  });

  describe('getRegistration', () => {
    test('returns full registration entry', () => {
      const reg = getRegistration('claude');
      expect(reg.id).toBe('claude');
      expect(reg.displayName).toBe('Claude (Anthropic)');
      expect(reg.builtIn).toBe(true);
      expect(typeof reg.factory).toBe('function');
    });

    test('throws for unknown provider', () => {
      expect(() => getRegistration('nope')).toThrow(UnknownProviderError);
    });
  });

  describe('getRegisteredProviders', () => {
    test('returns all registered providers', () => {
      const all = getRegisteredProviders();
      expect(all.length).toBe(3);
      const ids = all.map(r => r.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('grok');
    });

    test('includes community providers after registration', () => {
      registerProvider(makeMockRegistration('my-llm'));
      const all = getRegisteredProviders();
      expect(all.length).toBe(4);
    });
  });

  describe('getProviderInfoList', () => {
    test('returns API-safe projection without factory', () => {
      const infos = getProviderInfoList();
      expect(infos.length).toBe(3);
      for (const info of infos) {
        expect(info).toHaveProperty('id');
        expect(info).toHaveProperty('displayName');
        expect(info).toHaveProperty('capabilities');
        expect(info).toHaveProperty('builtIn');
        expect(info).not.toHaveProperty('factory');
        expect(info).not.toHaveProperty('isModelCompatible');
      }
    });
  });

  describe('isRegisteredProvider', () => {
    test('returns true for registered providers', () => {
      expect(isRegisteredProvider('claude')).toBe(true);
      expect(isRegisteredProvider('codex')).toBe(true);
      expect(isRegisteredProvider('grok')).toBe(true);
    });

    test('returns false for unknown providers', () => {
      expect(isRegisteredProvider('unknown')).toBe(false);
      expect(isRegisteredProvider('')).toBe(false);
    });
  });

  describe('registerBuiltinProviders', () => {
    test('is idempotent', () => {
      registerBuiltinProviders();
      registerBuiltinProviders();
      const all = getRegisteredProviders();
      expect(all.length).toBe(3);
    });

    test('registers Grok as built-in with xAI API-key delivery', () => {
      expect(getRegistration('grok')).toMatchObject({
        displayName: 'Grok (xAI)',
        builtIn: true,
        credentials: {
          kind: 'static',
          specs: [{ vendor: 'xai', displayName: 'xAI', kinds: ['api_key'] }],
        },
      });
    });
  });

  describe('clearRegistry', () => {
    test('empties the registry', () => {
      clearRegistry();
      expect(getRegisteredProviders()).toEqual([]);
      expect(isRegisteredProvider('claude')).toBe(false);
    });
  });

  describe('registerCommunityProviders (aggregator)', () => {
    test('registers all bundled community providers', () => {
      registerCommunityProviders();
      expect(isRegisteredProvider('opencode')).toBe(true);
      expect(isRegisteredProvider('pi')).toBe(true);
      expect(isRegisteredProvider('copilot')).toBe(true);
      expect(isRegisteredProvider('qodercli')).toBe(true);
      expect(isRegisteredProvider('omp')).toBe(true);
      expect(isRegisteredProvider('deepseek')).toBe(true);
    });

    test('is idempotent', () => {
      registerCommunityProviders();
      expect(() => registerCommunityProviders()).not.toThrow();
      const opencodeCount = getRegisteredProviders().filter(p => p.id === 'opencode').length;
      const piCount = getRegisteredProviders().filter(p => p.id === 'pi').length;
      const copilotCount = getRegisteredProviders().filter(p => p.id === 'copilot').length;
      const qoderCliCount = getRegisteredProviders().filter(p => p.id === 'qodercli').length;
      const ompCount = getRegisteredProviders().filter(p => p.id === 'omp').length;
      const deepseekCount = getRegisteredProviders().filter(p => p.id === 'deepseek').length;
      expect(opencodeCount).toBe(1);
      expect(piCount).toBe(1);
      expect(copilotCount).toBe(1);
      expect(qoderCliCount).toBe(1);
      expect(ompCount).toBe(1);
      expect(deepseekCount).toBe(1);
    });
  });

  describe('registerPiProvider (community provider)', () => {
    test('registers pi with builtIn: false', () => {
      registerPiProvider();
      const reg = getRegistration('pi');
      expect(reg.id).toBe('pi');
      expect(reg.displayName).toBe('Pi (community)');
      expect(reg.builtIn).toBe(false);
    });

    test('is idempotent', () => {
      registerPiProvider();
      expect(() => registerPiProvider()).not.toThrow();
      const piEntries = getRegisteredProviders().filter(p => p.id === 'pi');
      expect(piEntries).toHaveLength(1);
    });

    test('declares v2 capabilities (thinking, effort, tools, skills, sessionResume, envInjection, structuredOutput supported)', () => {
      registerPiProvider();
      const caps = getProviderCapabilities('pi');
      // Flipped true in v2
      expect(caps.thinkingControl).toBe(true);
      expect(caps.effortControl).toBe(true);
      expect(caps.toolRestrictions).toBe(true);
      expect(caps.skills).toBe(true);
      expect(caps.sessionResume).toBe(true);
      expect(caps.envInjection).toBe(true);
      // Best-effort structured output via prompt engineering + post-parse —
      // not SDK-enforced like Claude/Codex, but wired up and tested.
      expect(caps.structuredOutput).toBe('best-effort');
      // Still false (out of v2 scope)
      expect(caps.mcp).toBe(false);
      expect(caps.hooks).toBe(false);
      expect(caps.costControl).toBe(false);
      expect(caps.fallbackModel).toBe(false);
      expect(caps.sandbox).toBe(false);
      expect(caps.askHuman).toBe(true);
    });

    test('appears in getProviderInfoList with builtIn: false', () => {
      registerPiProvider();
      const info = getProviderInfoList().find(p => p.id === 'pi');
      expect(info).toBeDefined();
      expect(info?.builtIn).toBe(false);
    });

    test('does not collide with built-ins', () => {
      // beforeEach already called registerBuiltinProviders + clearRegistry reset
      registerPiProvider();
      const ids = getRegisteredProviders()
        .map(p => p.id)
        .sort();
      expect(ids).toEqual(['claude', 'codex', 'grok', 'pi']);
    });
  });

  describe('registerOpencodeProvider (community provider)', () => {
    test('registers opencode with builtIn: false', () => {
      registerOpencodeProvider();
      const reg = getRegistration('opencode');
      expect(reg.id).toBe('opencode');
      expect(reg.displayName).toBe('OpenCode (community)');
      expect(reg.builtIn).toBe(false);
    });

    test('is idempotent', () => {
      registerOpencodeProvider();
      expect(() => registerOpencodeProvider()).not.toThrow();
      const opencodeEntries = getRegisteredProviders().filter(p => p.id === 'opencode');
      expect(opencodeEntries).toHaveLength(1);
    });

    test('declares capabilities (sessionResume, structuredOutput, envInjection, agents, and toolRestrictions supported; untranslated node fields stay off)', () => {
      registerOpencodeProvider();
      const caps = getProviderCapabilities('opencode');
      expect(caps.sessionResume).toBe(true);
      expect(caps.mcp).toBe(false);
      expect(caps.structuredOutput).toBe('enforced');
      expect(caps.envInjection).toBe(true);
      expect(caps.hooks).toBe(false);
      expect(caps.skills).toBe(false);
      expect(caps.agents).toBe(true);
      expect(caps.toolRestrictions).toBe(true);
      expect(caps.effortControl).toBe(false);
      expect(caps.thinkingControl).toBe(false);
      expect(caps.costControl).toBe(false);
      expect(caps.fallbackModel).toBe(false);
      expect(caps.sandbox).toBe(false);
    });

    test('appears in getProviderInfoList with builtIn: false', () => {
      registerOpencodeProvider();
      const info = getProviderInfoList().find(p => p.id === 'opencode');
      expect(info).toBeDefined();
      expect(info?.builtIn).toBe(false);
    });

    test('does not collide with built-ins or other community providers', () => {
      registerOpencodeProvider();
      registerPiProvider();
      const ids = getRegisteredProviders()
        .map(p => p.id)
        .sort();
      expect(ids).toEqual(['claude', 'codex', 'grok', 'opencode', 'pi']);
    });
  });

  describe('registerCopilotProvider (community provider)', () => {
    test('registers copilot with builtIn: false', () => {
      registerCopilotProvider();
      const reg = getRegistration('copilot');
      expect(reg.id).toBe('copilot');
      expect(reg.displayName).toBe('Copilot (GitHub)');
      expect(reg.builtIn).toBe(false);
    });

    test('is idempotent', () => {
      registerCopilotProvider();
      expect(() => registerCopilotProvider()).not.toThrow();
      const entries = getRegisteredProviders().filter(p => p.id === 'copilot');
      expect(entries).toHaveLength(1);
    });

    test('declares conservative capabilities', () => {
      registerCopilotProvider();
      const caps = getProviderCapabilities('copilot');
      expect(caps.sessionResume).toBe(true);
      expect(caps.envInjection).toBe(true);
      expect(caps.effortControl).toBe(true);
      expect(caps.thinkingControl).toBe(true);
      expect(caps.mcp).toBe(true);
      expect(caps.hooks).toBe(false);
      expect(caps.skills).toBe(true);
      expect(caps.toolRestrictions).toBe(true);
      expect(caps.structuredOutput).toBe('best-effort');
      expect(caps.agents).toBe(true);
      expect(caps.fallbackModel).toBe(false);
      expect(caps.sandbox).toBe(false);
    });

    test('appears in getProviderInfoList with builtIn: false', () => {
      registerCopilotProvider();
      const info = getProviderInfoList().find(p => p.id === 'copilot');
      expect(info).toBeDefined();
      expect(info?.builtIn).toBe(false);
    });

    test('does not collide with built-ins', () => {
      registerCopilotProvider();
      const ids = getRegisteredProviders()
        .map(p => p.id)
        .sort();
      expect(ids).toEqual(['claude', 'codex', 'copilot', 'grok']);
    });
  });

  describe('registerQoderCliProvider (community provider)', () => {
    test('registers qodercli with builtIn: false', () => {
      registerQoderCliProvider();
      const reg = getRegistration('qodercli');
      expect(reg.id).toBe('qodercli');
      expect(reg.displayName).toBe('Qoder CLI');
      expect(reg.builtIn).toBe(false);
    });

    test('is idempotent', () => {
      registerQoderCliProvider();
      expect(() => registerQoderCliProvider()).not.toThrow();
      const entries = getRegisteredProviders().filter(p => p.id === 'qodercli');
      expect(entries).toHaveLength(1);
    });

    test('declares CLI-backed capabilities', () => {
      registerQoderCliProvider();
      const caps = getProviderCapabilities('qodercli');
      expect(caps.sessionResume).toBe(true);
      expect(caps.mcp).toBe(true);
      expect(caps.envInjection).toBe(true);
      expect(caps.effortControl).toBe(true);
      expect(caps.thinkingControl).toBe(true);
      expect(caps.toolRestrictions).toBe(true);
      expect(caps.structuredOutput).toBe('best-effort');
      expect(caps.hooks).toBe(false);
      expect(caps.skills).toBe(false);
      expect(caps.agents).toBe(false);
      expect(caps.nativeTools).toBe(false);
    });

    test('appears in getProviderInfoList with builtIn: false', () => {
      registerQoderCliProvider();
      const info = getProviderInfoList().find(p => p.id === 'qodercli');
      expect(info).toBeDefined();
      expect(info?.builtIn).toBe(false);
    });

    test('does not collide with built-ins', () => {
      registerQoderCliProvider();
      const ids = getRegisteredProviders()
        .map(p => p.id)
        .sort();
      expect(ids).toEqual(['claude', 'codex', 'grok', 'qodercli']);
    });
  });

  describe('registerOmpProvider (community provider)', () => {
    test('registers OMP with the wired capabilities and no Archon credential catalog', () => {
      registerOmpProvider();
      const registration = getRegistration('omp');
      expect(registration.displayName).toBe('OMP CLI');
      expect(registration.builtIn).toBe(false);
      expect(registration.credentials).toEqual({ kind: 'static', specs: [] });
      expect(getProviderCapabilities('omp')).toMatchObject({
        sessionResume: true,
        skills: true,
        structuredOutput: 'best-effort',
        envInjection: true,
        effortControl: true,
        thinkingControl: true,
        mcp: false,
        hooks: false,
        agents: false,
        toolRestrictions: false,
        nativeTools: false,
        containerExec: false,
      });
    });

    test('is idempotent and does not collide with built-ins', () => {
      registerOmpProvider();
      expect(() => registerOmpProvider()).not.toThrow();
      expect(getRegisteredProviders().filter(provider => provider.id === 'omp')).toHaveLength(1);
    });
  });

  describe('registerDeepseekProvider (community provider)', () => {
    test('registers deepseek with community metadata, credentials, and capabilities', () => {
      registerDeepseekProvider();
      expect(getRegistration('deepseek')).toMatchObject({
        id: 'deepseek',
        displayName: 'DeepSeek Harness (community)',
        builtIn: false,
        credentials: {
          kind: 'static',
          specs: [{ vendor: 'deepseek', displayName: 'DeepSeek', kinds: ['api_key'] }],
        },
      });
      expect(getProviderCapabilities('deepseek')).toEqual(DEEPSEEK_CAPABILITIES);
    });

    test('is idempotent', () => {
      registerDeepseekProvider();
      expect(() => registerDeepseekProvider()).not.toThrow();
      expect(getRegisteredProviders().filter(provider => provider.id === 'deepseek')).toHaveLength(
        1
      );
    });
  });

  describe('registerDevinProvider (community provider)', () => {
    test('registers devin with community metadata, an ambient-only credential, and capabilities', () => {
      registerDevinProvider();
      expect(getRegistration('devin')).toMatchObject({
        id: 'devin',
        displayName: 'Devin CLI (community)',
        builtIn: false,
        credentials: {
          kind: 'static',
          specs: [{ vendor: 'devin', displayName: 'Devin', kinds: ['ambient'] }],
        },
      });
      expect(getProviderCapabilities('devin')).toEqual(DEVIN_CAPABILITIES);
    });

    test('is idempotent and part of registerCommunityProviders', () => {
      registerDevinProvider();
      expect(() => registerDevinProvider()).not.toThrow();
      clearRegistry();
      registerCommunityProviders();
      expect(getRegisteredProviders().filter(provider => provider.id === 'devin')).toHaveLength(1);
    });
  });
});
