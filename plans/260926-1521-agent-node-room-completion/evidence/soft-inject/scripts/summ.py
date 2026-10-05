#!/usr/bin/env python3
"""summ.py <prefix> <data/*.json cycle files>: one row per cycle from the analyzer, plus totals."""
import json
import subprocess
import sys
import os

here = os.path.dirname(os.path.abspath(__file__))
rows = []
for path in sys.argv[1:]:
    if path.endswith('.summary.json'):
        continue
    out = subprocess.run([sys.executable, os.path.join(here, 'analyze.py'), path], capture_output=True, text=True).stdout
    try:
        rows.append(json.loads(out))
    except Exception:
        print('unparsable', path)
hdr = ['tag', 'st', 'click', 'attempts', 'prompt', 'ack', 'toolsAfter', 'q(TWO)', 'shell', 'row', 'sent', 'deliv', 'gaps', 'ovl', 'stopMiss', 'intr', 'never', 'regr', 'above', 'sentRow']
print('\t'.join(hdr))
bad = 0
for r in rows:
    qtwo = [s for m, s in r['queue'] if 'TWO' in m]
    for sh in ('senderShell', 'observerShell'):
        x = r[sh]
        line = [r['tag'], r['status'], str(r['click']['status']), str(len(r['attempts'])), str(r['promptRows']), str(r['ackInAgentText']), str(r['toolRowsAfterInjection']),
                ','.join(qtwo), sh[:3], str(x['firstRowAnyMs']), str(x['firstSentMs']), str(x['firstDeliveredMs']), str(x['nowhereGapsMs']), str(x['overlapFrames']),
                str(x['stopMissingFrames']), str(x['interruptedFrames']), str(x['neverBeforeTerminal']), str(x['twoRowRegressions']), str(x['rowAboveToolFrames']), str(x['rowBeforeEchoFrames'])]
        print('\t'.join(line))
        if x['stopMissingFrames'] or x['interruptedFrames'] or x['neverBeforeTerminal'] or x['overlapFrames'] or x['twoRowRegressions'] or x['nowhereGapsMs'] or x['rowAboveToolFrames']:
            bad += 1
    if len(r['attempts']) != 1 or r['promptRows'] != 1 or r['ackInAgentText'] < 1 or qtwo != ['delivered']:
        bad += 1
print('cycles', len(rows), 'flagged', bad)
