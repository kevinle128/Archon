#!/bin/bash
# nat15.sh <tag> : natural completion (s6 clean) observed by rAF in both shells; no Recovery frame, Running+dock -> Completed.
cd "$(dirname "$0")"; TAG=$1
R=$(./dispatch.sh 3426 vq15-fake-short "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh fake
await G.open('c','$R','fake-node'); await G.open('l','$R','fake-node');
await G.tStart('c', 16000); await G.tStart('l', 16000);
await G.until('c', x => /Completed/.test(x.pill), 20000); await G.wait(2500);
const r = await G.api('/api/workflows/runs/$R'); const ev = r.events.find(e => e.event_type === 'node_completed');
const T = Date.parse(ev.created_at.replace(' ', 'T') + 'Z');
const rel = a => a.map(x => [x[0] - T, x[1].split('|').slice(0, 7).join('|')]);
const tc = rel(await G.tGet('c')), tl = rel(await G.tGet('l'));
await G.shot('c','$TAG-s6'); await G.shot('l','$TAG-s6');
G.fs.writeFileSync(G.S + '/nat-$TAG.json', JSON.stringify({ R: '$R', nodeCompletedAt: ev.created_at, tc, tl }) + '\n');
return JSON.stringify({ tc: tc.slice(-4), tl: tl.slice(-4), rec: [...tc, ...tl].filter(x => /Recovery/.test(x[1])).length });
JS
echo
