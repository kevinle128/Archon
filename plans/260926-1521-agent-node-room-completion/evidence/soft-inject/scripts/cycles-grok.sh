#!/bin/bash
# cycles-grok.sh: Grok ACP soft-inject cycles, alternating Console/Legacy sender.
cd "$(dirname "$0")"
export WF=si-grok-steer NODE=grok-node
for spec in "c gc01" "l gl01" "c gc02" "l gl02"; do
  set -- $spec
  ./cyc.sh $1 $2 > ../data/$2.summary.json 2>&1
done
echo ALLDONE
