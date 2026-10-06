#!/bin/bash
# sibatch.sh <real|fake> <prefix> <from> <to> : consecutive per-item Send now cycles, sender alternating, cold join alternating 1.5 s / 12 s.
cd "$(dirname "$0")"
for i in $(seq $3 $4); do
  n=$(printf "%02d" $i); S=$([ $((i % 2)) = 1 ] && echo c || echo l); C=$([ $((i % 4)) -lt 2 ] && echo 1500 || echo 12000)
  ./cyc16.sh $1 $S $2$n $C >> data/sibatch-$2.log 2>&1
done
echo done >> data/sibatch-$2.log
