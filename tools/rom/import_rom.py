"""Merges ROM-extracted data into the game's vivosaurs.json and writes growth.json."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROM = json.load(open(os.path.join(HERE, '..', 'rom', 'out', 'rom_data.json')))
DATA = '/home/user/fossil-fighters-online/packages/shared/src/data/vivosaurs.json'
vivos = json.load(open(DATA))

STATUS_BY_TYPE = {2: ('poison', 1), 3: ('poison', 2), 4: ('poison', 3), 5: ('sleep', 1), 6: ('sleep', 2), 7: ('scare', 1), 8: ('scare', 2),
                  9: ('enrage', 1), 10: ('enrage', 2), 11: ('confuse', 1), 12: ('confuse', 2), 13: ('excite', 1), 14: ('excite', 2),
                  15: ('counter', 1), 16: ('counter', 2), 17: ('enflame', 1), 18: ('enflame', 2), 19: ('harden', 1), 20: ('harden', 2),
                  21: ('quicken', 1), 22: ('quicken', 2), 23: ('charge', 1)}

creatures = {}
for c in sorted(ROM['creatures'], key=lambda c: c['id']):
    if c['name'] and c['name'] not in creatures:  # first occurrence wins; later duplicates are boss/story variants
        creatures[c['name']] = c
attacks = {a['id']: a for a in ROM['attacks'].values()} if isinstance(ROM['attacks'], dict) else {}
attacks = {int(k): v for k, v in ROM['attacks'].items()}
attacks_by_name = {}
for a in attacks.values():
    attacks_by_name.setdefault(a['name'], []).append(a)

matched = 0; unmatched = []; skill_fixes = []; crit_fixes = []; support_fixes = []
for v in vivos:
    c = creatures.get(v['name'])
    if not c:
        unmatched.append(v['name']); continue
    matched += 1
    v['romId'] = c['id']
    v['lpByRank'] = c['lpByRank']
    v['statCurves'] = {k: {'rank1': s['a'], 'min': s['b'], 'max': s['max'], 'pattern': s['pattern']} for k, s in c['stats'].items()}
    v['rangeTable'] = c['rangeTable']
    if v['crit'] != c['crit']:
        crit_fixes.append((v['name'], v['crit'], c['crit'])); v['crit'] = c['crit']
    rs = c['support']
    rom_sup = None if rs['target'] is None else {'target': rs['target'], 'attack': rs['attack'], 'defense': rs['defense'], 'accuracy': rs['accuracy'], 'speed': rs['speed']}
    ws = v.get('support')
    norm = lambda s: None if not s or all((s.get(k) or 0) == 0 for k in ('attack', 'defense', 'accuracy', 'speed')) else {'target': s['target'], **{k: s.get(k, 0) or 0 for k in ('attack', 'defense', 'accuracy', 'speed')}}
    if norm(ws) != norm(rom_sup):
        support_fixes.append((v['name'], ws, rom_sup))
    v['support'] = rom_sup
    # sanity: max stats
    for k in ('attack', 'defense', 'accuracy', 'speed'):
        if v['stats'][k] != c['stats'][k]['max']:
            print('MAX STAT DIFF', v['name'], k, v['stats'][k], c['stats'][k]['max']); v['stats'][k] = c['stats'][k]['max']
    if v['stats']['lp'] != c['lpByRank'][-1]:
        print('LP DIFF', v['name'], v['stats']['lp'], c['lpByRank'][-1]); v['stats']['lp'] = c['lpByRank'][-1]
    # skills: regular ones from the ROM list, team skill by name
    rom_regular = [attacks[s] for s in c['skills'] if s in attacks]
    for sk in v['skills']:
        cand = [a for a in attacks_by_name.get(sk['name'], [])]
        a = None
        if sk['kind'] != 'team':
            a = next((r for r in rom_regular if r['name'] == sk['name']), None) or (cand[0] if cand else None)
        else:
            a = cand[0] if cand else None
        if not a and sk['kind'] != 'team':
            # fall back to position among the regular skills
            regular = [s for s in v['skills'] if s['kind'] != 'team']
            idx = regular.index(sk)
            if idx < len(rom_regular):
                a = rom_regular[idx]
                print('  position-matched', v['name'], sk['name'], '->', a['name'])
        if not a:
            print('  no ROM attack for', v['name'], sk['name']); continue
        sk['romId'] = a['id']
        new_power = None if a['basePower'] == 0 and sk['power'] is None else a['basePower'] + c['stats']['attack']['max']
        if sk['power'] is not None and new_power != sk['power']:
            skill_fixes.append((v['name'], sk['name'], 'power', sk['power'], new_power)); sk['power'] = new_power
        if sk['power'] is None and a['basePower'] > 0:
            skill_fixes.append((v['name'], sk['name'], 'power', None, new_power)); sk['power'] = new_power
        if sk['fp'] != a['fp']:
            skill_fixes.append((v['name'], sk['name'], 'fp', sk['fp'], a['fp'])); sk['fp'] = a['fp']
        sk['basePower'] = a['basePower']
        sk['tiers'] = [{'fp': t[0], 'basePower': t[1]} for t in a['tiers']]
        sk['counterable'] = a['h2'] == 3
        # status from the ROM header: confirm or correct chance/tier
        st = STATUS_BY_TYPE.get(a['effectType'])
        if st:
            eff = next((e for e in sk['effects'] if e['type'] == 'status' and e['status'] == st[0]), None)
            if eff:
                if eff['chance'] != a['effectChance'] or eff['tier'] != st[1]:
                    skill_fixes.append((v['name'], sk['name'], 'status', (eff['status'], eff['tier'], eff['chance']), (st[0], st[1], a['effectChance'])))
                    eff['chance'] = a['effectChance']; eff['tier'] = st[1]
            else:
                target = 'self' if st[0] in ('counter', 'charge') else 'ally' if st[0] in ('enflame', 'harden', 'quicken') else 'hit'
                sk['effects'].append({'type': 'status', 'status': st[0], 'tier': st[1], 'chance': a['effectChance'], 'target': target})
                skill_fixes.append((v['name'], sk['name'], 'status-added', None, (st[0], st[1], a['effectChance'])))
        if a['c'] and a['c'][0] == 8:
            rot = next((e for e in sk['effects'] if e['type'] == 'rotate'), None)
            if rot and rot['chance'] != a['c'][1]:
                skill_fixes.append((v['name'], sk['name'], 'rotate', rot['chance'], a['c'][1])); rot['chance'] = a['c'][1]
        if a['c'] and a['c'][0] == 5:
            steal = next((e for e in sk['effects'] if e['type'] == 'stealFP'), None)
            amount = a['tail'][0] + a['tail'][1] * 256 if a['tail'] else None
            if steal and (steal['chance'] != a['c'][1] or steal['amount'] != amount):
                skill_fixes.append((v['name'], sk['name'], 'stealFP', (steal['amount'], steal['chance']), (amount, a['c'][1]))); steal['chance'] = a['c'][1]; steal['amount'] = amount
        if a['c'] and a['c'][0] == 18:
            inf = next((e for e in sk['effects'] if e['type'] == 'status' and e['status'] == 'infection'), None)
            if inf and inf['chance'] != a['c'][1]:
                skill_fixes.append((v['name'], sk['name'], 'infection', inf['chance'], a['c'][1])); inf['chance'] = a['c'][1]

json.dump(vivos, open(DATA, 'w'), indent=0)
growth = {'patterns': {int(k): v for k, v in ROM['patterns'].items()}, 'fpLevels': ROM['fpLevels'], 'statuses': ROM['statuses'], 'superRevivalBonuses': ROM['superRevivalBonuses']}
json.dump(growth, open('/home/user/fossil-fighters-online/packages/shared/src/data/growth.json', 'w'), indent=0)
print('matched', matched, 'unmatched', unmatched)
print('crit fixes', crit_fixes)
print('support fixes', len(support_fixes)); [print('  ', f) for f in support_fixes if f[2] is not None and f[1] is not None and any((f[1].get(k) or 0) != 0 for k in ('attack','defense','accuracy','speed'))]
print('skill fixes', len(skill_fixes)); [print('  ', f) for f in skill_fixes]
