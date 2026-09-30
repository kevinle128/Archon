#!/bin/bash
# fab14.sh <tag> <workflow> <node> <queueShell> : e2e-fake live Abandon with one queued item; rAF + needle + GET log in both shells.
cd "$(dirname "$0")"; TAG=$1; WF=$2; N=$3; QS=${4:-c}
R=$(./dispatchf.sh $WF "$TAG run"); echo $R > $TAG.run
./waitopenf.sh $R . 1; sleep 1
cat <<JS | ./df.sh
await G.open('c','$R','$N'); await G.open('l','$R','$N');
await G.queue('$QS','$TAG-Q must survive abandon'); await G.wait(2500);
const r = await G.abandon('$R','$TAG-Q must survive', 7000);
G.fs.writeFileSync(G.S+'/$TAG-abandon.json', JSON.stringify(r));
await G.shot('c','$TAG-s5'); await G.shot('l','$TAG-s5');
return 'ok';
JS
echo
