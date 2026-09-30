// spike-omp.mjs [steer|follow_up] [interruptMode|-]: does a message sent while a tool call is in flight reach the
// model inside the SAME agent run (one agent_end) and show up in its final answer? No Stop is used.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const kind = process.argv[2] || 'steer';
const mode = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const bin = process.env.OMP_BIN || '/Users/dale/.bun/bin/omp';
const cwd = mkdtempSync(join(tmpdir(), 'si-omp-'));
execFileSync('git', ['init', '-q'], { cwd });
const marker = 'ACK_' + randomUUID().replaceAll('-', '').slice(0, 10);
const proc = spawn(
  bin,
  ['--mode', 'rpc', '--cwd', cwd, '--yolo', '--no-title', '--no-extensions'],
  { cwd, stdio: ['pipe', 'pipe', 'pipe'] }
);
const ev = {
  kind,
  mode,
  agentStarts: 0,
  agentEnds: 0,
  turnStartsAfterInject: 0,
  toolStarts: 0,
  injectAckSeen: false,
  injectedAtToolStart: null,
  endsAfterInject: 0,
  marker,
  finalHasMarker: false,
  markerInFirstAgentRun: false,
};
let buf = '';
let injected = false;
let finalText = '';
let runTexts = [''];
const send = f => proc.stdin.write(JSON.stringify(f) + '\n');
const done = new Promise(resolve => {
  const timer = setTimeout(() => resolve('timeout'), 165000);
  proc.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let f;
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
      if (f.type === 'extension_ui_request' && typeof f.id === 'string') {
        send({
          type: 'extension_ui_response',
          id: f.id,
          ...(f.method === 'confirm' ? { confirmed: true } : { cancelled: true }),
        });
      }
      if (f.type === 'ready') {
        if (mode) send({ id: 'im', type: 'set_interrupt_mode', mode });
        send({
          id: 'p1',
          type: 'prompt',
          message:
            'Run these Bash steps one at a time, each as its own separate call, waiting for each result: "sleep 8; echo s1", then "sleep 8; echo s2", then "sleep 8; echo s3". After the third, reply with one short line. If you receive an operator message, follow it exactly.',
        });
      }
      if (f.type === 'agent_start') ev.agentStarts += 1;
      if (f.type === 'tool_execution_start') {
        ev.toolStarts += 1;
        if (!injected) {
          injected = true;
          ev.injectedAtToolStart = ev.toolStarts;
          send({
            id: 'inj',
            type: kind,
            message: `Operator message: in your very next message, before any further tool call, write the exact token ${marker}, then carry on with the remaining steps.`,
          });
        }
      }
      if (injected && f.type === 'response' && f.id === 'inj')
        ev.injectAckSeen = f.success === true;
      if (injected && f.type === 'turn_start') ev.turnStartsAfterInject += 1;
      if (f.type === 'message_end' && f.message && f.message.role === 'assistant') {
        const t = JSON.stringify(f.message.content || '');
        if (ev.toolStartsAtFirstMarker === undefined && t.includes(marker))
          ev.toolStartsAtFirstMarker = ev.toolStarts;
        runTexts[runTexts.length - 1] += t;
        finalText = t;
      }
      if (f.type === 'agent_end') {
        ev.agentEnds += 1;
        if (injected) ev.endsAfterInject += 1;
        if (ev.agentEnds === 1) ev.markerInFirstAgentRun = runTexts[0].includes(marker);
        runTexts.push('');
        // steer must land in the first run; follow_up gets a second run - wait for it.
        if (true) {
          clearTimeout(timer);
          ev.finalHasMarker = finalText.includes(marker);
          resolve('ok');
        }
      }
    }
  });
});
const outcome = await done;
ev.outcome = outcome;
ev.toolStartsTotal = ev.toolStarts;
proc.kill();
rmSync(cwd, { recursive: true, force: true });
console.log(JSON.stringify(ev));
process.exit(0);
