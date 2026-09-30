#!/bin/bash
# dispatch.sh <workflow> <message>: dispatch over HTTP on the scratch server; prints the new run id.
P=3435; WF=$1; MSG=$2; H='X-Archon-User: si-operator'
CB=9789fa692a91f055da3cfa6cd25065c0
before=$(curl -s "localhost:$P/api/workflows/runs?limit=50" -H "$H" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('runs',d); print(' '.join(x['id'] for x in r))")
CONV=$(curl -s -X POST localhost:$P/api/conversations -H 'Content-Type: application/json' -H "$H" -d "{\"codebaseId\":\"$CB\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['conversationId'])")
curl -s -X POST "localhost:$P/api/workflows/$WF/run" -H 'Content-Type: application/json' -H "$H" -d "$(python3 -c "import json,sys; print(json.dumps(dict(conversationId=sys.argv[1],message=sys.argv[2])))" "$CONV" "$MSG")" > /dev/null
for i in $(seq 1 60); do
  id=$(curl -s "localhost:$P/api/workflows/runs?limit=50" -H "$H" | python3 -c "
import json,sys; d=json.load(sys.stdin); r=d.get('runs',d); b=set(sys.argv[1].split())
n=[x for x in r if x['id'] not in b and x.get('workflow_name')==sys.argv[2]]
print(n[0]['id'] if n else '')" "$before" "$WF")
  [ -n "$id" ] && { echo $id; exit 0; }; sleep 0.5
done; echo "NORUN"; exit 1
