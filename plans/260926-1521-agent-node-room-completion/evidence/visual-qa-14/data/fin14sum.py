# fin14sum.py fin-*.json : sender-shell rule. After the first terminal frame in either shell, the sender shell may not
# start a frame with Stop / Queue / SENDING later than +100 ms. Also: false Never-sent, recovery frames, EventSource churn.
import json,sys
TERM=('Completed','Failed')
rows=[]
for f in sys.argv[1:]:
    d=json.load(open(f)); sd=d['sd']
    def ft(a):
        x=next((t for t,k in a if k.split('|')[0] in TERM),None); return x
    tc,tl=d['tc'],d['tl']; fc,fl=ft(tc),ft(tl)
    first=min([x for x in (fc,fl) if x is not None],default=None)
    snd=tc if sd=='c' else tl
    live=[]; lastLive=None
    for i,(t,k) in enumerate(snd):
        p=k.split('|'); btns=p[2]; bands=p[4]
        isLive=('Stop' in btns.split(',') or 'Queue' in btns.split(',') or bands.startswith('SENDING'))
        if isLive: lastLive=(t, snd[i+1][0] if i+1<len(snd) else 'end')
        if first is not None and isLive and t>first+100: live.append([t,k])
    endLive = lastLive[1] if lastLive else None
    ns=sum(1 for t,k in d['c']+d['l'] if 'NEVER SENT' in k or 'none of this was sent' in k)
    rec=sum(1 for t,k in tc+tl if '|REC|' in k)
    es={s:[x for x in d.get('es',{}).get(s,[]) if x[0]>-15000 and x[1]!='new' or (x[1]=='new' and x[0]>-15000)] for s in ('c','l')}
    esErr={s:len([x for x in d.get('es',{}).get(s,[]) if x[1]=='error' and x[0]>-12000]) for s in ('c','l')}
    rows.append(dict(tag=f.split('fin-')[1][:-5],sd=sd,dl=d.get('dl'),status=d['status'],termC=fc,termL=fl,senderLiveEnds=endLive,lateLive=len(live),falseNS=ns,rec=rec,esErr=esErr,q=[x['state'] for x in d['q']]))
for r in rows: print(r)
print('cycles',len(rows),'lateLive>0:',sum(1 for r in rows if r['lateLive']),'falseNS:',sum(r['falseNS'] for r in rows),'rec:',sum(r['rec'] for r in rows))
