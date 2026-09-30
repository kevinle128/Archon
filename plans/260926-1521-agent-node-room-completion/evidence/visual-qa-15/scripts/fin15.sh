#!/bin/bash
# fin15.sh <tag> <sendShell> <delayMs> : e2e-fake run; queue an item, Stop, typed Send now from sendShell whose reply ends
# the node after <delayMs>. Companion __dashboard__ subscribers stay open: a second Legacy tab on the same run, plus the
# persistent /console runs page and /legacy/dashboard (G.comp). rAF + 40 ms samplers in both shells; EventSource logs.
cd "$(dirname "$0")"; TAG=$1; SD=$2; DL=${3:-100}
R=$(./dispatch.sh 3426 vq15-fake "$TAG run"); echo $R > $TAG.run
sleep 3
cat <<JS | ./dr.sh fake
if (!G.comp) { G.comp = { runs: await G.newShell('xr'), dash: await G.newShell('xd') }; await G.comp.runs.goto('/console'); await G.comp.dash.goto('/legacy/dashboard'); await G.wait(2000); }
G.needle.c = G.needle.l = '$TAG-Q1';
await G.open('c','$R','fake-node'); await G.open('l','$R','fake-node');
const x2 = await G.newShell('x2'); await x2.goto(G.url('l','$R','fake-node')); await x2.locator(G.sel('l')).first().waitFor({ timeout: 20000 });
await G.queue('$SD', '$TAG-Q1 queued item'); await G.wait(1500);
await G.stop('$SD');
await G.until('c', x => /Send now/.test(x.btns), 20000); await G.until('l', x => /Send now/.test(x.btns), 20000); await G.wait(800);
await G.nsStart('c', 8000); await G.nsStart('l', 8000); await G.tStart('c', 8000); await G.tStart('l', 8000);
const txt = $DL > 0 ? '$TAG typed redirect <<E2E_SCENARIO>>{"delayMs":$DL}<</E2E_SCENARIO>>' : '$TAG typed redirect';
const s = await G.send('$SD', txt);
await G.wait(6000);
const T = s.sendResolved; const rel = a => a.map(x => [x[0]-T, ...x.slice(1)]);
const c = rel(await G.nsGet('c')), l = rel(await G.nsGet('l')); const tc = rel(await G.tGet('c')), tl = rel(await G.tGet('l'));
const q = await G.api('/api/workflows/runs/$R/nodes/fake-node/queue');
const r = await G.api('/api/workflows/runs/$R');
const es = { c: rel(await G.esGet(G.pages.c) || []), l: rel(await G.esGet(G.pages.l) || []), l2: rel(await G.esGet(x2) || []), runs: rel(await G.esGet(G.comp.runs) || []), dash: rel(await G.esGet(G.comp.dash) || []) };
await x2.close();
const bad = a => a.filter(x => /NEVER SENT|none of this was sent/.test(x[1]));
const rec = a => a.filter(x => /\|REC\|/.test(x[1]));
const term = a => { const x = a.find(y => /^(Completed|Failed)/.test(y[1])); return x ? x[0] : null; };
const gets = G.gets.filter(g => g.t >= s.clicked - 2000 && g.t <= s.clicked + 8000).map(g => Object.assign({}, g, { t: g.t - T }));
const nodeDone = r.events.filter(e => /node_completed|node_failed/.test(e.event_type)).map(e => e.created_at);
const win = a => { const d = a.filter(e => e[2] === '__dashboard__'); const o = d.findIndex(e => e[1] === 'open'); return d.filter((e, i) => e[1] === 'error' || (e[1] === 'close' && o >= 0 && i > o)).length; };
const dashChurn = { l: win(es.l), l2: win(es.l2), runs: win(es.runs), dash: win(es.dash) };
G.fs.writeFileSync(G.S + '/fin-$TAG.json', JSON.stringify({ R: '$R', sd: '$SD', dl: $DL, send: s, gets, status: (r.run||r).status, nodeDone, q: q.queued, c, l, tc, tl, es, dashChurn }) + '\n');
return JSON.stringify({ status: (r.run||r).status, send: [s.st, s.sendResolved - s.clicked], q: q.queued.map(x => [x.message.slice(0,12), x.state]), falseNS: { c: bad(c).length, l: bad(l).length }, rec: { c: rec(tc).length, l: rec(tl).length }, completedAt: { c: term(tc), l: term(tl) }, dashChurn });
JS
echo
