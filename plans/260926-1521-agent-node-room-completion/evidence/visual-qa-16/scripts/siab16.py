#!/usr/bin/env python3
"""siab16.py <siab-*.json>...: after a per-item Send now, a live Abandon while TWO is in flight; per tab, the band / row / never-sent
sequence relative to the Abandon POST and the count of frames where TWO is shown nowhere (NEVER SENT lists count as shown)."""
import json
import sys

for fn in sys.argv[1:]:
    d = json.load(open(fn))
    for p, fr in d['frames'].items():
        seq, last, nowhere = [], None, 0
        for t, k in fr:
            x = k.split('|')
            if len(x) < 11 or t < d['clickedAt']:
                continue
            shown = 'TWO' in x[5] or 'TWO:' in x[6] or x[7] == 'NEVER'
            if not shown and x[1] != '' or (not shown and x[0] in ('Failed', 'Completed')):
                nowhere += 1
            y = (x[0], x[4], x[5], x[6], x[7])
            if y != last:
                seq.append([t - d['abandonAt']] + list(y)); last = y
        print(d['tag'], p, 'q0', d['q0'], 'q1', d['q1'], 'nowhereFrames', nowhere)
        for s in seq[:10]:
            print('    ', s)
