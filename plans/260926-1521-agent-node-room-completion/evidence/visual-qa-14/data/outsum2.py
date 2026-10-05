# outsum2.py <tag>-outage.json... : one row per survivor tab.
# key = ROOM|pill|band|TA|Q|stop/send|HINT|ERRPAGE|rows|REST
import json,sys
tot=dict(tabs=0,errpage=0,noroom=0,noband=0,nocomposer=0,newLive=0)
for f in sys.argv[1:]:
    d=json.load(open(f)); K,U=d['kill'],d['up']
    print(f,'outage %.1f s'%((U-K)/1000))
    for k,v in d.items():
        if not isinstance(v,dict) or 'frames' not in v: continue
        fr=v['frames']; P=lambda x:x.split('|')
        rest=next((t for t,x in fr if t>=K and P(x)[-1]=='REST'),None)
        endw=rest if rest else fr[-1][0]
        c=dict(errpage=0,noroom=0,noband=0,nocomposer=0)
        pre=[x for t,x in fr if t<K]; last_pre=pre[-1] if pre else None
        seq=([(K,last_pre)] if last_pre else [])+[(t,x) for t,x in fr if t>=K]
        for i,(t,x) in enumerate(seq):
            if t>endw: break
            p=P(x)
            if p[7]=='ERRPAGE': c['errpage']+=1
            if p[0]=='NOROOM': c['noroom']+=1; continue
            if p[-1]=='REST': continue
            if p[2]=='': c['noband']+=1
            if p[3]=='': c['nocomposer']+=1
        newLive=[]
        for i,(t,x) in enumerate(fr):
            if t>=U and (rest is None or t<rest) and (P(x)[4]=='Q' or P(x)[5] in('Stop',)):
                newLive.append((t-U,(fr[i+1][0] if i+1<len(fr) else t)-t,'|'.join(P(x)[1:6])))
        hintOn=next((t-K for t,x in fr if t>=K and P(x)[6]=='HINT'),None)
        hintOff=next((t-U for t,x in fr if t>=U and P(x)[6]!='HINT'),None) if hintOn is not None else None
        net=v['net']; firstOk=next((t-U for t,m,u,st in net if t>=U and st==200),None)
        tot['tabs']+=1
        for kk in c: tot[kk]+=1 if c[kk] else 0
        tot['newLive']+=1 if newLive else 0
        print('  %-6s viol=%s hint on +%s (kill) off +%s (up) | firstOkGET +%s | REST +%s (up) | post-up live frames before REST %s'%(k,c,hintOn,hintOff,firstOk,(rest-U) if rest else None,newLive))
    fl=d.get('firstLoad')
    if fl:
        for s,x in zip(('c','l'),fl):
            e=next((t for t,y in x if 'ERRPAGE' in y),None); room=[y for t,y in x if y.startswith('ROOM')]
            print('  firstLoad',s,'errpage at',e,'room frames',len(room),'last',x[-1] if x else None)
print('TOTAL tabs with violation',tot)
