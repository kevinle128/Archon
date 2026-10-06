#!/bin/bash
# cyc.sh <c|l> <TAG> [shots]: dispatch a Claude run, run one soft-inject cycle, save data/TAG.json, print the analysis.
cd "$(dirname "$0")"
S=$1; TAG=$2; SHOTS=${3:-false}; WF=${WF:-si-claude-steer}; NODE=${NODE:-cl-node}
[ -f .setup-done ] || { ./dr.sh < setup-cycle.js > /dev/null; touch .setup-done; }
R=$(./dispatch.sh $WF "go")
echo "run $R"
echo "return await G.cycle({R:'$R', s:'$S', tag:'$TAG', node:'$NODE', shots:$SHOTS});" | ./dr.sh > ../data/$TAG.json
python3 analyze.py ../data/$TAG.json
