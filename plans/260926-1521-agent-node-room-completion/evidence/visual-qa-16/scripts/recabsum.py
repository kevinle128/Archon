# recabsum.py <tag-recab.json>... : restart-recovered Abandon. Per tab: first terminal frame after the Abandon POST,
# `Running` frames after it, and whether the final frame shows NEVER SENT with the item.
import json, sys
tot = dict(tabs=0, runAfter=0, noTerm=0)
for fn in sys.argv[1:]:
    d = json.load(open(fn))
    for k, fr in sorted(d['tabs'].items()):
        i = next((j for j, x in enumerate(fr) if x[0] > 0 and x[1].split('|')[0] in ('Failed', 'Cancelled', 'Completed')), None)
        ra = sum(1 for x in fr[i:] if x[1].startswith('Running')) if i is not None else None
        tot['tabs'] += 1
        tot['runAfter'] += ra or 0
        tot['noTerm'] += i is None
        print(fn, k, 'firstTerm', fr[i][0] if i is not None else None, 'runAfter', ra, 'final', fr[-1][1].split('|')[0], fr[-1][1].split('|')[4])
print('TOTAL', tot)
