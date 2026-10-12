import { describe, expect, test } from 'bun:test';

import { CHAT_COMMANDS, commandPrefill, composerSuggestions } from './chat-commands';

describe('commandPrefill', () => {
  test('stops before the first placeholder', () => {
    expect(commandPrefill('/workflow run <name> <input>')).toBe('/workflow run ');
    expect(commandPrefill('/workflow cancel <run id>')).toBe('/workflow cancel ');
  });

  test('keeps a command without placeholders whole', () => {
    expect(commandPrefill('/status')).toBe('/status');
  });

  test('every listed command uses a real command spelling', () => {
    for (const command of CHAT_COMMANDS) expect(command.template.startsWith('/')).toBe(true);
  });
});

describe('composerSuggestions', () => {
  test('leads with the first recommended workflow when there is one', () => {
    expect(composerSuggestions('archon-review')).toEqual([
      '/workflow run archon-review ',
      '/status',
      '/workflow list',
    ]);
    expect(composerSuggestions(undefined)).toEqual(['/status', '/workflow list']);
  });
});
