# vq.py <abandon.json>... : VQ12-1 / VQ12-2 per-frame rules on the rAF frames (t relative to the Abandon POST resolve)
import json,sys
TERM=('Failed','Cancelled','Completed')
def an(fr):
    # fr: [t, "pill|rec|btns|ta|bands|status|al|nc"]
    out={'termNoItem':[], 'runAfterTerm':[], 'recFrames':0, 'firstTerm':None, 'firstNS':None}
    seen=False
    for i,(t,k) in enumerate(fr):
        p=k.split('|'); pill,rec,btns,ta,bands,status,al=p[:7]; nc=int(p[7]) if len(p)>7 and p[7] not in ('','-1') else None
        dur = fr[i+1][0]-t if i+1<len(fr) else 'end'
        if t < -100: continue
        term = pill in TERM or status.startswith('node finished') or status.startswith('node failed') or 'NEVER SENT' in bands
        if term and not seen: seen=True; out['firstTerm']=t
        if 'NEVER SENT' in bands and out['firstNS'] is None: out['firstNS']=t
        if pill in TERM and nc==0: out['termNoItem'].append([t,dur,k])
        if seen and pill=='Running': out['runAfterTerm'].append([t,dur,k])
        if pill=='Recovery required': out['recFrames']+=1
    return out
for f in sys.argv[1:]:
    d=json.load(open(f)); raf=d.get('raf',{})
    g=d.get('gets',[])
    ft={}
    for x in g:
        term = (x['k']=='q' and (x.get('es')=='finished' or x.get('no') not in (None,'ABSENT'))) or (x['k']=='r' and x.get('st') not in ('running','pending','paused'))
        if term and x['s'] not in ft: ft[x['s']]=x['t']
    print(f, 'post', d.get('post'), 'firstTermGET', ft)
    for s in ('c','l'):
        a=an(raf.get(s,[]))
        fr=raf.get(s,[]); rg=[]
        if s in ft:
            for i,(t,k) in enumerate(fr):
                if k.split('|')[0]=='Running' and (i+1<len(fr) and fr[i+1][0]>ft[s]+50): rg.append([t, fr[i+1][0]-t])
            lag=next((t2-ft[s] for t2,k2 in fr if t2>=ft[s] and k2.split('|')[0]!='Running'),None)
        else: lag=None
        print(' ',s,'lagGET->nonRunning',lag if s in ft else None,'runAfterTermGET(>50ms)',rg,'firstTermFrame',a['firstTerm'],'firstNS',a['firstNS'],'termNoItem',a['termNoItem'],'runAfterTerm',a['runAfterTerm'],'recFrames',a['recFrames'])
