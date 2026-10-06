#!/bin/bash
cd "$(dirname "$0")"
for x in "$@"; do T=${x%:*}; S=${x#*:}; echo "== $T $S $(date +%H:%M:%S)" >> data/outbatch.log; ./out16.sh $T $S >> data/outbatch.log 2>&1; done
echo done >> data/outbatch.log
