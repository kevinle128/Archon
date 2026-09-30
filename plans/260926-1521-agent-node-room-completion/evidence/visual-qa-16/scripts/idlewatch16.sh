#!/bin/bash
# Poll I1/I2 events until both nodes fail; record node_failed timestamps.
cd /private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq16-1790791870/tk
while true; do
  R=$(python3 - <<'PY'
import json,urllib.request
o={}
for tag,r in (('I1','41e1df1db502885e7849e176db138289'),('I2','7c3b58ab27f1d378259043341aa5b17c')):
    q=urllib.request.Request('http://localhost:3455/api/workflows/runs/'+r,headers={'X-Archon-User':'vq16-operator'})
    d=json.load(urllib.request.urlopen(q))
    f=[(e['event_type'],e['created_at'],(e.get('data') or {}).get('error') if isinstance(e.get('data'),dict) else None) for e in d['events'] if e['event_type'] in ('node_failed','workflow_failed')]
    o[tag]=dict(status=d['run']['status'],failed=f)
print(json.dumps(o))
PY
)
  echo "$(date -u +%H:%M:%SZ) $R" >> data/idlewatch.log
  echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if all(v['failed'] for v in d.values()) else 1)" && break
  sleep 20
done
