"""Builds the cleaning-room fossil pictures and their species mapping from exported ROM data.

    python3 -I tools/rom/build_fossil_images.py <rom_data.json> <kaseki png dir> <vivosaurs.json> <out img dir> <out json>

`rom_data.json` comes from extract_data.py (its `rocks` table), the PNG directory from
`export_images.py ... kaseki_`. For every vivosaur part the game's rock table names an image
set; this writes the normal, red-boned and damaged pictures of each set used by an obtainable
vivosaur, cropped to the fossil, plus a JSON file mapping species id and part to the set.
"""
import json
import os
import sys

from PIL import Image

PART_NAMES = {1: 'head', 2: 'body', 3: 'arms', 4: 'legs'}
VARIANTS = {'': '01a', '_red': '01b', '_damaged': '03a'}


def main():
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    rom_data, kaseki_dir, vivosaurs_json, out_dir, out_json = sys.argv[1:]
    rocks = json.load(open(rom_data))['rocks']
    vivosaurs = json.load(open(vivosaurs_json))
    os.makedirs(out_dir, exist_ok=True)

    # creature id -> part -> image set (the record's "variant" field is the creature id)
    by_creature = {}
    for r in rocks:
        if r['variant'] == 0 or r['imageSet'] == 0:
            continue
        if r['part'] == 5:  # a single whole-body fossil (fish and other ancient vivosaurs): use it for every part
            for part in PART_NAMES.values():
                by_creature.setdefault(r['variant'], {}).setdefault(part, '%03d' % r['imageSet'])
            continue
        part = PART_NAMES.get(r['part'])
        if part is None:
            continue
        by_creature.setdefault(r['variant'], {}).setdefault(part, '%03d' % r['imageSet'])

    species = {}
    for v in vivosaurs:
        rom_id = v.get('romId')
        if rom_id in by_creature:
            species[v['id']] = by_creature[rom_id]

    needed = sorted({s for parts in species.values() for s in parts.values()})
    sets = {}
    for s in needed:
        imgs = {}
        for suffix, code in VARIANTS.items():
            for name in ('kaseki_%s_%s_small.png' % (s, code), 'kaseki_%s_%s.png' % (s, code)):
                path = os.path.join(kaseki_dir, name)
                if os.path.exists(path):
                    img = Image.open(path).convert('RGBA')
                    if img.width <= 256:
                        imgs[suffix] = img
                        break
        if '' not in imgs:
            print('missing normal picture for set', s)
            continue
        # one crop box for all variants so they line up
        box = None
        for img in imgs.values():
            b = img.getbbox()
            if b is None:
                continue
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        for suffix, img in imgs.items():
            img.crop(box).save(os.path.join(out_dir, s + suffix + '.png'), optimize=True)
        sets[s] = {'red': '_red' in imgs, 'damaged': '_damaged' in imgs, 'w': box[2] - box[0], 'h': box[3] - box[1]}

    json.dump({'species': species, 'sets': sets}, open(out_json, 'w'), indent=1, sort_keys=True)
    print('species with pictures', len(species), 'image sets', len(sets))
    missing = [v['name'] for v in vivosaurs if v['id'] not in species]
    print('without pictures:', len(missing), missing[:40])


if __name__ == '__main__':
    main()
