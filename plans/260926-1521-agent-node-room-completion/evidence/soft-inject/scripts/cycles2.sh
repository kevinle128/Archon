#!/bin/bash
# cycles2.sh: ordering re-check, Claude then Grok, both sender shells.
cd "$(dirname "$0")"
for spec in "c c21" "l l21" "c c22" "l l22"; do
  set -- $spec
  ./cyc.sh $1 $2 > /dev/null 2>&1
done
export WF=si-grok-steer NODE=grok-node
for spec in "c gc21" "l gl21"; do
  set -- $spec
  ./cyc.sh $1 $2 > /dev/null 2>&1
done
echo ALLDONE
