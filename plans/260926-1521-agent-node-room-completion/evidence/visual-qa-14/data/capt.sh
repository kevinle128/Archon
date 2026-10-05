#!/bin/bash
# capt.sh <tag> <workflow> <node> : fake-provider captures of s1, s3, s4, s5 in both shells.
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3
R=$(./dispatchf.sh $WF "$TAG run"); echo $R > $TAG.run; ./waitopenf.sh $R . 1; sleep 1
cat <<JS | ./df.sh
await G.open('c','$R','$N'); await G.open('l','$R','$N');
await G.queue('c','$TAG-Q1 first queued guidance'); await G.wait(600); await G.queue('l','$TAG-Q2 second queued guidance'); await G.wait(2500);
await G.shot('c','$TAG-s1'); await G.shot('l','$TAG-s1');
await G.stop('c'); await G.until('c', x => /Send now/.test(x.btns), 20000); await G.until('l', x => /Send now/.test(x.btns), 20000); await G.wait(1500);
await G.shot('c','$TAG-s3'); await G.shot('l','$TAG-s3');
await G.send('l', '$TAG typed redirect <<E2E_SCENARIO>>{"emitTool":true,"interruptible":true,"delayMs":30000}<</E2E_SCENARIO>>'); await G.wait(3500);
await G.shot('c','$TAG-s4'); await G.shot('l','$TAG-s4');
await G.queue('c','$TAG-Q3 queued before abandon'); await G.wait(2000);
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); await G.wait(4000);
await G.shot('c','$TAG-s5'); await G.shot('l','$TAG-s5');
return 'ok';
JS
echo
