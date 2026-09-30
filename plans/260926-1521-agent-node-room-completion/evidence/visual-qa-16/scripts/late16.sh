#!/bin/bash
# late16.sh <c|l> <TAG> : Claude one-tool run; per-item Send now clicked after the only tool finished (late-injection window).
cd "$(dirname "$0")"; S=$1; TAG=$2
echo "{ const F = Object.getPrototypeOf(async function(){}).constructor; await (new F('G', G.fs.readFileSync(G.S + '/../setup16.js','utf8')))(G); await (new F('G', G.fs.readFileSync(G.S + '/../setup-late.js','utf8')))(G); } return 'ok';" | ./dr.sh real > /dev/null
R=$(./dispatch.sh 3455 vq16-si-claude-late "go $TAG"); echo "run $R"
echo "const o = await G.late({R:'$R', s:'$S', tag:'$TAG'}); G.fs.writeFileSync(G.S + '/late-$TAG.json', JSON.stringify(o) + '\n'); return JSON.stringify({status:o.status, click:o.click, queue:o.queue, ops:o.operatorRows, lastTool:o.lastToolSeq, attempts:o.attempts});" | ./dr.sh real
echo
grep -c "\"workflowRunId\":\"$R\".*soft_injection_returned_to_queue" ../server-real.log
