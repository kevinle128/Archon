#!/bin/bash
# rfl16.sh <tag> <cycles> : real Claude haiku loop. Each cycle: stopper Stops mid-tool, the other shell sends a typed redirect
# asking for a short reply that ends the iteration (a loop boundary). rAF key incl. document.activeElement in both shells.
cd "$(dirname "$0")"; TAG=$1; NC=${2:-6}
R=$(./dispatch.sh 3455 vq16-haiku-loop "$TAG loop run"); echo $R > $TAG.run; sleep 3
for i in $(seq 1 $NC); do
S1=$([ $((i % 2)) = 1 ] && echo c || echo l); S2=$([ $S1 = c ] && echo l || echo c)
cat <<JS | ./dr.sh real2
if ($i === 1) { await G.open('c','$R','haiku-loop'); await G.open('l','$R','haiku-loop'); }
if (!G.reap) await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../prov.js','utf8')))(G); await G.toolRunning('c', 170000); await G.wait(1500);
const it0 = (await G.room('c').evaluate(e => e.innerText).catch(() => '')).match(/Iteration \d+/);
const st = await G.stop('$S1');
await G.until('$S2', x => /Send now/.test(x.btns), 20000); await G.wait(400);
await G.tStart("c", 15000); await G.tStart("l", 15000);
const s = await G.send('$S2', '$TAG-$i redirect: reply with one short line and end this iteration now, no tools.');
await G.wait(14000);
const rel = a => a.map(x => [x[0] - s.sendResolved, x[1].split('|')[11], x[1].split('|')[0], x[1].split('|')[2]]);
const tc = rel(await G.tGet('c')), tl = rel(await G.tGet('l'));
G.fs.writeFileSync(G.S + '/RFL-$TAG-i$i.json', JSON.stringify({ R: '$R', stopper: '$S1', sender: '$S2', stop: st, send: s, tc, tl }) + '\n');
const body = a => a.filter(x => x[1] === 'BODY').length;
return JSON.stringify({ i: $i, stopper: '$S1', bodyFrames: { c: body(tc), l: body(tl) }, focusSeq: { c: [...new Set(tc.map(x => x[1]))], l: [...new Set(tl.map(x => x[1]))] } });
JS
echo
done
