# ordsum.py <tag-messages.json>... : redirect order per provider (operator row, then the reply carrying its ACK token), and
# raw text rows by origin vs distinct block ids / contiguous spans.
import json, re, sys
for fn in sys.argv[1:]:
    ms = json.load(open(fn))
    seq = []
    for m in ms:
        if m['kind'] != 'text':
            continue
        meta = m.get('meta') or {}
        t = m['payload'].get('text') or ''
        if meta.get('origin') == 'operator':
            seq.append('OP:' + (re.findall(r'\b\w+-c\d\b|\bOP \S+', t) or [t[:12]])[0])
        else:
            for a in re.findall(r'\b[a-z0-9]+-c\dACK\b', t):
                seq.append('ACK:' + a)
    txt = [m for m in ms if m['kind'] == 'text' and (m.get('meta') or {}).get('origin') not in ('operator', 'prompt')]
    think = [m for m in txt if (m.get('meta') or {}).get('origin') == 'thinking']
    asst = [m for m in txt if (m.get('meta') or {}).get('origin') != 'thinking']
    bid = lambda L: len({(m.get('meta') or {}).get('block_id') for m in L if (m.get('meta') or {}).get('block_id')})
    print(fn.split('/')[-1], 'order', seq, '| raw assistant', len(asst), 'blocks', bid(asst), '| raw thinking', len(think), 'blocks', bid(think))
