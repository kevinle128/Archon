# pairs.py : side-by-side pairs, mockup crop on the left and the app room on the right, both scaled to one height.
import os, sys
from PIL import Image
S = os.path.dirname(os.path.abspath(__file__))
M, A, P = S + '/mock', S + '/shots', S + '/pairs'
os.makedirs(P, exist_ok=True)
pairs = []
for sh, full in (('c', 'console'), ('l', 'legacy')):
    for st, app in (('s1', 'CP-s1'), ('s3', 'CP-s3'), ('s4', 'CP-s4'), ('s5', 'CP-s5'), ('s6', 'NAT1-s6')):
        pairs.append((f'{M}/mock-{full}-prompt-{st}.png', f'{A}/app-{full}-{app}.png', f'pair-{full}-{st}.png'))
    for st, app in (('s1', 'CPL-s1'), ('s3', 'CPL-s3'), ('s4', 'CPL-s4'), ('s5', 'CPL-s5')):
        pairs.append((f'{M}/mock-{full}-loop-{st}.png', f'{A}/app-{full}-{app}.png', f'pair-{full}-loop-{st}.png'))
    for st, app in (('s1', 'B-s1'), ('s3', 'B-s3'), ('s4', 'B-s4'), ('s6', 'B-s6'), ('s7', 'I1-s7'), ('s8', 'O7A-s8')):
        pairs.append((f'{M}/mock-{full}-prompt-{st}.png', f'{A}/app-{full}-{app}.png', f'pair-{full}-real-{st}.png' if st != 's8' else f'pair-{full}-s8-recovery.png'))
    for st, app in (('s6', 'cap'), ('s8', 'O7B-s8')):
        pairs.append((f'{M}/mock-{full}-loop-{st}.png', f'{A}/app-{full}-{app}.png', f'pair-{full}-loop-{st}.png'))
made = 0
for m, a, out in pairs:
    if not (os.path.exists(m) and os.path.exists(a)):
        print('missing', os.path.basename(m) if not os.path.exists(m) else '', os.path.basename(a) if not os.path.exists(a) else '')
        continue
    im, ia = Image.open(m).convert('RGB'), Image.open(a).convert('RGB')
    h = 720
    im = im.resize((round(im.width * h / im.height), h))
    ia = ia.resize((round(ia.width * h / ia.height), h))
    c = Image.new('RGB', (im.width + ia.width + 16, h), (40, 40, 48))
    c.paste(im, (0, 0)); c.paste(ia, (im.width + 16, 0))
    c.save(f'{P}/{out}', optimize=True)
    made += 1
print('pairs', made)
