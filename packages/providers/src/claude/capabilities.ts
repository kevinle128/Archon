import type { ProviderCapabilities } from '../types';

/**
 * Built-in Claude Code tool names, hand-audited against
 * @anthropic-ai/claude-agent-sdk 0.3.209. The SDK exposes tool restrictions as
 * plain `string[]` options and exports NO runtime tool-name constant or
 * literal union, so this list is maintained by hand — refresh it when bumping
 * the SDK. Used for advisory (warning-level) validation only, so a tool added
 * by a newer SDK before this list is refreshed can never break a workflow.
 */
const CLAUDE_KNOWN_TOOL_NAMES = [
  'Agent',
  'AskUserQuestion',
  'Bash',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'ListMcpResourcesTool',
  'NotebookEdit',
  'PowerShell',
  'Read',
  'ReadMcpResourceTool',
  'Skill',
  'SlashCommand',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const;

/**
 * Tools the SDK renamed — a stale old name in allowed_tools/denied_tools is a
 * silent no-op at runtime (the trigger for #2084: `denied_tools: [Task]`
 * denied nothing after the 0.3.193 Task → Agent rename).
 */
const CLAUDE_RENAMED_TOOLS = {
  Task: 'Agent',
  BashOutput: 'TaskOutput',
  KillShell: 'TaskStop',
  MultiEdit: 'Edit',
} as const;

export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  sessionResume: true,
  mcp: true,
  hooks: true,
  skills: true,
  agents: true,
  toolRestrictions: true,
  knownToolNames: CLAUDE_KNOWN_TOOL_NAMES,
  renamedTools: CLAUDE_RENAMED_TOOLS,
  structuredOutput: 'enforced', // SDK output_config.format grammar-constrains decoding
  envInjection: true,
  costControl: true,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: true,
  sandbox: true,
  settingSources: true, // per-node override of the SDK's settingSources option
  nativeTools: true,
  containerExec: true, // spawns the CLI in-container via spawnClaudeCodeProcess
  askHuman: true,
  interrupt: 'native', // Query.interrupt() over streaming input
  // Verified false against the real SDK (spike:softinject:claude, 0.3.209):
  // Query.streamInput() delivers a pushed message only as a NEW queued turn
  // (a second `result` event), never into the turn already streaming — the
  // Anthropic API has no primitive to alter an in-flight completion. Holds
  // for both a mid-token-stream push and a push at a between-tool-calls
  // boundary. Confirmed unchanged in the sdk.d.ts shipped with 0.3.283.
  softInjection: false,
  // Verified false against the real SDK: no output message ever echoed the
  // caller-stamped uuid, on any provider message type, in either scenario
  // above. `UserPromptSubmitHookInput` (a candidate boundary-delivery ack
  // path) carries no field an adapter could correlate back to the stamped
  // id — only an SDK-internal `prompt_id` unrelated to it.
  deliveryAck: false,
};
