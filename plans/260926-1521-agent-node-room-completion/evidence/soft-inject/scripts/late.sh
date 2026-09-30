#!/bin/bash
# late.sh <c|l> <TAG>: one late-window attempt on Claude (one tool call, long final message).
cd "$(dirname "$0")"
S=$1; TAG=$2
[ -f .setup-late-done ] || { ./dr.sh < setup-late.js > /dev/null; touch .setup-late-done; }
R=$(./dispatch.sh si-claude-late "go")
echo "return await G.late({R:'$R', s:'$S', tag:'$TAG'});" | ./dr.sh > ../data/$TAG.json
python3 -c "
import json,sys
d=json.load(open('../data/$TAG.json'))
print(d['tag'], d['status'], d['click'], d['queue'], d['operatorRows'], 'lastToolSeq', d['lastToolSeq'], 'attempts', d['attempts'])"
