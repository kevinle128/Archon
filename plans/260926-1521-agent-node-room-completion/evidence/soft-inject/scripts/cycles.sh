#!/bin/bash
# cycles.sh: alternating Console/Legacy sender cycles, logs to cycles.log.
cd "$(dirname "$0")"
for n in 02 03 04 05 06; do
  ./cyc.sh c c$n > ../data/c$n.summary.json 2>&1
  ./cyc.sh l l$n > ../data/l$n.summary.json 2>&1
done
echo ALLDONE
