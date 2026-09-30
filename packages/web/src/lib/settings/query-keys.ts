/**
 * TanStack Query keys for the settings page. `config`, `providers`, `health`,
 * `codebases` and `github-connection` match the keys other pages already use, so
 * one fetch serves every consumer.
 */
export const settingsKeys = {
  config: ['config'] as const,
  health: ['health'] as const,
  providers: ['providers'] as const,
  codebases: ['codebases'] as const,
  githubConnection: ['github-connection'] as const,
  providerConnections: ['provider-connections'] as const,
  userAiPrefs: ['user-ai-prefs'] as const,
  piModels: ['pi-models'] as const,
  usage: (queryString: string) => ['usage', queryString] as const,
};
