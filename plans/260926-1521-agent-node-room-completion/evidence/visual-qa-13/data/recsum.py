import json,sys
for f in sys.argv[1:]:
    d=json.load(open(f)); print(f,'post',d['post'],d['status'])
    for nm in ('survC','survL','freshC','freshL'):
        fr=d.get(nm,[]); pre=[x for x in fr if x[0]<0]; first=pre[-1][1] if pre else (fr[0][1] if fr else None)
        run=[x for x in fr if x[0]>=-100 and x[1].startswith('Running')]
        # terminal pill with no band item (VQ12-1 shape on recovered nodes)
        empty=[x for x in fr if x[0]>=0 and x[1].split('|')[0] in ('Failed','Cancelled') and x[1].split('|')[1]=='']
        seq=' -> '.join(f"{x[0]}:{x[1]}" for x in fr if x[0]>=-100)[:260]
        print(f"  {nm}: before={first!r} running={len(run)} termNoBand={len(empty)} | {seq}")
