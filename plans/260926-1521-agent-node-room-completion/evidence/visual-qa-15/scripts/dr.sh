#!/bin/bash
# dr.sh <real|fake> : POST stdin JS body to that driver
P=$([ "$1" = real ] && echo 7851 || echo 7852)
curl -s --max-time 175 -X POST --data-binary @- http://127.0.0.1:$P/
