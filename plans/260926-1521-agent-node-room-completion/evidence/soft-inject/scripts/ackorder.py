#!/usr/bin/env python3
"""ackorder.py <data/*.json>: for each cycle, prove the injected token surfaced in agent text BEFORE the drained follow-up turn."""
import glob
import json
import sys
import urllib.request

for f in sorted(sys.argv[1:]):
    if f.endswith('summary.json'):
        continue
    d = json.load(open(f))
    R, tag = d['R'], d['tag']
    node = d.get('node', 'cl-node')
    req = urllib.request.Request(f'http://localhost:3435/api/workflows/runs/{R}/nodes/{node}/messages?limit=500', headers={'X-Archon-User': 'si-operator'})
    m = json.load(urllib.request.urlopen(req))
    rows = m.get('messages') or m.get('items') or []
    op = [r for r in rows if (r.get('metadata') or {}).get('origin') == 'operator']
    two = next(r for r in op if 'TWO' in r['payload'].get('text', ''))
    ones = [r for r in op if 'ONE' in r['payload'].get('text', '')]
    ack = [r for r in rows if r['kind'] == 'text' and (r.get('metadata') or {}).get('origin') not in ('operator', 'prompt') and 'ACK_' + tag in json.dumps(r['payload'])]
    first = min((r['seq'] for r in ack), default=None)
    one_seq = ones[0]['seq'] if ones else None
    print(tag, 'TWOrow', two['seq'], 'firstAckAgentText', first, 'ONErow', one_seq, 'ackBeforeFollowUpTurn', (first is not None and (one_seq is None or first < one_seq)))
