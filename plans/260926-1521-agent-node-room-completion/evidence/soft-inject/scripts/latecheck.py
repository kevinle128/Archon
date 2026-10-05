#!/usr/bin/env python3
"""latecheck.py <data/late*.json>: final server truth for late-window attempts."""
import json
import sys
import urllib.request

H = {'X-Archon-User': 'si-operator'}


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request('http://localhost:3435' + path, headers=H)))


for f in sys.argv[1:]:
    d = json.load(open(f))
    R = d['R']
    run = get(f'/api/workflows/runs/{R}')['run']['status']
    q = get(f'/api/workflows/runs/{R}/nodes/cl-node/queue')['queued']
    m = get(f'/api/workflows/runs/{R}/nodes/cl-node/messages?limit=500')['messages']
    ops = [(x['seq'], x['payload']['text'][:12]) for x in m if (x.get('metadata') or {}).get('origin') == 'operator']
    import analyze_lib
    shells = {p: analyze_lib.analyze_shell(d['frames'][p], d['clickedAt']) for p in d['frames']}
    flags = {p: (x['nowhereGapsMs'], x['neverBeforeTerminal'], x['stopMissingFrames'], x['interruptedFrames']) for p, x in shells.items()}
    alerts = {p: sum(1 for t, k in d['frames'][p] if k.split('|')[9] == 'ALERT') for p in d['frames']}
    print('  frames(gaps,never,stopMissing,intr):', flags, 'alert frames:', alerts)
    print(d['tag'], run, [(e['state'], e['last_error'], e['dispatch_failure_count']) for e in q], ops)
