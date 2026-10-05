# outsum15.py <tag-outage.json>... : survivor-tab rules per tab, from the kill until the first `Recovery required` frame.
# VQ13-1: no frame without the room, with the run-level error page, without the queued band, or without the composer.
# VQ14-2: every frame's steering controls (textarea + Stop/Queue/Send now buttons) equal the last pre-kill frame.
#         The connectivity hint (`Failed to load — retrying` + its `Retry` button) and the `restored` marker are not
#         steering controls and are excluded.
# Resume: first successful run/queue GET after `up`, and the first REC frame, both relative to `up`.
import json, sys


def f(k):
    p = k.split('|')
    p += [''] * (12 - len(p))
    return dict(pill=p[0], btns=','.join(b for b in p[2].split(',') if b and b != 'Retry'), ta=p[3], bands=p[4], hint=p[9], rest=p[10])


tot = dict(tabs=0, noroom=0, err=0, noband=0, nocomp=0, ctl=0)
for fn in sys.argv[1:]:
    d = json.load(open(fn))
    kill, up = d['kill'], d['up']
    print(fn, 'down', d['downMs'], 'ms')
    for k, t in sorted(d['tabs'].items()):
        fr = t['frames']
        pre = [x for x in fr if x[0] < kill]
        if not pre:
            print(' ', k, 'NO PRE FRAME')
            continue
        base = f(pre[-1][1])
        rec = next((x[0] for x in fr if x[0] >= kill and f(x[1])['pill'] == 'Recovery required'), None)
        win = [x for x in fr if x[0] >= kill and (rec is None or x[0] < rec)]
        # include the frame in force at the kill
        win = [[kill, pre[-1][1]]] + win
        noroom = sum(1 for x in win if x[1].startswith('NOROOM'))
        err = sum(1 for x in win if 'ERRPAGE' in x[1])
        noband = sum(1 for x in win if not f(x[1])['bands'])
        nocomp = sum(1 for x in win if not f(x[1])['ta'] or not f(x[1])['btns'])
        ctl = [[x[0] - up, x[1]] for x in win if (f(x[1])['ta'], f(x[1])['btns']) != (base['ta'], base['btns'])]
        firstHint = next((x[0] - kill for x in fr if x[0] >= kill and f(x[1])['hint']), None)
        hintOff = next((x[0] - up for x in fr if x[0] >= up and rec and x[0] >= rec and not f(x[1])['hint']), None)
        ok = [n for n in t['net'] if n[0] >= up and isinstance(n[3], int) and n[3] < 500]
        firstOk = ok[0][0] - up if ok else None
        after = [f(x[1]) for x in fr if rec and x[0] >= rec]
        recState = after[0] if after else None
        tot['tabs'] += 1
        tot['noroom'] += noroom
        tot['err'] += err
        tot['noband'] += noband
        tot['nocomp'] += nocomp
        tot['ctl'] += len(ctl)
        print(
            ' ',
            k,
            'pre',
            pre[-1][1][:70],
            '| frames',
            len(win),
            'noroom',
            noroom,
            'err',
            err,
            'noband',
            noband,
            'nocomp',
            nocomp,
            'ctlDiff',
            ctl[:3],
            '| hint +%s' % firstHint,
            'firstOkGET +%s' % firstOk,
            'REC +%s' % (rec - up if rec else None),
            'hintOff +%s' % hintOff,
            '| rec',
            recState and (recState['btns'], recState['ta'], recState['bands'], recState['rest']),
        )
print('TOTAL', tot)
