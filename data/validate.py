"""Integrity checks for data/data.json.

Exit 0 when there are no structural errors. Same-name pairs and other
informational notes are warnings and do not fail the process.

    python3 data/validate.py
    python3 data/validate.py path/to/data.json
"""
import collections
import datetime
import json
import os
import re
import sys
import unicodedata

def data_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    beside = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
    if os.path.exists(beside):
        return beside
    return 'data.json'

with open(data_path(), encoding='utf-8') as fh:
    d = json.load(fh)

P = {p['id']: p for p in d['people']}
Fm = {f['id']: f for f in d['families']}
S = {s['id']: s for s in d['sources']}
errs = []
warn = []
NOTE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$')

for kind, lst in (
    ('people', d['people']),
    ('families', d['families']),
    ('sources', d['sources']),
    ('leads', d['researchLeads']),
    ('excluded', d['excluded']),
):
    c = collections.Counter(x['id'] for x in lst)
    errs += [f'duplicate {kind} id {k}' for k, v in c.items() if v > 1]

def need(i, ctx, pool):
    if i is not None and i not in pool:
        errs.append(f'{ctx}: missing {i}')

def walk(ctx, o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('sourceIds',):
                [need(x, ctx, S) for x in v]
            elif k == 'source' and isinstance(v, str):
                need(v, ctx, S)
            else:
                walk(ctx, v)
    elif isinstance(o, list):
        [walk(ctx, v) for v in o]

def check_human_verified(hv, ctx):
    if not isinstance(hv, dict):
        errs.append(f'{ctx}: humanVerified must be an object')
        return
    extra = set(hv) - {'by', 'date', 'comment'}
    if extra:
        errs.append(f'{ctx}: humanVerified has unknown fields {sorted(extra)}')
    by = hv.get('by')
    if not isinstance(by, str) or not by.strip():
        errs.append(f'{ctx}: humanVerified.by must be a non-empty string')
    date = hv.get('date')
    if not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        errs.append(f'{ctx}: humanVerified.date must be YYYY-MM-DD')
    else:
        y, m, day = (int(x) for x in date.split('-'))
        try:
            datetime.date(y, m, day)
        except ValueError:
            errs.append(f'{ctx}: humanVerified.date is not a real date')
    if 'comment' in hv and not isinstance(hv['comment'], str):
        errs.append(f'{ctx}: humanVerified.comment must be a string')

CORRECTION_KINDS = {'Correction', 'Clarifying note', 'Wrong person linked', 'Other'}
CORRECTION_STATUS = {'applied', 'declined'}

def check_corrections(items, ctx):
    if not isinstance(items, list):
        errs.append(f'{ctx}: corrections must be an array')
        return
    for i, item in enumerate(items):
        c = f'{ctx} corrections[{i}]'
        if not isinstance(item, dict):
            errs.append(f'{c}: must be an object')
            continue
        extra = set(item) - {'by', 'date', 'kind', 'comment', 'status', 'resolution'}
        if extra:
            errs.append(f'{c}: unknown fields {sorted(extra)}')
        if not isinstance(item.get('by'), str) or not item.get('by').strip():
            errs.append(f'{c}: by must be a non-empty string')
        date = item.get('date')
        if not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            errs.append(f'{c}: date must be YYYY-MM-DD')
        else:
            y, m, day = (int(x) for x in date.split('-'))
            try:
                datetime.date(y, m, day)
            except ValueError:
                errs.append(f'{c}: date is not a real date')
        if item.get('kind') not in CORRECTION_KINDS:
            errs.append(f'{c}: kind must be one of {sorted(CORRECTION_KINDS)}')
        if not isinstance(item.get('comment'), str) or not item.get('comment').strip():
            errs.append(f'{c}: comment must be a non-empty string')
        if item.get('status') not in CORRECTION_STATUS:
            errs.append(f'{c}: status must be applied or declined')
        if not isinstance(item.get('resolution'), str) or not item.get('resolution').strip():
            errs.append(f'{c}: resolution must be a non-empty string')

seen_notes = {}
for p in d['people']:
    for x in p['parents'] + p['spouses']:
        need(x, p['id'], P)
    for l in p['parentLinks']:
        need(l['id'], p['id'], P)
        need(l['familyId'], p['id'], Fm)
    for x in p.get('familyIds', []):
        need(x, p['id'], Fm)
    walk(p['id'], p)
    if len(set(p['parents'])) != len(p['parents']):
        errs.append(f'{p["id"]} parents repeated (in 2 families?)')
    for i, n in enumerate(p['notes']):
        if n['status'] not in ('verified', 'probable', 'proposed', 'open', 'excluded'):
            errs.append(f'{p["id"]} bad note status {n["status"]}')
        nid = n.get('id')
        ctx = f'{p["id"]} notes[{i}]'
        if not isinstance(nid, str) or not NOTE_ID.fullmatch(nid):
            errs.append(f'{ctx}: missing or invalid id (use {p["id"]}-n{i}; do not renumber existing ids)')
        elif nid in seen_notes:
            errs.append(f'duplicate note id {nid} on {p["id"]} and {seen_notes[nid]}')
        else:
            seen_notes[nid] = p['id']
        if 'humanVerified' in n:
            check_human_verified(n['humanVerified'], f'{ctx} ({nid})')
        if 'corrections' in n:
            check_corrections(n['corrections'], f'{ctx} ({nid})')

for f in d['families']:
    need(f['husband'], f['id'], P)
    need(f['wife'], f['id'], P)
    for c in f['children']:
        need(c, f['id'], P)
    walk(f['id'], f)

for s in d['sources']:
    for x in s['personIds'] + s.get('candidatePersonIds', []):
        need(x, s['id'], P)
    if 'humanVerified' in s:
        check_human_verified(s['humanVerified'], f'{s["id"]} humanVerified')
    if 'corrections' in s:
        check_corrections(s['corrections'], f'{s["id"]}')

for l in d['researchLeads']:
    [need(x, l['id'], P) for x in l['personIds']]
for e in d['excluded']:
    [need(x, e['id'], P) for x in e['relatedPersonIds']]

# orphans
inf = set()
for f in d['families']:
    inf |= {f['husband'], f['wife'], *f['children']}
insrc = set(x for s in d['sources'] for x in s['personIds'])
for pid in P:
    if pid not in inf and pid not in insrc:
        errs.append(f'orphan person {pid}')
    elif pid not in inf:
        warn.append(f'person not in any family (source only): {pid}')
    if not P[pid]['sourceIds']:
        warn.append(f'person with no sources: {pid}')
cited = set(x for p in d['people'] for x in p['sourceIds']) | set(
    f['marriage']['source'] for f in d['families'] if f['marriage']['source']
)
for sid, s in S.items():
    if sid not in cited and not s['personIds']:
        errs.append(f'orphan source {sid}')
    if not s.get('url'):
        warn.append(f'source without url: {sid}')

def norm(t):
    return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower())

key = collections.defaultdict(list)
for p in d['people']:
    y = re.search(r'\d{4}', p['birth']['date'] or '')
    key[(norm(p['given']), norm(p['surnames']))].append((p['id'], y.group(0) if y else None))
for k, v in key.items():
    if len(v) > 1:
        warn.append(f'same name {k}: {v}')

def yr(p):
    m = re.search(r'\d{4}', p['birth']['date'] or '')
    return int(m.group(0)) if m else None

for p in d['people']:
    for par in p['parents']:
        a, b = yr(P[par]), yr(p)
        if a and b and b - a < 14:
            errs.append(f'{par} ({a}) too young for child {p["id"]} ({b})')

print('ERRORS', len(errs))
print('\n'.join(errs))
print('WARNINGS', len(warn))
print('\n'.join(warn))
sys.exit(1 if errs else 0)
