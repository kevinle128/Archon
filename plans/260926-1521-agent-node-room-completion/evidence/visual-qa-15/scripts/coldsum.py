# coldsum.py <tag-cold.json>... : VQ13-2 cold loads of restart-recovered nodes. No frame may show a textarea or a
# Stop / Queue / Send now control before `Recovery required`; report the frame sequence and the REC time.
import json, sys
tot = dict(loads=0, bad=0)
for fn in sys.argv[1:]:
    d = json.load(open(fn))
    for k, fr in sorted(d.items()):
        rec = next((t for t, x in fr if x.startswith('Recovery required')), None)
        bad = [[t, x[:60]] for t, x in fr if (rec is None or t < rec) and (x.split('|')[3] or any(b in ('Stop', 'Queue', 'Send now') for b in x.split('|')[2].split(',')))]
        seq = []
        for t, x in fr:
            p = x.split('|')
            s = p[0] + ('+dock' if p[3] or p[2].replace('Retry', '').strip(',') else '') + ('+' + p[4] if p[4] else '') + ('+REST' if len(p) > 10 and p[10] else '')
            if not seq or seq[-1][1] != s:
                seq.append([t, s])
        tot['loads'] += 1
        tot['bad'] += len(bad)
        print(fn, k, 'REC at', rec, 'bad', bad, 'seq', seq)
print('TOTAL', tot)
