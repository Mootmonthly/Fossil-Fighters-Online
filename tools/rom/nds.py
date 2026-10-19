"""Minimal Nintendo DS ROM toolkit for data-mining a game the user owns: header, NitroFS unpack,
NARC archives, LZ10/LZ11 decompression, NCLR palettes, NCGR tiles, NCER cells. Pure Python; Pillow for PNGs."""
import struct, sys

def u16(b, o): return struct.unpack_from('<H', b, o)[0]
def u32(b, o): return struct.unpack_from('<I', b, o)[0]

class Rom:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        d = self.data
        self.title = d[0:12].rstrip(b'\0').decode('ascii', 'replace')
        self.code = d[12:16].decode('ascii', 'replace')
        self.arm9_off, self.arm9_entry, self.arm9_ram, self.arm9_size = struct.unpack_from('<IIII', d, 0x20)
        self.arm7_off, self.arm7_entry, self.arm7_ram, self.arm7_size = struct.unpack_from('<IIII', d, 0x30)
        self.fnt_off, self.fnt_size, self.fat_off, self.fat_size = struct.unpack_from('<IIII', d, 0x40)
        self.ov9_off, self.ov9_size = struct.unpack_from('<II', d, 0x50)
        self.files = self._read_fs()

    def _read_fs(self):
        d = self.data
        fnt, fat = self.fnt_off, self.fat_off
        out = {}
        def walk(dir_id, path):
            e = fnt + (dir_id & 0xFFF) * 8
            sub_off = u32(d, e)
            first_id = u16(d, e + 4)
            p = fnt + sub_off
            fid = first_id
            while True:
                t = d[p]; p += 1
                if t == 0: break
                length = t & 0x7F
                name = d[p:p + length].decode('ascii', 'replace'); p += length
                if t & 0x80:
                    sub = u16(d, p); p += 2
                    walk(sub, path + name + '/')
                else:
                    s, e2 = struct.unpack_from('<II', d, fat + fid * 8)
                    out[path + name] = (s, e2)
                    fid += 1
        walk(0xF000, '')
        return out

    def read(self, name):
        s, e = self.files[name]
        return self.data[s:e]

    def arm9(self):
        return self.data[self.arm9_off:self.arm9_off + self.arm9_size]

# ---------------------------------------------------------------- compression
def lz_decompress(b):
    """Nintendo LZ10 (0x10) / LZ11 (0x11). Returns bytes, or None if the header does not match."""
    if len(b) < 4 or b[0] not in (0x10, 0x11): return None
    size = b[1] | (b[2] << 8) | (b[3] << 16)
    out = bytearray(); i = 4
    lz11 = b[0] == 0x11
    try:
        while len(out) < size:
            flags = b[i]; i += 1
            for bit in range(8):
                if len(out) >= size: break
                if flags & (0x80 >> bit):
                    if not lz11:
                        v = (b[i] << 8) | b[i + 1]; i += 2
                        n = (v >> 12) + 3; disp = (v & 0xFFF) + 1
                    else:
                        v = b[i]; i += 1
                        ind = v >> 4
                        if ind == 0:
                            n = ((v & 0xF) << 4 | (b[i] >> 4)) + 0x11
                            disp = (((b[i] & 0xF) << 8) | b[i + 1]) + 1; i += 2
                        elif ind == 1:
                            n = ((v & 0xF) << 12 | (b[i] << 4) | (b[i + 1] >> 4)) + 0x111
                            disp = (((b[i + 1] & 0xF) << 8) | b[i + 2]) + 1; i += 3
                        else:
                            n = ind + 1
                            disp = (((v & 0xF) << 8) | b[i]) + 1; i += 1
                    for _ in range(n):
                        out.append(out[-disp])
                else:
                    out.append(b[i]); i += 1
    except IndexError:
        return None
    return bytes(out)

def maybe_decompress(b):
    d = lz_decompress(b)
    return d if d is not None else b

def huff_decompress(b, low_nibble_first=True):
    """GBA/DS BIOS Huffman (header 0x24 = 4-bit symbols, 0x28 = 8-bit)."""
    if len(b) < 5 or (b[0] & 0xF0) != 0x20: return None
    bits = b[0] & 0xF
    size = b[1] | (b[2] << 8) | (b[3] << 16)
    tree_size = b[4]
    root = 5
    pos = 4 + (tree_size + 1) * 2
    out = bytearray()
    node = root
    half = None
    try:
        while len(out) < size:
            word = u32(b, pos); pos += 4
            for i in range(31, -1, -1):
                bit = (word >> i) & 1
                nv = b[node]
                child = (node & ~1) + ((nv & 0x3F) * 2) + 2 + bit
                leaf = (nv & (0x80 >> bit)) != 0
                if leaf:
                    sym = b[child]
                    if bits == 8:
                        out.append(sym)
                    elif half is None:
                        half = sym & 0xF
                    else:
                        out.append((half | (sym << 4)) if low_nibble_first else ((half << 4) | sym))
                        half = None
                    node = root
                    if len(out) >= size: break
                else:
                    node = child
    except IndexError:
        return None
    return bytes(out)

def rle_decompress(b):
    if len(b) < 4 or b[0] != 0x30: return None
    size = b[1] | (b[2] << 8) | (b[3] << 16)
    out = bytearray(); i = 4
    while len(out) < size and i < len(b):
        f = b[i]; i += 1
        if f & 0x80:
            n = (f & 0x7F) + 3
            out.extend(bytes([b[i]]) * n); i += 1
        else:
            n = (f & 0x7F) + 1
            out.extend(b[i:i + n]); i += n
    return bytes(out)

def apply_compression_type(t, chunk):
    if t == 0: return chunk
    if t == 1: return rle_decompress(chunk)
    if t == 2: return lz_decompress(chunk)
    if t == 3: return huff_decompress(chunk)
    raise ValueError(f'unknown compression type {t}')

def mcm_decompress(b, start=0):
    """Fossil Fighters MCM container: chunked data with up to two stacked compression passes."""
    assert b[start:start + 4] == b'MCM\0', b[start:start + 4]
    total = u32(b, start + 4)
    n_chunks = u32(b, start + 12)
    t1, t2 = b[start + 16], b[start + 17]
    offs = [u32(b, start + 20 + i * 4) for i in range(n_chunks + 1)]
    out = bytearray()
    for i in range(n_chunks):
        chunk = b[start + offs[i]: start + offs[i + 1]]
        d = apply_compression_type(t1, chunk)
        if d is None: raise ValueError(f'pass 1 (type {t1}) failed on chunk {i}')
        d = apply_compression_type(t2, d)
        if d is None: raise ValueError(f'pass 2 (type {t2}) failed on chunk {i}')
        out.extend(d)
    return bytes(out[:total])

def mar_unpack(b):
    """Fossil Fighters MAR archive: a list of MCM containers. Returns list of decompressed blobs."""
    if b[:4] != b'MAR\0': return None
    n = u32(b, 4)
    out = []
    for i in range(n):
        off, size = struct.unpack_from('<II', b, 8 + i * 8)
        out.append(mcm_decompress(b, off))
    return out

# ---------------------------------------------------------------- NARC
def narc_files(b):
    """Returns list of file bytes inside a NARC archive (names ignored)."""
    if b[:4] != b'NARC': return None
    fatb = 16
    assert b[fatb:fatb + 4] == b'BTAF'
    n = u32(b, fatb + 8)
    entries = [struct.unpack_from('<II', b, fatb + 12 + i * 8) for i in range(n)]
    fatb_size = u32(b, fatb + 4)
    fntb = fatb + fatb_size
    fntb_size = u32(b, fntb + 4)
    fimg = fntb + fntb_size
    base = fimg + 8
    return [b[base + s:base + e] for s, e in entries]

# ---------------------------------------------------------------- graphics
def nclr_palette(b):
    """Returns list of (r,g,b) colours from an NCLR/RLCN palette file."""
    if b[:4] not in (b'RLCN', b'NCLR'): return None
    p = 16
    assert b[p:p + 4] == b'TTLP'
    data_size = u32(b, p + 16)
    data_off = u32(b, p + 20)
    raw = b[p + 8 + data_off: p + 8 + data_off + data_size]
    cols = []
    for i in range(0, len(raw) - 1, 2):
        v = u16(raw, i)
        r = (v & 31) * 255 // 31; g = ((v >> 5) & 31) * 255 // 31; bl = ((v >> 10) & 31) * 255 // 31
        cols.append((r, g, bl))
    return cols

def ncgr_tiles(b):
    """Returns dict with 8x8 tiles (flat index lists), bpp, nominal size and raw pixel indices."""
    if b[:4] not in (b'RGCN', b'NCGR'): return None
    p = 16
    assert b[p:p + 4] == b'RAHC'
    h = u16(b, p + 8); w = u16(b, p + 10)
    depth = u32(b, p + 12)
    bpp = 4 if depth == 3 else 8
    tiled = u32(b, p + 20)
    size = u32(b, p + 24)
    off = u32(b, p + 28)
    raw = b[p + 8 + off: p + 8 + off + size]
    if bpp == 4:
        px = []
        for byte in raw:
            px.append(byte & 0xF); px.append(byte >> 4)
    else:
        px = list(raw)
    tiles = [px[i:i + 64] for i in range(0, len(px) - 63, 64)]
    return {'tiles': tiles, 'bpp': bpp, 'w': w, 'h': h, 'linear': bool(tiled & 1), 'pixels': px}

def tiles_to_image(info, palette, tiles_wide=None, pal_index=0):
    from PIL import Image
    tiles = info['tiles']; bpp = info['bpp']
    if not tiles: return None
    tw = tiles_wide or (info['w'] if info['w'] not in (0, 0xFFFF) else 16)
    th = (len(tiles) + tw - 1) // tw
    img = Image.new('RGBA', (tw * 8, th * 8), (0, 0, 0, 0))
    pix = img.load()
    base = pal_index * 16 if bpp == 4 else 0
    for t, tile in enumerate(tiles):
        tx, ty = (t % tw) * 8, (t // tw) * 8
        for i, c in enumerate(tile):
            if c == 0: continue
            ci = base + c
            col = palette[ci] if ci < len(palette) else (255, 0, 255)
            pix[tx + i % 8, ty + i // 8] = (*col, 255)
    return img

def ncer_cells(b):
    """Parses NCER (RECN) cell banks: returns list of cells, each a list of OAM dicts."""
    if b[:4] not in (b'RECN', b'NCER'): return None
    p = 16
    assert b[p:p + 4] == b'KBEC'
    n = u16(b, p + 8); kind = u16(b, p + 10)
    data_off = u32(b, p + 12)
    base = p + 8 + data_off
    entry = 16 if kind else 8
    dims_tbl = {(0,0):(8,8),(0,1):(16,16),(0,2):(32,32),(0,3):(64,64),(1,0):(16,8),(1,1):(32,8),(1,2):(32,16),(1,3):(64,32),(2,0):(8,16),(2,1):(8,32),(2,2):(16,32),(2,3):(32,64)}
    cells = []
    for i in range(n):
        e = base + i * entry
        n_oam = u16(b, e); oam_off = u32(b, e + 4)
        oams = []
        oam_base = base + n * entry + oam_off
        for j in range(n_oam):
            a0, a1, a2 = struct.unpack_from('<HHH', b, oam_base + j * 6)
            y = a0 & 0xFF; y = y - 256 if y >= 128 else y
            x = a1 & 0x1FF; x = x - 512 if x >= 256 else x
            shape = a0 >> 14; size = a1 >> 14
            dims = dims_tbl.get((shape, size), (8, 8))
            oams.append({'x': x, 'y': y, 'w': dims[0], 'h': dims[1], 'tile': a2 & 0x3FF, 'pal': a2 >> 12,
                         'hflip': bool(a1 & 0x1000), 'vflip': bool(a1 & 0x2000), 'bpp8': bool(a0 & 0x2000)})
        cells.append(oams)
    return cells

def render_cell(oams, info, palette, tile_boundary=32):
    """Renders one NCER cell from NCGR tile data. tile_boundary = bytes per OAM tile index unit."""
    from PIL import Image
    if not oams: return None
    minx = min(o['x'] for o in oams); miny = min(o['y'] for o in oams)
    maxx = max(o['x'] + o['w'] for o in oams); maxy = max(o['y'] + o['h'] for o in oams)
    img = Image.new('RGBA', (maxx - minx, maxy - miny), (0, 0, 0, 0))
    pix = img.load()
    px = info['pixels']; bpp = info['bpp']
    for o in reversed(oams):
        tw, th = o['w'] // 8, o['h'] // 8
        start_tile = o['tile'] * tile_boundary // (32 if bpp == 4 else 64)
        base = o['pal'] * 16 if bpp == 4 else 0
        for ty in range(th):
            for tx in range(tw):
                t = start_tile + ty * tw + tx
                tile = px[t * 64:(t + 1) * 64]
                if len(tile) < 64: continue
                for i, c in enumerate(tile):
                    if c == 0: continue
                    sx, sy = i % 8, i // 8
                    X = tx * 8 + sx; Y = ty * 8 + sy
                    if o['hflip']: X = o['w'] - 1 - X
                    if o['vflip']: Y = o['h'] - 1 - Y
                    ci = base + c
                    col = palette[ci] if ci < len(palette) else (255, 0, 255)
                    pix[o['x'] - minx + X, o['y'] - miny + Y] = (*col, 255)
    return img

if __name__ == '__main__':
    rom = Rom(sys.argv[1])
    print(rom.title, rom.code, 'files:', len(rom.files))
    for name, (s, e) in sorted(rom.files.items()):
        print(f'{e - s:>10}  {name}')
