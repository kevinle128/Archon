#!/bin/bash
# prov16.sh <tag> <workflow> <node> : real-provider matrix cycle on 3455 (tabs c and l in their own contexts).
#   c1: queue two items from c while generating (per-item Send now count recorded in both tabs), Stop from c (+reap sampler),
#       blank Send now from l.
#   c2/c3: queue from l, Stop from l, blank Send now from c while l races a withdraw click (+6 / +22 ms).
#   AB: queue one item, live Abandon mid-tool, rAF + 40 ms samplers + GET log in both shells, reap sampler.
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3
R=$(./dispatch.sh 3455 $WF "$TAG run"); echo $R > $TAG.run; echo "run $R"
LOAD='if (!G.reap) await (new (Object.getPrototypeOf(async function(){}).constructor)("G", G.fs.readFileSync(G.S + "/../prov.js","utf8")))(G);'
drv() { local b o; b=$(cat); for i in $(seq 1 90); do o=$(printf "%s" "$b" | ./dr.sh ${DRV:-real2}); [ "$o" != busy ] && { echo "$o"; return; }; sleep 2; done; }
drv <<JS
$LOAD
await G.open('c','$R','$N'); await G.open('l','$R','$N');
const tr = await G.toolRunning('c', 150000);
await G.queue('c', 'OP $TAG-c1: reply with the token $TAG-c1ACK, then continue with the remaining steps.'); await G.queue('c', 'OP $TAG-c1b: also include the token $TAG-c1bACK.'); await G.wait(1500);
const sn2 = { c: G.parse(await G.key('c')), l: G.parse(await G.key('l')) };
const rp = G.reap('$TAG-c1stop', 10);
await G.tStart('c', 6000); await G.tStart('l', 6000);
const st = await G.stopTimed('c');
await G.until('l', x => /Send now/.test(x.btns), 30000);
const tc = await G.tGet('c');
await G.wait(800);
await G.tStart('c', 6000); await G.tStart('l', 6000);
const sn = await G.send('l', null);
await G.wait(3000);
const sl = (await G.tGet('l')).map(x => [x[0] - sn.clicked, x[1]]);
await rp;
const stopFrames = tc.map(x => [x[0] - st.clicked, x[1]]);
G.fs.writeFileSync(G.S + '/$TAG-c1.json', JSON.stringify({ R: '$R', toolWaitMs: tr, twoQueued: { c: sn2.c.raw, l: sn2.l.raw }, stop: st, stopFrames, send: sn, sendFrames: sl }) + '\n');
const firstSending = sl.find(x => /SENDING/.test(x[1].split('|')[4]));
return JSON.stringify({ c1: { perItemSendNow: { c: sn2.c.sn, l: sn2.l.sn }, del: { c: sn2.c.del, l: sn2.l.del }, bands: sn2.c.bands, stop: st, firstStopping: (stopFrames.find(x => /Stopping/.test(x[1])) || [null])[0], send: sn.st, firstSendingMs: firstSending ? firstSending[0] : null, blankBeforeSending: sl.filter(x => firstSending && x[0] < firstSending[0] && x[0] > 0 && !x[1].split('|')[4]).length } });
JS
echo
for C in 2 3; do
PROBE=$([ $C = 2 ] && echo 6 || echo 22)
drv <<JS
$LOAD
await G.until('c', x => /Stop/.test(x.btns), 150000); await G.until('l', x => /Stop/.test(x.btns), 30000);
await G.toolRunning('l', 150000);
await G.queue('l', 'OP $TAG-c$C: reply with the token $TAG-c${C}ACK, then continue with the remaining steps.'); await G.wait(1200);
const st = await G.stopTimed('l');
await G.until('c', x => /Send now/.test(x.btns), 30000); await G.wait(700);
const pr = await G.sendWithProbe('c', null, $PROBE);
await G.wait(2500);
G.fs.writeFileSync(G.S + '/$TAG-c$C.json', JSON.stringify({ R: '$R', stop: st, probe: pr }) + '\n');
return JSON.stringify({ c$C: { stop: st, probe: pr } });
JS
echo
done
drv <<JS
$LOAD
await G.until('c', x => /Stop/.test(x.btns), 150000);
await G.toolRunning('c', 150000);
G.needle.c = G.needle.l = '$TAG-AB';
await G.queue('c', '$TAG-AB queued before abandon'); await G.wait(1500);
const rows0 = { c: await G.rows('c'), l: await G.rows('l') };
const g0 = G.gets.length;
await G.tStart('c', 12000); await G.tStart('l', 12000); await G.nsStart('c', 12000); await G.nsStart('l', 12000);
const rp = G.reap('$TAG-ab', 12);
const t = Date.now(); const x = await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); const post = Date.now() - t;
await G.wait(9000);
const rel = a => a.map(y => [y[0] - t, y[1]]);
const raf = { c: rel(await G.tGet('c')), l: rel(await G.tGet('l')) }, ns = { c: rel(await G.nsGet('c')), l: rel(await G.nsGet('l')) };
const gets = G.gets.slice(g0).filter(g => g.s === 'c' || g.s === 'l').map(g => Object.assign({}, g, { t: g.t - t }));
await rp;
const rows1 = { c: await G.rows('c'), l: await G.rows('l') };
const msgs = (await G.api('/api/workflows/runs/$R/nodes/$N/messages')).messages || [];
const r = await G.api('/api/workflows/runs/$R');
await G.shot('c', '$TAG-abandoned'); await G.shot('l', '$TAG-abandoned');
G.fs.writeFileSync(G.S + '/$TAG-abandon.json', JSON.stringify({ R: '$R', post, abandonAt: t, res: x, raf, ns, gets, rows0, rows1, status: r.run.status }) + '\n');
G.fs.writeFileSync(G.S + '/$TAG-messages.json', JSON.stringify(msgs.map(m => ({ seq: m.seq, kind: m.kind, payload: m.kind === 'text' ? { text: String(m.payload.text || '').slice(0, 120), role: m.payload.role, block_id: m.payload.block_id, kind: m.payload.kind } : m.kind === 'tool' ? { name: m.payload.name, id: m.payload.id, has_output: 'output' in m.payload } : m.payload, meta: m.metadata ? Object.fromEntries(Object.entries(m.metadata).filter(([k]) => k !== 'execution')) : null }))) + '\n');
return JSON.stringify({ post, status: r.run.status, rows1, final: { c: raf.c.slice(-1)[0], l: raf.l.slice(-1)[0] } });
JS
echo
