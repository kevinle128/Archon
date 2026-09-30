#!/usr/bin/env python3
"""analyze16.py <data/si-*.json>...: per-cycle soft-inject checks from the rAF frames of the sender (s), observer (o) and
cold-join (x) tabs. Times are relative to the per-item Send now click. Band items carry flags: * sending…, x has delete,
s has its own Send now."""
import json
import sys


def parse(k):
    p = k.split('|')
    if len(p) < 11:
        return None
    return dict(pill=p[0], btns=p[1], sn=int(p[2]), dl=int(p[3]), header=p[4], band=[b for b in p[5].split(',') if b],
                rows=[r for r in p[6].split(',') if r], never=p[7], intr=p[8], alert=p[9], ord=p[10], focus=p[11] if len(p) > 11 else '')


def shell(frames, click, resolved, cold=False):
    fr = [(t - click, parse(k)) for t, k in frames]
    fr = [(t, f) for t, f in fr if f]
    if cold:
        # A cold-join tab is judged from its first frame with dock controls (the accepted first-load band pop-in).
        i = next((i for i, (t, f) in enumerate(fr) if f['btns']), len(fr))
        r0 = {'dockAt': round(fr[i][0]) if i < len(fr) else None, 'preDockFrames': [(round(t), f['btns'], f['band']) for t, f in fr[:i]]}
        fr = fr[i:]
    else:
        r0 = {}
    post = [(t, f) for t, f in fr if t >= 0]
    term = next((t for t, f in post if f['pill'] in ('Completed', 'Failed', 'Cancelled')), None)
    live = [(t, f) for t, f in post if (term is None or t < term) and f['pill'] == 'Running']
    two_band = lambda f: [b for b in f['band'] if b.startswith('TWO')]
    two_row = lambda f: [r for r in f['rows'] if r.startswith('TWO:')]
    one_band = lambda f: [b for b in f['band'] if b.startswith('ONE')]
    r = dict(r0)
    gaps, start = [], None
    for t, f in live:
        if not two_band(f) and not two_row(f):
            start = t if start is None else start
        elif start is not None:
            gaps.append(round(t - start)); start = None
    if start is not None:
        gaps.append('open@%d' % start)
    r['nowhereGaps'] = gaps
    r['twice'] = sum(1 for t, f in live if two_band(f) and two_row(f))
    r['twoRowCount>1'] = sum(1 for t, f in post if len(two_row(f)) > 1)
    r['stopMissing'] = sum(1 for t, f in live if 'Stop' not in f['btns'])
    r['intr'] = sum(1 for t, f in fr if f['intr'])
    r['never'] = sum(1 for t, f in post if f['never'])
    r['alert'] = sum(1 for t, f in post if f['alert'])
    # withdraw / second Send now offered on the in-flight item after the POST resolved
    r['twoDeleteAfterResolve'] = sum(1 for t, f in live if t > resolved and any('x' in b[3:] for b in two_band(f)))
    r['twoSendNowAfterResolve'] = sum(1 for t, f in live if t > resolved and any('s' in b[3:] for b in two_band(f)))
    # item 1 stays queued with its own controls until the injected turn ends (it may drain once item 2 is delivered)
    first_row = next((t for t, f in post if two_row(f)), None)
    first_deliv = next((t for t, f in post if 'TWO:delivered' in f['rows']), None)
    first_sent = next((t for t, f in post if 'TWO:sent' in f['rows']), None)
    r['firstTwoRow'] = first_row; r['firstSentRow'] = first_sent; r['firstDelivered'] = first_deliv
    one_gone = next((t for t, f in live if not one_band(f)), None)
    r['oneLeftBandAt'] = one_gone
    r['oneWithoutControls'] = sum(1 for t, f in live if one_band(f) and not any(('x' in b[3:] and 's' in b[3:]) or '*' in b for b in one_band(f)))
    r['bodyFocusFrames'] = sum(1 for t, f in post if f['focus'] == 'BODY')
    r['focusSeq'] = [x for i, x in enumerate([f['focus'] for t, f in post]) if i == 0 or x != [f['focus'] for t, f in post][i - 1]][:8]
    r['rowAboveTool'] = sum(1 for t, f in post if f['ord'] == 'above')
    seen = False; reg = 0
    for t, f in post:
        if 'TWO:delivered' in f['rows']:
            seen = True
        elif seen and 'TWO:sent' in f['rows']:
            reg += 1
    r['deliveredRegress'] = reg
    seq, last = [], None
    for t, f in post:
        h = (f['header'], ','.join(f['band']), ','.join(f['rows']))
        if h != last:
            seq.append([round(t)] + list(h)); last = h
    r['seq'] = seq[:14]
    r['terminal'] = term
    r['first'] = round(fr[0][0]) if fr else None
    return r


for fn in sys.argv[1:]:
    d = json.load(open(fn))
    click = d['clickedAt']; res = d['click']['resolvedMs']
    out = dict(tag=d['tag'], status=d['status'], click=d['click'], queue=d['queue'], ops=d['operatorRows'],
               ack=d['ackInAgentText'], attempts=len(d['attempts']), prompts=d['promptRows'])
    for role, key in (('s', d['sender']), ('o', d['observer']), ('x', 'x')):
        if key in d['frames']:
            out[role] = shell(d['frames'][key], click, res, role == 'x')
    print(json.dumps(out))
