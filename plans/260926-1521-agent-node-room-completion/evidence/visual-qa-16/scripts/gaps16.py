#!/usr/bin/env python3
"""gaps16.py <si-*.json>...: print the frames around each live frame (after the dock loaded) where item TWO is shown nowhere."""
import json
import sys

for fn in sys.argv[1:]:
    d = json.load(open(fn)); c = d['clickedAt']
    for role, key in (('s', d['sender']), ('o', d['observer']), ('x', 'x')):
        fr = d['frames'].get(key) or []
        docked = False
        for i, (t, k) in enumerate(fr):
            p = k.split('|')
            if len(p) < 7:
                continue
            docked = docked or bool(p[1])
            if docked and t - c > 0 and p[0] == 'Running' and 'TWO' not in p[5] and 'TWO:' not in p[6]:
                nxt = fr[i + 1][0] - t if i + 1 < len(fr) else None
                print(d['tag'], role, 'gap at', t - c, 'ms, lasts', nxt, 'ms | prev:', fr[i - 1][1][:70], '| this:', k[:70], '| next:', fr[i + 1][1][:80] if i + 1 < len(fr) else '')
