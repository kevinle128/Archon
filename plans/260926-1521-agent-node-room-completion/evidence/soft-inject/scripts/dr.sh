#!/bin/bash
# dr.sh: POST the JS body on stdin to the driver (retries while it is busy).
b=$(cat)
for i in $(seq 1 90); do
  o=$(printf "%s" "$b" | curl -s --max-time 175 -X POST --data-binary @- http://127.0.0.1:7871/)
  [ "$o" != busy ] && { echo "$o"; exit 0; }
  sleep 2
done
