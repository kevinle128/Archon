#!/bin/bash
# chain3.sh : after chain1 on driver real: real Claude loop boundaries; then, once I2 has failed and chain2 is done, the real outage.
cd "$(dirname "$0")"; L=data/chain3.log
until grep -q '^done' data/chain1.log 2>/dev/null; do sleep 5; done
echo "== rfl $(date +%H:%M:%S)" >> $L; ./rfl16.sh RFL 4 >> $L 2>&1
until grep -q '"I2": {"status": "failed"' data/idlewatch.log && grep -q '^done' data/chain2.log 2>/dev/null; do sleep 5; done
echo "== b2 $(date +%H:%M:%S)" >> $L; DRV=real ./b2_16.sh >> $L 2>&1
echo done >> $L
