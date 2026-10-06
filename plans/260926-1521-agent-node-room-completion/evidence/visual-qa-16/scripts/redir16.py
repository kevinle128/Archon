#!/usr/bin/env python3
"""redir16.py <tag>...: operator rows and ACK tokens in server order for the provider matrix runs (data/<tag>-messages.json)."""
import json
import re
import sys

for tag in sys.argv[1:]:
    m = json.load(open(f'data/{tag}-messages.json'))
    seq = []
    for r in m:
        meta = r.get('meta') or {}
        if r['kind'] == 'text':
            t = r['payload'].get('text', '')
            if meta.get('origin') == 'operator':
                x = re.search(r'OP (\S+?):', t)
                seq.append('OP ' + (x.group(1) if x else t[:14]))
            else:
                for a in re.findall(r'(%s-c\d+b?ACK)' % re.escape(tag), t):
                    seq.append(a)
    blocks, rows = {}, {}
    for r in m:
        meta = r.get('meta') or {}
        if r['kind'] == 'text' and meta.get('origin') not in ('operator', 'prompt'):
            k = 'thinking' if meta.get('origin') == 'thinking' else 'assistant'
            blocks.setdefault(k, set()).add(meta.get('block_id') or r['seq'])
            rows[k] = rows.get(k, 0) + 1
    print(tag, ' -> '.join(seq))
    print('   raw text rows per kind', rows, 'distinct blocks', {k: len(v) for k, v in blocks.items()})
