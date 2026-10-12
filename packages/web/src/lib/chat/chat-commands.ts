/**
 * Slash commands the chat panel offers. These are display templates only: a click
 * fills the composer with the command text, and the orchestrator reads the message
 * as typed. The client never parses what the operator sends.
 */
export interface ChatCommand {
  /** Command as typed, with `<placeholders>` for the parts the operator fills in. */
  template: string;
  description: string;
}

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  { template: '/workflow run <name> <input>', description: 'Start a workflow' },
  { template: '/status', description: 'Runs in this project' },
  { template: '/workflow list', description: 'List available workflows' },
  { template: '/workflow cancel <run id>', description: 'Cancel a run' },
];

/** Text a command click puts in the composer: the template up to its first placeholder. */
export function commandPrefill(template: string): string {
  const placeholder = template.indexOf('<');
  return placeholder === -1 ? template : template.slice(0, placeholder);
}

/** Composer chips: start the first recommended workflow, then status and list. */
export function composerSuggestions(firstWorkflow: string | undefined): string[] {
  return [
    ...(firstWorkflow !== undefined ? [`/workflow run ${firstWorkflow} `] : []),
    '/status',
    '/workflow list',
  ];
}
