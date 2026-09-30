#!/bin/bash
# fin14.sh <tag> <sendShell> <delayMs> : e2e-fake run on 3406; queue an item, Stop, Send now typed text from sendShell;
# the redirect reply ends the node after <delayMs>. rAF-watch both shells; EventSource log per page.
cd "$(dirname "$0")"; TAG=$1; SD=$2; DL=${3:-100}
R=$(./dispatchf.sh vq14-fake "$TAG run"); echo $R > $TAG.run
sleep 4
cat <<JS | ./df.sh
await G.open('c','$R','fake-node'); await G.open('l','$R','fake-node'); const x2 = await G.ctx.newPage(); await G.esArm(x2); await x2.goto('/console'); await G.wait(1500);
await G.queue('$SD', '$TAG-Q1 queued item'); await G.wait(1500);
await G.stop('$SD');
await G.until('c', x => /Send now/.test(x.btns), 20000); await G.until('l', x => /Send now/.test(x.btns), 20000); await G.wait(800);
await G.nsStart('c', 8000); await G.nsStart('l', 8000); await G.tStart('c', 8000); await G.tStart('l', 8000);
const txt = $DL > 0 ? '$TAG typed redirect <<E2E_SCENARIO>>{"delayMs":$DL}<</E2E_SCENARIO>>' : '$TAG typed redirect';
{ const t0 = Date.now(); while (Date.now() - t0 < 8000) { const e = (await G.esGet(G.pages.l)) || []; const last = e.filter(x => /__dashboard__/.test(x[2]) && x[1] !== 'new' && x[1] !== 'close').slice(-1)[0]; if (last && last[1] === 'error' && Date.now() - last[0] < 400) break; await G.wait(30); } }
const s = await G.send('$SD', txt);
await G.wait(8500);
const T = s.sendResolved; const rel = a => a.map(x => [x[0]-T, x[1]]);
const c = rel(await G.nsGet('c')), l = rel(await G.nsGet('l')); const tc = rel(await G.tGet('c')), tl = rel(await G.tGet('l'));
await G.shot('c','$TAG-final'); await G.shot('l','$TAG-final');
const q = await G.api('/api/workflows/runs/$R/nodes/fake-node/queue');
const r = await G.api('/api/workflows/runs/$R');
const es = { c: rel(await G.esGet(G.pages.c) || []), l: rel(await G.esGet(G.pages.l) || []), l2: rel(await G.esGet(x2) || []) }; await x2.close();
const bad = a => a.filter(x => /NEVER SENT|none of this was sent/.test(x[1]));
const rec = a => a.filter(x => /\|REC\|/.test(x[1]));
const term = a => { const x = a.find(y => /^(Completed|Failed)/.test(y[1])); return x ? x[0] : null; };
const gets = G.gets.filter(g => g.t >= s.clicked - 2000).map(g => Object.assign({}, g, { t: g.t - T }));
const nodeDone = r.events.filter(e => /node_completed|node_failed/.test(e.event_type)).map(e => e.created_at);
G.fs.writeFileSync(G.S + '/ev-$TAG.json', JSON.stringify({ R: '$R', sd: '$SD', dl: $DL, send: s, gets, status: (r.run||r).status, nodeDone, q: q.queued, c, l, tc, tl, es }));
return JSON.stringify({ status: (r.run||r).status, send: [s.st, s.sendResolved - s.clicked], q: q.queued.map(x => [x.message.slice(0,12), x.state]), falseNS: { c: bad(c).length, l: bad(l).length }, rec: { c: rec(tc).length, l: rec(tl).length }, completedAt: { c: term(tc), l: term(tl) } });
JS
echo
