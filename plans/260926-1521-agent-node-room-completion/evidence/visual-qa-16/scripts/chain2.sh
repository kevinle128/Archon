#!/bin/bash
# chain2.sh : real-provider matrix continued on driver real2 (serial).
cd "$(dirname "$0")"; L=data/chain2.log
./provbatch.sh gk:vq16-grok:grok-node cl:vq16-claude-steer:cl-node
for x in "srcx vq16-codex codex-node" "sromp vq16-omp omp-node" "srds vq16-deepseek ds-node" "srgk vq16-grok grok-node" "srcl vq16-claude-steer cl-node"; do set -- $x; echo "== $1 $(date +%H:%M:%S)" >> $L; ./sr16.sh $1 $2 $3 >> $L 2>&1; done
echo "== gs $(date +%H:%M:%S)" >> $L; ./gs16.sh >> $L 2>&1
echo "== cxl $(date +%H:%M:%S)" >> $L; ./cxl16.sh >> $L 2>&1
echo done >> $L
