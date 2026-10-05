#!/bin/bash
# dr.sh <real|real2|fake|fake2> : POST stdin JS body to that driver
case "$1" in real) P=7861;; fake) P=7862;; fake2) P=7863;; real2) P=7864;; esac
curl -s --max-time 175 -X POST --data-binary @- http://127.0.0.1:$P/
