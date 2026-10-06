#!/bin/bash
cd "$(dirname "$0")"; L=data/fakebatch2.log
echo "== NAT1 $(./nat16.sh NAT1)" >> $L
echo "== NAT2 $(./nat16.sh NAT2)" >> $L
echo "== cap $(./cap16.sh)" >> $L
echo "== o7 $(./o716.sh)" >> $L
echo done >> $L
