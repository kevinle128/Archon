#!/bin/bash
# cxl16.sh : Codex `sleep 90` Stop in each shell (reap sampler each time), typed continuations, then Abandon (reap sampler).
cd "$(dirname "$0")"; . ./common16.sh
R=$(./dispatch.sh 3455 vq16-codex-long "cxl run"); echo $R > cxl.run; echo run $R
for S in c l; do O=$([ $S = c ] && echo l || echo c); N=$([ $S = c ] && echo 1 || echo 2)
drv <<JS
$LOAD
if ('$S' === 'c') { await G.open('c','$R','codex-node'); await G.open('l','$R','codex-node'); }
await G.toolRunning('$S', 170000); await G.wait(3000);
const rp = G.reap('cxl-stop$N', 8); await G.wait(1500);
const st = await G.stopTimed('$S'); await rp;
await G.until('$O', x => /Send now/.test(x.btns), 30000); await G.wait(500);
const s = await G.send('$O', 'CXL$N: reply with the token CXLACK$N, then run exactly this shell command: sleep 90; echo again$N');
return JSON.stringify({ st, s: s.st });
JS
echo
done
drv <<JS
$LOAD
await G.toolRunning('c', 170000); await G.wait(3000);
G.needle.c = G.needle.l = 'CXL-AB';
await G.queue('c', 'CXL-AB queued before abandon'); await G.wait(1200);
await G.tStart('c', 10000); await G.tStart('l', 10000);
const rp = G.reap('cxl-ab', 10); await G.wait(1500);
const t = Date.now(); const x = await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); const T = Date.now();
await rp; await G.wait(1000);
const rel = a => a.map(y => [y[0] - T, y[1]]);
const raf = { c: rel(await G.tGet('c')), l: rel(await G.tGet('l')) };
const msgs = (await G.api('/api/workflows/runs/$R/nodes/codex-node/messages')).messages;
G.fs.writeFileSync(G.S + '/cxl-abandon.json', JSON.stringify({ R: '$R', post: T - t, abandonAt: T, raf, gets: [] }) + '\n');
G.fs.writeFileSync(G.S + '/cxl-messages.json', JSON.stringify(msgs.map(m => ({ seq: m.seq, kind: m.kind, text: m.kind === 'text' ? String(m.payload.text).slice(0, 100) : m.payload.name, id: m.payload.id }))) + '\n');
await G.shot('c','cxl-abandoned'); await G.shot('l','cxl-abandoned');
return JSON.stringify({ post: T - t, final: [raf.c.slice(-1)[0], raf.l.slice(-1)[0]] });
JS
echo
