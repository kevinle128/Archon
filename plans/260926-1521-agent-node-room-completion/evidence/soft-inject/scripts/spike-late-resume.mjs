// spike-late-resume.mjs: inject while the model writes its final message, close the input at the first result
// (what the provider does), then resume the same session with a plain prompt. Does the resume complete?
import { query } from '/Users/dale/orca/Archon/.claude/worktrees/agent-a4b1bef9c53f33b3c/node_modules/.bun/@anthropic-ai+claude-agent-sdk@0.3.209+4b8d4561844a275b/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const cwd = mkdtempSync(join(tmpdir(), 'si-late-'));
const mode = process.argv[2] || 'close'; // close | wait
const queue = [];
let wake;
let closed = false;
async function* input() {
  for (;;) {
    while (queue.length) yield queue.shift();
    if (closed) return;
    await new Promise(r => (wake = r));
  }
}
const push = m => {
  queue.push(m);
  wake?.();
};
const msg = (text, uuid) => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  ...(uuid ? { uuid } : {}),
});
push(
  msg(
    'Run exactly one Bash call: "sleep 3; echo s1". Then write a paragraph of about six sentences about sleeping.'
  )
);
const options = {
  cwd,
  model: 'haiku',
  settingSources: [],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  extraArgs: { 'replay-user-messages': null },
};
const q = query({ prompt: input(), options });
let sessionId = null,
  injected = false,
  sawTool = false,
  results = 0,
  echoed = false;
const id = randomUUID();
for await (const m of q) {
  if (m.session_id) sessionId = m.session_id;
  if (m.type === 'user' && !m.isReplay && JSON.stringify(m.message).includes('tool_result'))
    sawTool = true;
  if (sawTool && !injected && m.type === 'stream_event') {
    injected = true;
    push(msg('Begin your reply with LATEOK.', id));
  }
  if (m.type === 'user' && m.isReplay && m.uuid === id) echoed = true;
  if (m.type === 'result') {
    results += 1;
    if (mode === 'close' || results >= 2) {
      closed = true;
      wake?.();
      break;
    }
    if (mode === 'wait' && results === 1) {
      closed = true;
      wake?.();
    }
  }
}
try {
  q.close();
} catch {}
console.log(
  JSON.stringify({ phase: 'turn1', injected, echoedBeforeBreak: echoed, results, sessionId })
);
const t0 = Date.now();
const q2 = query({
  prompt: 'Reply with exactly PONG.',
  options: { ...options, resume: sessionId, extraArgs: undefined },
});
let got = 'timeout';
const timer = setTimeout(() => {
  try {
    q2.close();
  } catch {}
}, 60000);
for await (const m of q2) {
  if (m.type === 'result') {
    got = m.subtype;
    break;
  }
}
clearTimeout(timer);
try {
  q2.close();
} catch {}
console.log(JSON.stringify({ phase: 'resume', result: got, ms: Date.now() - t0 }));
process.exit(0);
