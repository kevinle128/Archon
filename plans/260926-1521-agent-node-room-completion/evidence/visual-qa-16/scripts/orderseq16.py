#!/usr/bin/env python3
"""orderseq16.py <port> <si-*.json>...: server order per cycle. The injected operator row (TWO) must follow every row of the
tool that was running at the click; the ACK reply must follow TWO in the same attempt and precede the drained ONE row."""
import json
import sys
import urllib.request

port = sys.argv[1]


def get(path):
    req = urllib.request.Request(f'http://localhost:{port}{path}', headers={'X-Archon-User': 'vq16-operator'})
    return json.load(urllib.request.urlopen(req))


tot = dict(cycles=0, rowAfterTool=0, ackBetween=0)
for fn in sys.argv[2:]:
    d = json.load(open(fn))
    R, tag, node = d['R'], d['tag'], d.get('node', 'cl-node')
    rows = get(f'/api/workflows/runs/{R}/nodes/{node}/messages?limit=500').get('messages') or []
    op = lambda s: next((r for r in rows if (r.get('metadata') or {}).get('origin') == 'operator' and s in json.dumps(r['payload'])), None)
    two, one = op(f'{tag} TWO'), op(f'{tag} ONE')
    tools = [r for r in rows if r['kind'] == 'tool']
    # the tool running at the click: the last tool whose first row precedes TWO
    before = [r for r in tools if two and r['seq'] < two['seq']]
    tid = before[-1]['payload'].get('id') if before else None
    trows = [r['seq'] for r in tools if r['payload'].get('id') == tid]
    ack = [r['seq'] for r in rows if r['kind'] == 'text' and (r.get('metadata') or {}).get('origin') not in ('operator', 'prompt') and f'ACK_{tag}' in json.dumps(r['payload'])]
    ok1 = bool(two and trows and max(trows) < two['seq'])
    ok2 = bool(two and one and ack and two['seq'] < ack[0] < one['seq'])
    tot['cycles'] += 1; tot['rowAfterTool'] += ok1; tot['ackBetween'] += ok2
    print(tag, 'TWO', two and two['seq'], 'runningToolRows', trows, 'ACK', ack[:2], 'ONE', one and one['seq'], 'rowAfterTool', ok1, 'ackSameTurnBeforeONE', ok2)
print(tot)
