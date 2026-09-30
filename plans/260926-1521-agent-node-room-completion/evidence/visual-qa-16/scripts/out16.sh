#!/bin/bash
# out16.sh <tag> <downSec> : fake-server outage. Run A (prompt, live, 1 queued), run B (loop, Stopped, 1 queued) and run C
# (soft-inject provider, ONE queued + TWO accepted in flight by a per-item Send now), two survivor tabs per run (own contexts), rAF-logged. kill -9 the fake server by its recorded PID, restart after <downSec>.
# Then cold loads of both runs in both shells, then recovered Abandons observed by survivor + fresh tabs.
cd "$(dirname "$0")"; TAG=$1; DOWN=$2
A=$(./dispatch.sh 3456 vq16-fake "$TAG A run"); B=$(./dispatch.sh 3456 vq16-fake-loop "$TAG B run"); C=$(./dispatch.sh 3456 vq16-fake-si "$TAG C run"); echo "$A $B $C" > $TAG.runs; sleep 3
cat <<JS | ./dr.sh fake2
if (!G.svOpen) await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../outage.js','utf8')))(G);
await G.open('c','$A','fake-node'); await G.queue('c','$TAG-A1 queued on live'); 
await G.open('l','$B','fake-loop'); await G.queue('l','$TAG-B1 queued on stopped'); await G.wait(800); await G.stop('l');
await G.until('l', x => /Send now/.test(x.btns), 20000);
await G.svOpen('Ac','c','$A','fake-node'); await G.svOpen('Al','l','$A','fake-node');
await G.svOpen('Bc','c','$B','fake-loop'); await G.svOpen('Bl','l','$B','fake-loop');
await G.open('c','$C','fake-node'); await G.until('c', x => /Stop/.test(x.btns), 20000);
await G.queue('c','$TAG-C1 queued one'); await G.queue('c','$TAG-C2 injected two'); await G.wait(1200);
const wC = G.postWait('c', /\/send(\?|$)/); await G.room('c').locator('button[aria-label^="Send now · $TAG-C2"]').first().click(); const rC = await wC;
await G.wait(800); G.qC0 = await G.api('/api/workflows/runs/$C/nodes/fake-node/queue');
await G.svOpen('Cc','c','$C','fake-node'); await G.svOpen('Cl','l','$C','fake-node');
await G.wait(1500);
await G.svArm(($DOWN + 45) * 1000);
const k = {}; for (const x of Object.keys(G.sv)) k[x] = await G.svKey(x);
return JSON.stringify(k);
JS
echo
sleep 2; PID=$(cat ../fake.pid); KILL=$(./ms.sh); kill -9 $PID; echo "killed $PID at $KILL" | tee -a outages.log
( sleep 2; cat <<JS | ./dr.sh fake2 > data/$TAG-duringdown.json
const o = {}; for (const k of ['Ac', 'Cc']) { const v = G.sv[k]; await v.p.locator(G.sel()).first().screenshot({ path: G.SH + '/outage-$TAG-' + k + '-down.png' }).catch(() => {}); o[k] = await v.p.evaluate(sel => { const e = document.querySelector(sel); return { text: e ? e.innerText.slice(-700) : null, retry: e ? [...e.querySelectorAll('button')].filter(b => /Retry/.test(b.innerText)).map(b => (b.closest('[role]') || b.parentElement).innerText.slice(0, 200)) : null }; }, G.sel()); }
return JSON.stringify(o) + '\n';
JS
) &
if [ "$DOWN" -ge 25 ]; then
( sleep 5; cat <<JS | ./dr.sh fake2 > data/$TAG-download.json
const c = await G.coldLoad('c','$A','fake-node', 16000); const l = await G.coldLoad('l','$A','fake-node', 16000);
return JSON.stringify({ c, l }) + '\n';
JS
) &
fi
sleep $DOWN; ./start-fake.sh
until curl -sf localhost:3456/api/health > /dev/null; do sleep 0.05; done; UP=$(./ms.sh); echo "up $(cat ../fake.pid) at $UP" | tee -a outages.log
wait
sleep 14
cat <<JS | ./dr.sh fake2
const tabs = await G.svCollect();
for (const k of Object.keys(G.sv)) await G.svShot('$TAG', k);
const qC = await G.api('/api/workflows/runs/$C/nodes/fake-node/queue');
const qsC = q => (q.queued || []).map(x => [x.message.slice(0, 14), x.state, x.dispatch_failure_count, x.last_error]);
G.fs.writeFileSync(G.S + '/$TAG-outage.json', JSON.stringify({ tag: '$TAG', A: '$A', B: '$B', C: '$C', kill: $KILL, up: $UP, downMs: $UP - $KILL, qCbefore: qsC(G.qC0), qCafter: qsC(qC), subCafter: qC.sub_state, execCafter: qC.execution_state, tabs }) + '\n');
const cold = {};
for (const [r, R, N] of [['A','$A','fake-node'],['B','$B','fake-loop'],['C','$C','fake-node']]) for (const s of ['c','l']) cold[r + s] = await G.coldLoad(s, R, N, 5000);
G.fs.writeFileSync(G.S + '/$TAG-cold.json', JSON.stringify(cold) + '\n');
return 'collected';
JS
echo
cat <<JS | ./dr.sh fake2
// Recovered Abandon: survivor tabs + one fresh tab per shell per run, rAF-logged, Abandon via API.
const fresh = {};
for (const [r, R, N] of [['A','$A','fake-node'],['B','$B','fake-loop'],['C','$C','fake-node']]) for (const s of ['c','l']) { const ctx = await G.mk(); const p = await G.newShell('f'+r+s, ctx); await p.goto(G.url(s, R, N)); await p.locator(G.sel(s)).first().waitFor({ timeout: 20000 }).catch(() => {}); fresh[r+s] = { p, ctx, s, R }; }
await G.wait(2500);
const all = [...Object.entries(G.sv).map(([k, v]) => ['sv' + k, v]), ...Object.entries(fresh).map(([k, v]) => ['fr' + k, v])];
for (const [k, v] of all) await v.p.evaluate(G.frameFn, [G.sel(v.s), '', 40000, '__ab', G.keySrc]);
const post = {};
for (const [r, R] of [['A','$A'],['B','$B'],['C','$C']]) { const t = Date.now(); const x = await G.api('/api/workflows/runs/' + R + '/abandon', { method: 'POST', body: '{}' }); post[r] = { t, ms: Date.now() - t, http: x.__status }; }
await G.wait(30000);
const out = { post, tabs: {}, gets: G.gets.filter(g => g.t >= post.A.t - 3000 && /^(sv|f)/.test(g.s)).map(g => Object.assign({}, g, { t: g.t - post.A.t })) };
for (const [k, v] of all) { const f = await v.p.evaluate(() => window.__ab || []); const r = k.slice(2,3); out.tabs[k] = f.map(x => [x[0] - post[r].t, x[1]]); }
for (const v of Object.values(fresh)) await v.ctx.close();
await G.svClose();
G.fs.writeFileSync(G.S + '/$TAG-recab.json', JSON.stringify(out) + '\n');
const qCend = await G.api('/api/workflows/runs/$C/nodes/fake-node/queue'); out.qCend = (qCend.queued || []).map(x => [x.message.slice(0, 14), x.state]);
G.fs.writeFileSync(G.S + '/$TAG-recab.json', JSON.stringify(out) + '\n');
const bad = Object.fromEntries(Object.entries(out.tabs).map(([k, f]) => { const i = f.findIndex(x => /^(Failed|Cancelled|Completed)/.test(x[1]) && x[0] > 0); return [k, { firstTerm: i >= 0 ? f[i][0] : null, runAfter: i >= 0 ? f.slice(i).filter(x => /^Running/.test(x[1])).length : null }]; }));
return JSON.stringify({ post, bad, qCend: out.qCend });
JS
echo
