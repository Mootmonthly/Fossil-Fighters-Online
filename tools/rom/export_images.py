"""Exports 2D images from a Fossil Fighters: Champions ROM to PNG.

    python3 -I tools/rom/export_images.py <ffc.nds> <out dir> [prefix ...]

Every `image/<name>` descriptor whose name starts with one of the prefixes is rendered
(default: `kaseki_`, the fossil pictures shown in the cleaning room). Linear bitmaps
(4bpp or 8bpp) and tiled backgrounds are both handled. Only the owner's own ROM is read;
no game files are stored in the repository.
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nds  # noqa: E402
from nds import Rom, u16, u32  # noqa: E402

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Pillow is required: pip install pillow')


def mpm(b):
    assert b[:4] == b'MPM\0', 'not an MPM descriptor'
    return {
        'w': u32(b, 0x10), 'h': u32(b, 0x14),
        'f18': u32(b, 0x18), 'f1c': u32(b, 0x1c), 'f20': u32(b, 0x20),
        'e': (u32(b, 0x24), u32(b, 0x2c), u32(b, 0x34)),
        'arc': b[u32(b, 0x28):].split(b'\0')[0].decode(),
    }


class Archives:
    def __init__(self, rom):
        self.rom = rom
        self.cache = {}

    def entry(self, arcname, idx):
        if arcname not in self.cache:
            self.cache[arcname] = self.rom.read('image/' + arcname)
        ab = self.cache[arcname]
        off, _size = struct.unpack_from('<II', ab, 8 + idx * 8)
        return nds.mcm_decompress(ab, off)


def bgr555(raw):
    return [((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31)
            for v in struct.unpack_from('<%dH' % (len(raw) // 2), raw)]


def render(arcs, info):
    pal = bgr555(arcs.entry(info['arc'], info['e'][0]))
    gfx = arcs.entry(info['arc'], info['e'][1])
    w, h = info['w'], info['h']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    if info['e'][2] == 0 and info['f18'] == 1:
        if len(gfx) >= w * h:  # 8bpp linear
            for i in range(w * h):
                c = gfx[i]
                if c:
                    px[i % w, i // w] = (*pal[c % len(pal)], 255)
        else:  # 4bpp linear, low nibble first
            for i in range(w * h):
                byte = gfx[i // 2]
                c = (byte & 0xF) if i % 2 == 0 else (byte >> 4)
                if c:
                    px[i % w, i // w] = (*pal[c % len(pal)], 255)
        return img, 'bitmap'
    tmap = arcs.entry(info['arc'], info['e'][2])
    tw, th = w // 8, h // 8
    cells = len(tmap) // 2
    bpp = 4
    if len(pal) > 16:
        maxidx = max((u16(tmap, i * 2) & 0x3FF) for i in range(cells)) if cells else 0
        if (maxidx + 1) * 64 <= len(gfx) and (maxidx + 1) * 32 < len(gfx) * 0.6:
            bpp = 8
    for i in range(min(cells, tw * th)):
        v = u16(tmap, i * 2)
        tile = v & 0x3FF
        hf = bool(v & 0x400)
        vf = bool(v & 0x800)
        pb = v >> 12
        cx, cy = (i % tw) * 8, (i // tw) * 8
        for y in range(8):
            for x in range(8):
                sx = 7 - x if hf else x
                sy = 7 - y if vf else y
                if bpp == 4:
                    o = tile * 32 + sy * 4 + sx // 2
                    if o >= len(gfx):
                        continue
                    c = (gfx[o] >> 4) if sx & 1 else (gfx[o] & 0xF)
                    if c == 0:
                        continue
                    ci = pb * 16 + c
                else:
                    o = tile * 64 + sy * 8 + sx
                    if o >= len(gfx):
                        continue
                    c = gfx[o]
                    if c == 0:
                        continue
                    ci = c
                px[cx + x, cy + y] = (*pal[ci % len(pal)], 255)
    return img, 'tiled %dbpp' % bpp


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    rom_path, out = sys.argv[1], sys.argv[2]
    prefixes = tuple(sys.argv[3:]) or ('kaseki_',)
    os.makedirs(out, exist_ok=True)
    rom = Rom(rom_path)
    arcs = Archives(rom)
    done, fails = 0, []
    for name in sorted(rom.files):
        if not name.startswith('image/') or '/' in name[6:]:
            continue
        short = name[6:]
        if not short.startswith(prefixes):
            continue
        try:
            info = mpm(nds.mar_unpack(rom.read(name))[0])
            img, _kind = render(arcs, info)
            img.save(os.path.join(out, short + '.png'))
            done += 1
        except Exception as ex:  # noqa: BLE001
            fails.append((short, str(ex)))
    print('exported', done, 'failed', len(fails))
    for f in fails[:20]:
        print('  ', *f)


if __name__ == '__main__':
    main()
