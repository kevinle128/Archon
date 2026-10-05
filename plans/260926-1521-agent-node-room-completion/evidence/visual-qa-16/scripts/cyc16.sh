#!/bin/bash
# cyc16.sh <real|fake> <c|l> <TAG> [coldMs] [shots]: dispatch a soft-inject run, run one per-item Send now cycle, save data/si-TAG.json.
cd "$(dirname "$0")"
W=$1; S=$2; TAG=$3; COLD=${4:-null}; SHOTS=${5:-false}
P=$([ "$W" = real ] && echo 3455 || echo 3456)
WF=${WF:-vq16-si-claude-steer}; NODE=${NODE:-cl-node}
echo "{ await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../setup16.js','utf8')))(G); } return 'ok';" | ./dr.sh $W > /dev/null
R=$(./dispatch.sh $P $WF "go $TAG")
echo "run $R"
echo "const o = await G.cycle({R:'$R', s:'$S', tag:'$TAG', node:'$NODE', shots:$SHOTS, cold:$COLD}); G.fs.writeFileSync(G.S + '/si-$TAG.json', JSON.stringify(o) + '\n'); return JSON.stringify({status:o.status, click:o.click, queue:o.queue, ops:o.operatorRows, ack:o.ackInAgentText, attempts:o.attempts.length, pre:o.pre});" | ./dr.sh $W
echo
