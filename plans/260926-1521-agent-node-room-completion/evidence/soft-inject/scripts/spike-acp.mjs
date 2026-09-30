// spike-acp.mjs: does a message sent through a vendor ACP method while a tool call is in flight reach the model
// inside the SAME session/prompt turn (one prompt response) and show up in its final answer? No cancel is used.
//   ACP_CMD='["/path/bin","arg",...]' ACP_METHOD='_x.ai/interject' ACP_PARAMS_KEY=text node spike-acp.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const cmd = JSON.parse(process.env.ACP_CMD);
const method = process.env.ACP_METHOD || '_x.ai/interject';
const key = process.env.ACP_PARAMS_KEY || 'text';
const cwd = mkdtempSync(join(tmpdir(), 'si-acp-'));
execFileSync('git', ['init', '-q'], { cwd });
const marker = 'ACK_' + randomUUID().replaceAll('-', '').slice(0, 10);
const proc = spawn(cmd[0], cmd.slice(1), {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});
let stderr = '';
proc.stderr.on('data', d => (stderr += d));
let nextId = 1;
const pending = new Map();
let buf = '';
const ev = {
  method,
  toolCalls: 0,
  injectedAtToolCall: null,
  injectResult: null,
  injectError: null,
  promptResponses: 0,
  stopReason: null,
  agentText: '',
  userEchoes: [],
  updateKinds: {},
  marker,
};
const write = o => proc.stdin.write(JSON.stringify(o) + '\n');
const request = (m, params, ms = 30000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`timeout ${m}`)), ms);
    pending.set(id, msg => {
      clearTimeout(t);
      resolve(msg);
    });
    write({ jsonrpc: '2.0', id, method: m, params });
  });
let sessionId = null;
let injected = false;
proc.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && msg.method === undefined && pending.has(msg.id)) {
      const cb = pending.get(msg.id);
      pending.delete(msg.id);
      cb(msg);
      continue;
    }
    if (msg.id !== undefined && msg.method === 'session/request_permission') {
      const opts = (msg.params && msg.params.options) || [];
      const allow =
        opts.find(o => o.kind === 'allow_always') ||
        opts.find(o => (o.kind || '').startsWith('allow')) ||
        opts[0];
      write({
        jsonrpc: '2.0',
        id: msg.id,
        result: allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      });
      continue;
    }
    if (msg.id !== undefined && msg.method) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      continue;
    }
    if (msg.method === 'session/update') {
      const u = msg.params && msg.params.update;
      const kind = u && u.sessionUpdate;
      ev.updateKinds[kind] = (ev.updateKinds[kind] || 0) + 1;
      if (kind === 'tool_call') {
        ev.toolCalls += 1;
        if (!injected && sessionId) {
          injected = true;
          ev.injectedAtToolCall = ev.toolCalls;
          const text = `Operator message: in your very next message, before any further tool call, write the exact token ${marker}, then carry on with the remaining steps.`;
          const params =
            method === 'session/prompt'
              ? { sessionId, prompt: [{ type: 'text', text }] }
              : { sessionId, [key]: text };
          request(method, params, 150000)
            .then(r => {
              ev.injectSettledAfterFirstPrompt = ev.promptResponses >= 1;
              ev.injectResult = r.error ? null : JSON.stringify(r.result).slice(0, 120);
              ev.injectError = r.error ? JSON.stringify(r.error).slice(0, 200) : null;
            })
            .catch(e => {
              ev.injectError = String(e);
            });
        }
      }
      if (kind === 'agent_message_chunk' && u.content && u.content.text) {
        ev.agentText += u.content.text;
        if (ev.toolCallsAtFirstMarker === undefined && ev.agentText.includes(marker))
          ev.toolCallsAtFirstMarker = ev.toolCalls;
      }
      if (kind === 'user_message_chunk' && u.content)
        ev.userEchoes.push(String(u.content.text || '').slice(0, 60));
    }
  }
});
let outcome = 'ok';
try {
  const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  ev.agentCaps = JSON.stringify(init.result && init.result.agentCapabilities).slice(0, 400);
  const s = await request('session/new', { cwd, mcpServers: [] });
  sessionId = s.result && s.result.sessionId;
  if (!sessionId) throw new Error('no session ' + JSON.stringify(s.error));
  if (process.env.ACP_MODEL) {
    const m = await request('session/set_config_option', {
      sessionId,
      configId: 'model',
      value: process.env.ACP_MODEL,
    });
    ev.setModel = m.error ? JSON.stringify(m.error).slice(0, 160) : 'ok';
  }
  const r = await request(
    'session/prompt',
    {
      sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Run these shell steps one at a time, each as its own separate tool call, waiting for each result: "sleep 8; echo s1", then "sleep 8; echo s2", then "sleep 8; echo s3". After the third, reply with one short line. If you receive an operator message, follow it exactly.',
        },
      ],
    },
    150000
  );
  ev.promptResponses += 1;
  ev.stopReason = r.result && r.result.stopReason;
} catch (e) {
  outcome = String(e);
}
await new Promise(r => setTimeout(r, 1500));
ev.finalHasMarker = ev.agentText.includes(marker);
ev.toolCallsTotal = ev.toolCalls;
ev.agentText = ev.agentText.slice(-160);
ev.outcome = outcome;
ev.stderrTail = stderr.slice(-200);
proc.kill();
rmSync(cwd, { recursive: true, force: true });
console.log(JSON.stringify(ev));
process.exit(0);
