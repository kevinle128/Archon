# reap.py <rootPid> <seconds> <out.json> [markEpochMs]
# Samples the process tree below <rootPid> every 250 ms (ps, no pattern matching) and records, per descendant PID,
# first/last seen time and a short command label. Command lines are cut to the program name plus 50 chars and any
# token that looks like a key/secret is dropped, so the JSON is safe to keep as evidence.
import json, re, subprocess, sys, time

root, secs, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
mark = int(sys.argv[4]) if len(sys.argv) > 4 else None


def tree():
    rows = subprocess.run(['ps', '-axo', 'pid=,ppid=,command='], capture_output=True, text=True).stdout.splitlines()
    kids, cmd = {}, {}
    for r in rows:
        p = r.split(None, 2)
        if len(p) < 2:
            continue
        pid, ppid = int(p[0]), int(p[1])
        kids.setdefault(ppid, []).append(pid)
        cmd[pid] = p[2] if len(p) > 2 else ''
    seen, st = {}, [root]
    while st:
        x = st.pop()
        for k in kids.get(x, []):
            seen[k] = cmd.get(k, '')
            st.append(k)
    return seen


def label(c):
    toks = [t for t in c.split() if not re.search(r'(key|token|secret|sk-|Bearer)', t, re.I)]
    s = ' '.join(toks)
    s = re.sub(r'/(?:[^/ ]+/)+', '', s)
    return s[:60]


rec = {}
t0 = time.time()
while time.time() - t0 < secs:
    now = int(time.time() * 1000)
    for pid, c in tree().items():
        r = rec.setdefault(pid, {'pid': pid, 'cmd': label(c), 'first': now, 'last': now})
        r['last'] = now
    time.sleep(0.25)
res = sorted(rec.values(), key=lambda r: r['first'])
if mark:
    for r in res:
        r['firstRel'] = r['first'] - mark
        r['lastRel'] = r['last'] - mark
json.dump({'root': root, 'mark': mark, 'start': int(t0 * 1000), 'end': int(time.time() * 1000), 'procs': res}, open(out, 'w'), indent=2)
open(out, 'a').write('\n')
