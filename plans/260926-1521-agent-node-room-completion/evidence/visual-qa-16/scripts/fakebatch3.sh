#!/bin/bash
cd "$(dirname "$0")"; L=data/fakebatch3.log
./lp16.sh >> $L 2>&1
for x in RC1:30 RC2:-3 RC3:60 RC4:-9; do echo "== ${x%:*} $(./race16.sh ${x%:*} ${x#*:})" >> $L; done
echo done >> $L
