#!/bin/bash
cd "$(dirname "$0")"; L=data/fakebatch1.log
for i in $(seq 2 12); do S=$([ $((i % 2)) = 1 ] && echo c || echo l); DL=$([ $((i % 5)) = 0 ] && echo 0 || echo 100); echo "FIN$i $S $DL $(./fin16.sh FIN$i $S $DL)" >> $L; done
for i in $(seq 1 6); do echo "FAB$i $(./fab16.sh FAB$i vq16-fake fake-node)" >> $L; done
for i in $(seq 1 4); do echo "FABL$i $(./fab16.sh FABL$i vq16-fake-loop fake-loop)" >> $L; done
./fl16.sh FLA 6 >> $L 2>&1
./fl16.sh FLB 6 >> $L 2>&1
echo done >> $L
