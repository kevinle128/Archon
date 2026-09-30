#!/bin/bash
# fab16.sh <tag> <workflow> <node> : live Abandon on e2e-fake with one queued item; rAF + 40 ms samplers + GET log in both
# shells; frames relative to the Abandon POST resolve (vq.py format).
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3
R=$(./dispatch.sh 3456 $WF "$TAG run"); echo $R > $TAG.run; sleep 3
cat <<JS | ./dr.sh fake
await G.open('c','$R','$N'); await G.open('l','$R','$N');
G.needle.c = G.needle.l = '$TAG-Q1';
await G.queue('c', '$TAG-Q1 queued before abandon'); await G.wait(1500);
const g0 = G.gets.length;
await G.tStart('c', 9000); await G.tStart('l', 9000); await G.nsStart('c', 9000); await G.nsStart('l', 9000);
const t = Date.now(); const x = await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); const T = Date.now();
await G.wait(6000);
const rel = a => a.map(y => [y[0] - T, y[1]]);
const raf = { c: rel(await G.tGet('c')), l: rel(await G.tGet('l')) }, ns = { c: rel(await G.nsGet('c')), l: rel(await G.nsGet('l')) };
const gets = G.gets.slice(g0).filter(g => g.s === 'c' || g.s === 'l').map(g => Object.assign({}, g, { t: g.t - T }));
G.fs.writeFileSync(G.S + '/$TAG-abandon.json', JSON.stringify({ R: '$R', post: T - t, res: x, raf, ns, gets }) + '\n');
return JSON.stringify({ post: T - t, final: { c: raf.c.slice(-1)[0], l: raf.l.slice(-1)[0] } });
JS
echo
