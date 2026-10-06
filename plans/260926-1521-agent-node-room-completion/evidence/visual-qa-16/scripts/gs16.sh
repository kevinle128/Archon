#!/bin/bash
# gs16.sh : Grok --single (output_format). No Stop offered; queue one item; Abandon with `sleep 60` open; reap sampler; PPID
# reads of every captured descendant at +3 s and +8 s.
cd "$(dirname "$0")"; . ./common16.sh
R=$(./dispatch.sh 3455 vq16-grok-single "gs run"); echo $R > gs.run; echo run $R
drv <<JS
$LOAD
await G.open('c','$R','grok-single'); await G.open('l','$R','grok-single');
const t0 = Date.now(); while (Date.now() - t0 < 150000) { const t = await G.roomText('c'); if (/◐/.test(t) && /sleep 60/.test(t)) break; await G.wait(500); }
await G.wait(3000);
const k0 = { c: await G.key('c'), l: await G.key('l') };
G.needle.c = G.needle.l = 'GS-AB';
await G.queue('c', 'GS-AB queued before abandon'); await G.queue('c', 'GS-AB2 second queued item'); await G.wait(1200);
const k1 = { c: await G.key('c'), l: await G.key('l') };
await G.tStart('c', 10000); await G.tStart('l', 10000);
const rp = G.reap('gs-ab', 12); await G.wait(1500);
const t = Date.now(); const x = await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); const T = Date.now();
await rp;
const rel = a => a.map(y => [y[0] - T, y[1]]);
const raf = { c: rel(await G.tGet('c')), l: rel(await G.tGet('l')) };
G.fs.writeFileSync(G.S + '/gs-abandon.json', JSON.stringify({ R: '$R', post: T - t, abandonAt: T, k0, k1, raf, gets: [] }) + '\n');
await G.shot('c','gs-abandoned'); await G.shot('l','gs-abandoned');
return JSON.stringify({ k0, k1, post: T - t, abandonAt: T });
JS
echo
python3 - <<'PY'
import json, subprocess, time
d = json.load(open('data/gs-ab-reap.json')); pids = [p['pid'] for p in d['procs']]
for w in (3, 8):
    time.sleep(w - (3 if w == 8 else 0))
    alive = []
    for p in pids:
        r = subprocess.run(['ps', '-o', 'ppid=,command=', '-p', str(p)], capture_output=True, text=True).stdout.strip()
        if r: alive.append([p, r[:60]])
    print('+%ds alive' % w, alive)
PY
