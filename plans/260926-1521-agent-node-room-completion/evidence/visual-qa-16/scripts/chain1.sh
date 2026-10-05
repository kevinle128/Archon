#!/bin/bash
# chain1.sh : after the Grok cycles, on driver real: B run, retry, deny.
cd "$(dirname "$0")"; L=data/chain1.log
until grep -q '^done' data/sibatch-GKS.log; do sleep 5; done
for s in b16 retry16 deny16; do echo "== $s $(date +%H:%M:%S)" >> $L; DRV=real ./$s.sh >> $L 2>&1; done
echo done >> $L
