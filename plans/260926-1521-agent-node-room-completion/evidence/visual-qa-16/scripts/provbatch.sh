#!/bin/bash
cd "$(dirname "$0")"
for x in "$@"; do set -- $(echo $x | tr ':' ' '); echo "== $1 $2 $3 $(date +%H:%M:%S)" >> data/provbatch.log; ./prov16.sh $1 $2 $3 >> data/provbatch.log 2>&1; done
echo done >> data/provbatch.log
