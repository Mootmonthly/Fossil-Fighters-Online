"""Builds rom_data.json: creatures, attacks, growth patterns, FP table, status table, super-revival bonuses, fossil rocks."""
import sys, struct, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nds
from nds import Rom, u16, u32

ROMDIR = os.path.join(HERE, '..', 'rom')
OUT = os.path.join(ROMDIR, 'out')
rom = Rom(os.path.join(ROMDIR, 'ffc.nds'))
names = json.load(open(os.path.join(OUT, 'names.json')))
atk_names = names['text_attack_name']; atk_info = names['text_attack_info']
dino_short = names['text_dino_short_name']; dino_full = names['text_dino_name']; dino_kind = names['text_dino_kind']
wiki = json.load(open('/home/user/fossil-fighters-online/packages/shared/src/data/vivosaurs.json'))
wiki_by_name = {v['name']: v for v in wiki}

def D(name):
    return open(os.path.join(ROMDIR, 'defs', name), 'rb').read()

ELEMENTS = {1: 'fire', 2: 'water', 3: 'earth', 4: 'air', 5: 'neutral', 6: 'legendary'}

# ---------------- growth patterns
d = D('rank_growth_pattern_defs')
n = u32(d, 8); poffs = [u32(d, 12 + i * 4) for i in range(n)]
patterns = {}
for i, o in enumerate(poffs):
    cnt = u32(d, o)
    if cnt != 20: continue
    patterns[i] = [u32(d, o + 8 + j * 4) for j in range(20)]

# ---------------- FP per hero level
k = D('btl_kp_defs')
fp_levels = []
for i in range(u32(k, 4)):
    o = 12 + i * 16
    lv = u32(k, o); mx, gain, start, gain2 = struct.unpack_from('<HHHH', k, o + 4); exp = u32(k, o + 12)
    fp_levels.append({'level': lv, 'max': mx, 'gain': gain, 'start': start, 'exp': exp})

# ---------------- super revival bonuses
e = D('creature_evolution_abilityup_param_defs')
bonuses = []
for i in range(u32(e, 8)):
    o = 16 + i * 12
    bonuses.append(dict(zip(['kind', 'lp', 'attack', 'defense', 'accuracy', 'speed'], struct.unpack_from('<6H', e, o))))

# ---------------- status effects
s = D('state_effect_defs')
statuses = []
for i in range(u32(s, 8)):
    o = 16 + i * 12
    statuses.append({'id': s[o], 'kind': s[o + 1], 'tier': s[o + 2], 'f3': s[o + 3], 'id2': s[o + 4], 'value1': s[o + 5], 'value2': s[o + 6], 'turnsA': s[o + 7], 'turnsB': s[o + 8], 'flag': s[o + 9]})

# ---------------- attacks
a = D('attack_defs')
ac = u32(a, 8); aoffs = [u32(a, 12 + i * 4) for i in range(ac)] + [len(a)]
attacks = {}
for i in range(1, ac):
    o, e2 = aoffs[i], aoffs[i + 1]
    r = a[o:e2]
    if len(r) < 24: continue
    hdr = r[0:4]
    na = u32(r, 8); offA, offB, offC = u32(r, 12), u32(r, 16), u32(r, 20)
    tiers = [struct.unpack_from('<HH', r, offA + j * 4) for j in range(na)] if offA else []
    final = struct.unpack_from('<HH', r, offB) if offB else (None, None)
    c = list(r[offC:offC + 4]) if offC else None
    tail = list(r[offC + 4:]) if offC else list(r[24:])
    i = i - 1  # attack records are stored one slot after their text/skill id
    attacks[i] = {'id': i, 'name': atk_names[i] if i < len(atk_names) else None, 'info': atk_info[i] if i < len(atk_info) else None,
                  'effectType': hdr[0], 'effectChance': hdr[1], 'h2': hdr[2], 'h3': hdr[3], 'tiers': tiers, 'fp': final[0], 'basePower': final[1], 'c': c, 'tail': tail, 'size': len(r)}

# ---------------- creatures
d = D('creature_defs')
count = u32(d, 0x1c)
offs = [u32(d, 0x24 + i * 4) for i in range(count)] + [len(d)]
creatures = []
for cid in range(1, count - 1):
    o, e2 = offs[cid + 1], offs[cid + 2]
    r = d[o:e2]
    if len(r) < 0xbc: continue
    n_sk, o_sk, n_rk, o_rk = u32(r, 0x94), u32(r, 0x98), u32(r, 0x9c), u32(r, 0xa0)
    own_off, enemy_off = u32(r, 0xa4), u32(r, 0xa8)
    n_lp, o_lp = u32(r, 0xb4), u32(r, 0xb8)
    if not (0 < o_lp < len(r) and n_lp == 20 and o_sk < len(r) and o_rk < len(r) and n_sk <= 6):
        continue  # padding / dummy record
    sup_off = own_off or enemy_off
    if sup_off >= len(r) - 3: sup_off = 0
    sup = [struct.unpack_from('<b', r, sup_off + i)[0] for i in range(4)] if sup_off else [0, 0, 0, 0]
    creatures.append({
        'id': cid, 'name': dino_short[cid] if cid < len(dino_short) else None, 'fullName': dino_full[cid] if cid < len(dino_full) else None,
        'kind': dino_kind[cid] if cid < len(dino_kind) else None,
        'element': ELEMENTS.get(r[1], r[1]), 'crit': r[18], 'b19': r[19], 'b20_26': list(r[20:27]),
        'stats': {'attack': {'a': r[3], 'b': r[4], 'max': r[5], 'pattern': r[2]}, 'defense': {'a': r[7], 'b': r[8], 'max': r[9], 'pattern': r[6]},
                  'accuracy': {'a': r[11], 'b': r[12], 'max': r[13], 'pattern': r[10]}, 'speed': {'a': r[15], 'b': r[16], 'max': r[17], 'pattern': r[14]}},
        'rangeTable': list(r[0x1b:0x23]),
        'lpByRank': [u16(r, o_lp + i * 2) for i in range(n_lp)],
        'skills': [u16(r, o_sk + i * 2) for i in range(n_sk)], 'skillRanks': [u16(r, o_rk + i * 2) for i in range(n_rk)],
        'support': {'target': 'own' if own_off else ('enemy' if enemy_off else None), 'attack': sup[0], 'defense': sup[1], 'accuracy': sup[2], 'speed': sup[3]},
        'u16Region': [u16(r, 0x2c + i * 2) for i in range((0x60 - 0x2c) // 2)],
    })

# ---------------- fossil rocks (kaseki_defs)
kk = D('kaseki_defs')
kc = u32(kk, 4); koffs = [u32(kk, 12 + i * 4) for i in range(kc)] + [len(kk)]
rocks = []
for i in range(1, kc):
    o = koffs[i]
    if koffs[i + 1] - o < 40: continue
    rocks.append({'id': i, 'species': u32(kk, o), 'f1': u32(kk, o + 4), 'part': kk[o + 8], 'pts': (kk[o + 11], kk[o + 12]), 'imageSet': u16(kk, o + 14),
                  'variant': u16(kk, o + 16), 'shapeA': u16(kk, o + 18), 'shapeB': u16(kk, o + 22), 'rest': [u32(kk, o + j) for j in range(24, koffs[i + 1] - o - 3, 4)]})

out = {'patterns': patterns, 'fpLevels': fp_levels, 'superRevivalBonuses': bonuses, 'statuses': statuses, 'attacks': attacks, 'creatures': creatures, 'rocks': rocks,
       'rankupIntervals': [50 * i for i in range(1, 20)]}
json.dump(out, open(os.path.join(OUT, 'rom_data.json'), 'w'), indent=0)
print('creatures', len(creatures), 'attacks', len(attacks), 'rocks', len(rocks))

# ---------------- validation of attack FP / power against the wiki
okc = badc = 0
for c in creatures:
    w = wiki_by_name.get(c['name'] or '')
    if not w: continue
    wskills = {sk['name']: sk for sk in w['skills']}
    for sid in c['skills']:
        at = attacks.get(sid)
        if not at or at['name'] not in wskills: continue
        ws = wskills[at['name']]
        exp_power = (ws['power'] - w['stats']['attack']) if ws['power'] is not None else 0
        if ws['fp'] == at['fp'] and exp_power == at['basePower']: okc += 1
        else:
            badc += 1
            if badc <= 10: print('ATTACK MISMATCH', c['name'], at['name'], 'rom fp/base', at['fp'], at['basePower'], 'wiki fp/base', ws['fp'], exp_power)
print(f'attack fp/power: {okc} ok, {badc} mismatched')

# ---------------- effect code decoding aid
print('\nEFFECT CODE SAMPLES (effectType, chance, h2, h3 | c | tail | tiers -> final | wiki text)')
seen = {}
for c in creatures:
    w = wiki_by_name.get(c['name'] or '')
    if not w: continue
    wskills = {sk['name']: sk for sk in w['skills']}
    for sid in c['skills']:
        at = attacks.get(sid)
        if not at or at['name'] not in wskills: continue
        key = (at['effectType'], at['effectChance'], at['h2'], tuple(at['c'] or []))
        if key in seen: continue
        seen[key] = 1
        print(f"  {at['effectType']:3d} {at['effectChance']:3d} {at['h2']:2d} {at['h3']} | c={at['c']} tail={at['tail']} | {at['tiers']} -> ({at['fp']},{at['basePower']}) | {at['name']} [{c['name']}]: '{wskills[at['name']]['text']}' tgt={wskills[at['name']]['target']}")
