# reapsum.py <reap.json> <markMs> <windowSec> : per descendant of the server, how long after <markMs> it was last seen; `alive` = still
# present at the end of the sampling window (window end - mark shown).
import json, sys
d = json.load(open(sys.argv[1])); mark = int(sys.argv[2])
start = min(p['first'] for p in d['procs']) if d['procs'] else mark
end = start + int(float(sys.argv[3]) * 1000) - 250
print(sys.argv[1].split('/')[-1], 'sampler start %+d ms, window to +%d ms' % (start - mark, end - mark))
for p in d['procs']:
    if p['first'] > start + 300:
        continue
    gone = p['last'] < end - 300
    print('   %-7s %-62s %s' % (p['pid'], p['cmd'][:62], ('gone by +%d ms' % (p['last'] - mark + 250)) if gone else 'ALIVE at window end'))
