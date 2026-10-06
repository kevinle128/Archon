#!/bin/bash
# cycles3.sh: final live pass on the finished code: late window (both shells), then ordering on Claude and Grok.
cd "$(dirname "$0")"
./late.sh c late5 > ../data/late5.out 2>&1
./late.sh l late6 > ../data/late6.out 2>&1
for spec in "c c31" "l l31"; do
  set -- $spec
  ./cyc.sh $1 $2 > /dev/null 2>&1
done
export WF=si-grok-steer NODE=grok-node
for spec in "c gc31" "l gl31"; do
  set -- $spec
  ./cyc.sh $1 $2 > /dev/null 2>&1
done
echo ALLDONE
