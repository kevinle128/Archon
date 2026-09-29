# finsum.py fin-*.json : VQ12-4 / VQ11-2 per cycle. t relative to the Send now POST resolve.
import json,sys
def live(k):
    p=k.split('|'); b=p[2].split(',') if p[2] else []
    return ('Stop' in b) or ('Queue' in b) or p[4].startswith('SENDING') or ' SENDING' in p[4]
for f in sys.argv[1:]:
    d=json.load(open(f)); sd=d['sd']
    row=[f.split('fin-')[1][:-5], 'sender='+sd, d['status']]
    ft={}
    for g in d.get('gets',[]):
        term=(g['k']=='q' and (g.get('es')=='finished' or g.get('no') not in (None,'ABSENT'))) or (g['k']=='r' and g.get('st') not in ('running','pending','paused'))
        if term and g['s'] not in ft: ft[g['s']]=g['t']
    for s,fr in (('c',d['tc']),('l',d['tl'])):
        comp=next((t for t,k in fr if k.startswith('Completed')),None)
        # last frame with live controls/SENDING
        lastLive=None
        for i,(t,k) in enumerate(fr):
            if live(k): lastLive=fr[i+1][0] if i+1<len(fr) else 'end'
        stale=[[t,k] for t,k in fr if comp is not None and t>=comp and live(k)]
        ns=[[t,k] for t,k in fr if 'NEVER SENT' in k or 'none of this was sent' in k]
        rec=[[t,k] for t,k in fr if '|REC|' in k]
        run_after=[[t,k] for t,k in fr if s in ft and t>ft[s]+16 and k.startswith('Running')]
        row.append(f"{s}: termGET={ft.get(s)} completed={comp} liveEnds={lastLive} staleAfterCompleted={len(stale)} falseNS={len(ns)} rec={len(rec)} runAfterTermGET={len(run_after)}")
    print(' | '.join(row))
