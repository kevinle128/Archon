#!/usr/bin/env python3
"""late16.py <late-*.json>...: late-window checks (item shown nowhere / twice, Stop, never-sent, alert) in both tabs."""
import json
import sys
import importlib.util

spec = importlib.util.spec_from_file_location('a16', __file__.replace('late16.py', 'analyze16.py'))
src = open(spec.origin).read().split('\nfor fn in sys.argv')[0]
ns = {}
exec(src, ns)
for fn in sys.argv[1:]:
    d = json.load(open(fn))
    o = dict(tag=d['tag'], status=d['status'], click=d['click'], queue=d['queue'], ops=d['operatorRows'], lastTool=d['lastToolSeq'])
    for p, fr in d['frames'].items():
        r = ns['shell'](fr, d['clickedAt'], 0)
        o[p] = {k: r[k] for k in ('nowhereGaps', 'twice', 'twoRowCount>1', 'stopMissing', 'never', 'alert', 'twoDeleteAfterResolve', 'twoSendNowAfterResolve', 'firstTwoRow', 'firstSentRow', 'firstDelivered', 'terminal')}
        o[p]['seq'] = r['seq'][:8]
    print(json.dumps(o))
