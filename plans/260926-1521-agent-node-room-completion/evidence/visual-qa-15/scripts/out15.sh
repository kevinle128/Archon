#!/bin/bash
# out15.sh <tag> <downSec> : fake-server outage. Run A (prompt, live, 1 queued) and run B (loop, Stopped, 1 queued),
# one survivor tab per shell per run, rAF-logged. kill -9 the fake server by its recorded PID, restart after <downSec>.
# Then cold loads of both runs in both shells, then recovered Abandons observed by survivor + fresh tabs.
cd "$(dirname "$0")"; TAG=$1; DOWN=$2
A=$(./dispatch.sh 3426 vq15-fake "$TAG A run"); B=$(./dispatch.sh 3426 vq15-fake-loop "$TAG B run"); echo "$A $B" > $TAG.runs; sleep 3
cat <<JS | ./dr.sh fake
if (!G.svOpen) await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../outage.js','utf8')))(G);
await G.open('c','$A','fake-node'); await G.queue('c','$TAG-A1 queued on live'); 
await G.open('l','$B','fake-loop'); await G.queue('l','$TAG-B1 queued on stopped'); await G.wait(800); await G.stop('l');
await G.until('l', x => /Send now/.test(x.btns), 20000);
await G.svOpen('Ac','c','$A','fake-node'); await G.svOpen('Al','l','$A','fake-node');
await G.svOpen('Bc','c','$B','fake-loop'); await G.svOpen('Bl','l','$B','fake-loop');
await G.wait(1500);
await G.svArm(($DOWN + 45) * 1000);
const k = {}; for (const x of Object.keys(G.sv)) k[x] = await G.svKey(x);
return JSON.stringify(k);
JS
echo
sleep 2; PID=$(cat fake.pid); KILL=$(./ms.sh); kill -9 $PID; echo "killed $PID at $KILL" | tee -a outages.log
if [ "$DOWN" -ge 25 ]; then
( sleep 3; cat <<JS | ./dr.sh fake > data/$TAG-download.json
const c = await G.coldLoad('c','$A','fake-node', 16000); const l = await G.coldLoad('l','$A','fake-node', 16000);
return JSON.stringify({ c, l }) + '\n';
JS
) &
fi
sleep $DOWN; ./start-fake.sh
until curl -sf localhost:3426/api/health > /dev/null; do sleep 0.05; done; UP=$(./ms.sh); echo "up $(cat fake.pid) at $UP" | tee -a outages.log
wait
sleep 14
cat <<JS | ./dr.sh fake
const tabs = await G.svCollect();
for (const k of Object.keys(G.sv)) await G.svShot('$TAG', k);
G.fs.writeFileSync(G.S + '/$TAG-outage.json', JSON.stringify({ tag: '$TAG', A: '$A', B: '$B', kill: $KILL, up: $UP, downMs: $UP - $KILL, tabs }) + '\n');
const cold = {};
for (const [r, R, N] of [['A','$A','fake-node'],['B','$B','fake-loop']]) for (const s of ['c','l']) cold[r + s] = await G.coldLoad(s, R, N, 5000);
G.fs.writeFileSync(G.S + '/$TAG-cold.json', JSON.stringify(cold) + '\n');
return 'collected';
JS
echo
cat <<JS | ./dr.sh fake
// Recovered Abandon: survivor tabs + one fresh tab per shell per run, rAF-logged, Abandon via API.
const fresh = {};
for (const [r, R, N] of [['A','$A','fake-node'],['B','$B','fake-loop']]) for (const s of ['c','l']) { const ctx = await G.mk(); const p = await G.newShell('f'+r+s, ctx); await p.goto(G.url(s, R, N)); await p.locator(G.sel(s)).first().waitFor({ timeout: 20000 }).catch(() => {}); fresh[r+s] = { p, ctx, s, R }; }
await G.wait(2500);
const all = [...Object.entries(G.sv).map(([k, v]) => ['sv' + k, v]), ...Object.entries(fresh).map(([k, v]) => ['fr' + k, v])];
for (const [k, v] of all) await v.p.evaluate(G.frameFn, [G.sel(v.s), '', 40000, '__ab', G.keySrc]);
const post = {};
for (const [r, R] of [['A','$A'],['B','$B']]) { const t = Date.now(); const x = await G.api('/api/workflows/runs/' + R + '/abandon', { method: 'POST', body: '{}' }); post[r] = { t, ms: Date.now() - t, http: x.__status }; }
await G.wait(30000);
const out = { post, tabs: {}, gets: G.gets.filter(g => g.t >= post.A.t - 3000 && /^(sv|f)/.test(g.s)).map(g => Object.assign({}, g, { t: g.t - post.A.t })) };
for (const [k, v] of all) { const f = await v.p.evaluate(() => window.__ab || []); const r = k.slice(2,3); out.tabs[k] = f.map(x => [x[0] - post[r].t, x[1]]); }
for (const v of Object.values(fresh)) await v.ctx.close();
await G.svClose();
G.fs.writeFileSync(G.S + '/$TAG-recab.json', JSON.stringify(out) + '\n');
const bad = Object.fromEntries(Object.entries(out.tabs).map(([k, f]) => { const i = f.findIndex(x => /^(Failed|Cancelled|Completed)/.test(x[1]) && x[0] > 0); return [k, { firstTerm: i >= 0 ? f[i][0] : null, runAfter: i >= 0 ? f.slice(i).filter(x => /^Running/.test(x[1])).length : null }]; }));
return JSON.stringify({ post, bad });
JS
echo
