#!/usr/bin/env python3
"""orderseq.py <data/*.json>: the injected operator row must follow every row of the tool that was running at the click."""
import json
import sys
import urllib.request

for f in sys.argv[1:]:
    d = json.load(open(f))
    R, tag = d['R'], d['tag']
    node = d.get('node', 'cl-node')
    req = urllib.request.Request(
        f'http://localhost:3435/api/workflows/runs/{R}/nodes/{node}/messages?limit=500',
        headers={'X-Archon-User': 'si-operator'},
    )
    rows = json.load(urllib.request.urlopen(req)).get('messages') or []
    two = next(r for r in rows if (r.get('metadata') or {}).get('origin') == 'operator' and 'TWO' in r['payload'].get('text', ''))
    tools = [r for r in rows if r['kind'] == 'tool']
    first_id = tools[0]['payload'].get('id')
    first = [r['seq'] for r in tools if r['payload'].get('id') == first_id]
    print(tag, 'TWO seq', two['seq'], 'first tool rows', first, 'ok', max(first) < two['seq'])
