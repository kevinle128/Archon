#!/bin/bash
# b2.sh : real-provider outage on 3425. Four runs, each Stopped with one queued item: Claude prompt (auto-send on + an unsent
# draft), Claude haiku loop at iteration 2, OMP, Codex. One survivor tab per shell per run (own contexts). kill -9 the real
# server by its recorded PID, restart after 31 s. Then: survivor frames, 8 cold loads, recovery reads (409s, draft, auto-send),
# recovered Abandons seen by survivor + fresh tabs.
cd "$(dirname "$0")"; . ./common.sh
F=$(./dispatch.sh 3425 vq15-claude-steer "B2F run"); L=$(./dispatch.sh 3425 vq15-haiku-loop "B2L run"); O=$(./dispatch.sh 3425 vq15-omp "B2O run"); X=$(./dispatch.sh 3425 vq15-codex "B2X run")
echo "$F $L $O $X" > B2.runs; echo runs $F $L $O $X
drv <<JS
$LOAD
if (!G.svOpen) await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../outage.js','utf8')))(G);
const prep = async (R, N, tag, extra) => {
  await G.open('c', R, N); await G.open('l', R, N);
  await G.toolRunning('c', 170000);
  if (extra) await extra(R, N);
  await G.queue('c', tag + '-Q1 queued before the outage'); await G.wait(800);
  await G.stopTimed('l'); await G.until('c', x => /Send now/.test(x.btns), 30000);
};
await prep('$F', 'cl-node', 'B2F', async (R, N) => { await G.api('/api/workflows/runs/' + R + '/nodes/' + N + '/auto-send', { method: 'PUT', body: JSON.stringify({ enabled: true }) }); });
await G.field('l').fill('B2F draft typed before restart'); await G.wait(2500);
return 'F ok';
JS
echo
drv <<JS
$LOAD
// loop: wait for iteration 2 before stopping
await G.open('c','$L','haiku-loop'); await G.open('l','$L','haiku-loop');
const t0 = Date.now(); while (Date.now() - t0 < 170000) { const t = await G.roomText('c'); if (/Iteration 2/.test(t) && /◐/.test(t)) break; await G.wait(1000); }
await G.queue('c', 'B2L-Q1 queued before the outage'); await G.wait(800); await G.stopTimed('l'); await G.until('c', x => /Send now/.test(x.btns), 30000);
return 'L ok ' + (await G.roomText('c')).match(/Iteration \d+[^\n]*/);
JS
echo
for P in "$O omp-node B2O" "$X codex-node B2X"; do set -- $P
drv <<JS
$LOAD
await G.open('c','$1','$2'); await G.open('l','$1','$2');
await G.toolRunning('c', 170000);
await G.queue('c', '$3-Q1 queued before the outage'); await G.wait(800); await G.stopTimed('l'); await G.until('c', x => /Send now/.test(x.btns), 30000);
return '$3 ok';
JS
echo
done
drv <<JS
$LOAD
await G.svClose();
for (const [k, R, N] of [['F','$F','cl-node'],['L','$L','haiku-loop'],['O','$O','omp-node'],['X','$X','codex-node']]) { await G.svOpen(k + 'c', 'c', R, N); await G.svOpen(k + 'l', 'l', R, N); }
await G.wait(1500); await G.svArm(90000);
const k = {}; for (const x of Object.keys(G.sv)) k[x] = await G.svKey(x);
return JSON.stringify(k);
JS
echo
python3 reap.py $(cat real.pid) 1 data/B2-prekill-tree.json
sleep 2; PID=$(cat real.pid); KILL=$(./ms.sh); kill -9 $PID; echo "killed real $PID at $KILL" | tee -a outages.log
sleep 31; ./start-real.sh
until curl -sf localhost:3425/api/health > /dev/null; do sleep 0.05; done; UP=$(./ms.sh); echo "up real $(cat real.pid) at $UP" | tee -a outages.log
sleep 14
drv <<JS
$LOAD
const tabs = await G.svCollect();
for (const k of Object.keys(G.sv)) await G.svShot('B2', k);
G.fs.writeFileSync(G.S + '/B2-outage.json', JSON.stringify({ tag: 'B2', kill: $KILL, up: $UP, downMs: $UP - $KILL, tabs }) + '\n');
const cold = {};
for (const [k, R, N] of [['F','$F','cl-node'],['L','$L','haiku-loop'],['O','$O','omp-node'],['X','$X','codex-node']]) for (const s of ['c','l']) cold[k + s] = await G.coldLoad(s, R, N, 5000);
G.fs.writeFileSync(G.S + '/B2-cold.json', JSON.stringify(cold) + '\n');
const reads = {};
for (const [k, R, N] of [['F','$F','cl-node'],['L','$L','haiku-loop'],['O','$O','omp-node'],['X','$X','codex-node']]) {
  const q = await G.api('/api/workflows/runs/' + R + '/nodes/' + N + '/queue');
  const i = await G.api('/api/workflows/runs/' + R + '/nodes/' + N + '/interrupt', { method: 'POST', body: '{}' });
  const s = await G.api('/api/workflows/runs/' + R + '/nodes/' + N + '/send', { method: 'POST', body: JSON.stringify({ message: 'probe after restart', message_id: crypto.randomUUID(), intent: 'queue' }) });
  const d = await G.api('/api/workflows/runs/' + R + '/nodes/' + N + '/draft');
  reads[k] = { es: q.execution_state, auto: q.auto_send, queued: q.queued.map(x => [x.message.slice(0, 20), x.state]), interrupt: i.__status, send: s.__status, sendErr: s.error && s.error.code, draft: d.draft ? (d.draft.text || d.draft.body || JSON.stringify(d.draft)).slice(0, 60) : JSON.stringify(d).slice(0, 80) };
}
G.fs.writeFileSync(G.S + '/B2-reads.json', JSON.stringify(reads, null, 2) + '\n');
return JSON.stringify(reads);
JS
echo
drv <<JS
$LOAD
const fresh = {};
for (const [r, R, N] of [['F','$F','cl-node'],['L','$L','haiku-loop'],['O','$O','omp-node'],['X','$X','codex-node']]) for (const s of ['c','l']) { const ctx = await G.mk(); const p = await G.newShell('f'+r+s, ctx); await p.goto(G.url(s, R, N)); fresh[r+s] = { p, ctx, s, R }; }
for (const v of Object.values(fresh)) await v.p.locator(G.sel(v.s)).first().waitFor({ timeout: 20000 }).catch(() => {});
await G.wait(2500);
const all = [...Object.entries(G.sv).map(([k, v]) => ['sv' + k, v]), ...Object.entries(fresh).map(([k, v]) => ['fr' + k, v])];
for (const [k, v] of all) await v.p.evaluate(G.frameFn, [G.sel(v.s), '', 30000, '__ab', G.keySrc]);
const post = {};
for (const [r, R] of [['F','$F'],['L','$L'],['O','$O'],['X','$X']]) { const t = Date.now(); const x = await G.api('/api/workflows/runs/' + R + '/abandon', { method: 'POST', body: '{}' }); post[r] = { t, ms: Date.now() - t, http: x.__status }; }
await G.wait(12000);
const out = { post, tabs: {} };
for (const [k, v] of all) { const f = await v.p.evaluate(() => window.__ab || []); const r = k.slice(2,3); out.tabs[k] = f.map(x => [x[0] - post[r].t, x[1]]); }
for (const v of Object.values(fresh)) await v.ctx.close();
await G.svClose();
G.fs.writeFileSync(G.S + '/B2-recab.json', JSON.stringify(out) + '\n');
return JSON.stringify(post);
JS
echo
python3 - <<'PY'
import json, subprocess
d = json.load(open('data/B2-prekill-tree.json'))
alive = []
for p in d['procs']:
    r = subprocess.run(['ps', '-o', 'ppid=,command=', '-p', str(p['pid'])], capture_output=True, text=True).stdout.strip()
    if r: alive.append([p['pid'], p['cmd'], r[:50]])
json.dump({'prekill': d['procs'], 'aliveAfterRestart': alive}, open('data/B2-orphans.json', 'w'), indent=2)
print('pre-kill descendants', len(d['procs']), 'still alive', alive)
PY
