#!/usr/bin/env python3
"""analyze.py <data/TAG.json>: per-cycle metrics from the rAF frame logs (times relative to the Send now click)."""
import json
import sys


def parse(k):
    p = k.split('|')
    if len(p) < 10:
        return None
    return dict(ord=p[10] if len(p) > 10 else '', pill=p[0], btns=p[1], sn=p[2], dl=p[3], header=p[4], band=p[5].split(',') if p[5] else [],
                rows=p[6].split(',') if p[6] else [], never=p[7], intr=p[8], alert=p[9])


def analyze_shell(frames, click):
    fr = [(t - click, parse(k)) for t, k in frames]
    fr = [(t, f) for t, f in fr if f]
    post = [(t, f) for t, f in fr if t >= 0]
    res = {}
    # terminal frame: first post-click frame whose pill is not Running
    term = next((t for t, f in post if f['pill'] in ('Completed', 'Failed', 'Cancelled')), None)
    res['terminalMs'] = term
    live = [(t, f) for t, f in post if term is None or t < term]
    two_in = lambda f: any(b.startswith('TWO') for b in f['band']) or any(r.startswith('TWO:') for r in f['rows'])
    res['firstSentMs'] = next((t for t, f in post if 'TWO:sent' in f['rows']), None)
    res['firstDeliveredMs'] = next((t for t, f in post if 'TWO:delivered' in f['rows']), None)
    res['firstRowAnyMs'] = next((t for t, f in post if any(r.startswith('TWO:') for r in f['rows'])), None)
    # frames after the click where TWO is shown nowhere
    gaps, start = [], None
    for t, f in live:
        if not two_in(f):
            if start is None:
                start = t
        elif start is not None:
            gaps.append(t - start)
            start = None
    if start is not None and live:
        gaps.append(live[-1][0] - start)
    res['nowhereGapsMs'] = gaps
    res['overlapFrames'] = sum(1 for t, f in live if any(b == 'TWO' or b == 'TWO*' for b in f['band']) and any(r.startswith('TWO:') for r in f['rows']))
    res['stopMissingFrames'] = sum(1 for t, f in live if f['pill'] == 'Running' and 'Stop' not in f['btns'])
    res['interruptedFrames'] = sum(1 for t, f in fr if f['intr'])
    res['neverBeforeTerminal'] = sum(1 for t, f in live if f['never'])
    res['oneMissingFrames'] = sum(1 for t, f in live if f['pill'] == 'Running' and not any(b.startswith('ONE') for b in f['band']))
    res['oneSendNowFrames'] = sum(1 for t, f in live if f['pill'] == 'Running' and any(b.startswith('ONE') for b in f['band']) and f['sn'] == '0')
    res['rowAboveToolFrames'] = sum(1 for t, f in post if f['ord'] == 'above')
    res['rowBeforeEchoFrames'] = sum(1 for t, f in post if 'TWO:sent' in f['rows'])
    res['twoRowRegressions'] = 0
    seen_delivered = False
    for t, f in post:
        if 'TWO:delivered' in f['rows']:
            seen_delivered = True
        elif seen_delivered and 'TWO:sent' in f['rows']:
            res['twoRowRegressions'] += 1
    # header sequence
    seq, last = [], None
    for t, f in post:
        h = f['header']
        if h != last:
            seq.append((t, h))
            last = h
    res['headers'] = seq[:8]
    fin = post[-1][1] if post else None
    res['final'] = fin
    return res


def main():
    d = json.load(open(sys.argv[1]))
    out = {k: d[k] for k in ('tag', 'sender', 'observer', 'status', 'click', 'queue', 'rowCount', 'attempts', 'promptRows',
                             'operatorRows', 'ackInAgentText', 'toolRowsAfterInjection') if k in d}
    for shell in ('sender', 'observer'):
        s = d[shell]
        out[shell + 'Shell'] = analyze_shell(d['frames'][s], d['clickedAt'])
    print(json.dumps(out, indent=1))


main()
