#!/bin/bash
# sr15.sh <tag> <workflow> <node> : Stop with reap. The process sampler starts 1.5 s before the Stop so the running tool is
# captured, then the node is Abandoned (sampler again started 1.5 s before).
cd "$(dirname "$0")"; . ./common.sh; TAG=$1; WF=$2; N=$3
R=$(./dispatch.sh 3425 $WF "$TAG run"); echo $R > $TAG.run; echo run $R
drv <<JS
$LOAD
await G.open('c','$R','$N'); await G.open('l','$R','$N');
await G.toolRunning('c', 170000); await G.wait(2500);
const rp = G.reap('$TAG-stop', 9); await G.wait(1500);
const st = await G.stopTimed('c'); await rp;
await G.until('l', x => /Send now/.test(x.btns), 30000);
await G.send('l', 'SR: reply with the token $TAG-ACK, then continue with the remaining steps.');
await G.toolRunning('c', 170000); await G.wait(2500);
const rp2 = G.reap('$TAG-ab', 10); await G.wait(1500);
const t = Date.now(); await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); await rp2;
G.fs.writeFileSync(G.S + '/$TAG-marks.json', JSON.stringify({ R: '$R', stop: st.clicked, abandon: t }) + '\n');
return JSON.stringify({ st, abandon: t });
JS
echo
