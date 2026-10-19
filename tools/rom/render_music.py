"""Renders sequenced music (SSEQ) from a Nintendo DS sound archive (SDAT) to audio files with loop points.

    python3 -I tools/rom/render_music.py <snd_data.sdat> <out dir> <SEQ name> [<SEQ name> ...]

For each sequence this writes <out dir>/<name>.wav plus <name>.ogg / <name>.m4a (via ffmpeg when present) and
appends loop metadata to <out dir>/tracks.json: `loopStart` / `loopEnd` in seconds, measured on the rendered file.
Looping songs are rendered as intro + two passes of the loop + release tail; the loop points mark the second pass,
so a player that jumps from loopEnd back to loopStart hears the notes that ring across the seam.

The synthesizer follows the DS sound driver closely enough for background music: PCM8 / PCM16 / IMA-ADPCM
samples with loops, PSG square and noise channels, the driver's attack / decay / sustain / release curves at
192 updates per second, track volume, expression, pan, transpose, pitch bend, vibrato and portamento.
No game files are stored in the repository; point it at your own dump.
"""
import json
import math
import os
import random
import struct
import subprocess
import sys

import numpy as np

OUT_RATE = 32728  # the DS mixer rate
UPDATE_HZ = 192  # sound driver update rate
TICKS_PER_QUARTER = 48
AMPL_MIN = -92544  # silence, in the driver's 1/128 "decibel/8" units
MAX_RELEASE_S = 10.0

SUSTAIN_TABLE = [
    -32768, -722, -721, -651, -601, -562, -530, -503, -480, -460, -442, -425, -410, -396, -383, -371, -360, -349, -339, -330, -321, -313, -305, -297, -289, -282, -276, -269, -263, -257, -251, -245, -239, -234, -229, -224, -219, -214, -210, -205, -201, -196, -192, -188, -184, -180, -176, -173, -169, -165, -162, -158, -155, -152, -149, -145, -142, -139, -136, -133, -130, -127, -125, -122, -119, -116, -114, -111, -109, -106, -103, -101, -99, -96, -94, -91, -89, -87, -85, -82, -80, -78, -76, -74, -72, -70, -68, -66, -64, -62, -60, -58, -56, -54, -52, -50, -49, -47, -45, -43, -42, -40, -38, -36, -35, -33, -31, -30, -28, -27, -25, -23, -22, -20, -19, -17, -16, -14, -13, -11, -10, -8, -7, -6, -4, -3, -1, 0,
]
ATTACK_TABLE = [0x00, 0x01, 0x05, 0x0E, 0x1A, 0x26, 0x33, 0x3F, 0x49, 0x54, 0x5C, 0x64, 0x6D, 0x74, 0x7B, 0x7F, 0x84, 0x89, 0x8F]


def cnv_attack(a):
    return ATTACK_TABLE[0x7F - a] if a >= 0x6D else 0xFF - a


def cnv_fall(f):
    if f == 0x7F:
        return 0xFFFF
    if f == 0x7E:
        return 0x3C00
    if f < 0x32:
        return (f << 1) + 1
    return 0x1E00 // (0x7E - f)


def cnv_sust(s):
    return SUSTAIN_TABLE[s] << 7


def u8(b, o): return b[o]
def s8(b, o): return struct.unpack_from('<b', b, o)[0]
def u16(b, o): return struct.unpack_from('<H', b, o)[0]
def s16(b, o): return struct.unpack_from('<h', b, o)[0]
def u24(b, o): return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
def u32(b, o): return struct.unpack_from('<I', b, o)[0]


# ---------------------------------------------------------------------------
# SDAT
# ---------------------------------------------------------------------------

class Sdat:
    def __init__(self, data):
        self.data = data
        symb_off, symb_sz, info_off, info_sz, fat_off, fat_sz, file_off, file_sz = struct.unpack_from('<8I', data, 0x10)
        self.symb = data[symb_off:symb_off + symb_sz]
        self.info = data[info_off:info_off + info_sz]
        self.fat = data[fat_off:fat_off + fat_sz]
        self.seq_names = self._names(0)

    def _names(self, kind):
        off = u32(self.symb, 8 + kind * 4)
        cnt = u32(self.symb, off)
        out = []
        for i in range(cnt):
            o = u32(self.symb, off + 4 + i * 4)
            out.append(self.symb[o:self.symb.index(b'\0', o)].decode() if o else None)
        return out

    def _info_record(self, kind, idx):
        off = u32(self.info, 8 + kind * 4)
        return u32(self.info, off + 4 + idx * 4)

    def file(self, file_id):
        off, size = struct.unpack_from('<II', self.fat, 12 + file_id * 16)
        return self.data[off:off + size]

    def seq(self, name):
        idx = self.seq_names.index(name)
        r = self._info_record(0, idx)
        return {'file': self.file(u16(self.info, r)), 'bank': u16(self.info, r + 4), 'vol': u8(self.info, r + 6)}

    def bank(self, idx):
        r = self._info_record(2, idx)
        return {'file': self.file(u16(self.info, r)), 'warcs': [w for w in struct.unpack_from('<4H', self.info, r + 4) if w != 0xFFFF]}

    def warc(self, idx):
        r = self._info_record(3, idx)
        return self.file(u16(self.info, r))


# ---------------------------------------------------------------------------
# SWAR / SWAV
# ---------------------------------------------------------------------------

ADPCM_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8]
ADPCM_STEP = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]


def decode_adpcm(raw):
    sample = s16(raw, 0)
    index = max(0, min(88, s16(raw, 2)))
    out = np.empty((len(raw) - 4) * 2, dtype=np.float32)
    n = 0
    for byte in raw[4:]:
        for nib in (byte & 0xF, byte >> 4):
            step = ADPCM_STEP[index]
            diff = step >> 3
            if nib & 1: diff += step >> 2
            if nib & 2: diff += step >> 1
            if nib & 4: diff += step
            if nib & 8:
                sample = max(-32767, sample - diff)
            else:
                sample = min(32767, sample + diff)
            index = max(0, min(88, index + ADPCM_INDEX[nib & 7]))
            out[n] = sample / 32768.0
            n += 1
    return out


class Wave:
    __slots__ = ('samples', 'rate', 'loop', 'loop_start', 'loop_len')

    def __init__(self, info):
        wtype, loop, rate, _time, loop_start_w, loop_len_w = struct.unpack_from('<BBHHHI', info, 0)
        raw = info[12:12 + (loop_start_w + loop_len_w) * 4]
        self.rate = rate
        self.loop = bool(loop)
        if wtype == 0:
            self.samples = np.frombuffer(raw, dtype=np.int8).astype(np.float32) / 128.0
            self.loop_start, self.loop_len = loop_start_w * 4, loop_len_w * 4
        elif wtype == 1:
            self.samples = np.frombuffer(raw[: len(raw) // 2 * 2], dtype='<i2').astype(np.float32) / 32768.0
            self.loop_start, self.loop_len = loop_start_w * 2, loop_len_w * 2
        else:
            self.samples = decode_adpcm(raw)
            self.loop_start, self.loop_len = max(0, (loop_start_w * 4 - 4) * 2), loop_len_w * 8
        if self.loop and (self.loop_len <= 0 or self.loop_start + self.loop_len > len(self.samples)):
            self.loop_len = max(1, len(self.samples) - self.loop_start)


class WaveArchive:
    def __init__(self, data):
        cnt = u32(data, 0x38)
        self.cache = {}
        self.data = data
        self.offsets = [u32(data, 0x3C + i * 4) for i in range(cnt)]

    def wave(self, idx):
        if idx not in self.cache:
            self.cache[idx] = Wave(self.data[self.offsets[idx]:])
        return self.cache[idx]


# ---------------------------------------------------------------------------
# SBNK
# ---------------------------------------------------------------------------

class Instrument:
    __slots__ = ('kind', 'swav', 'swar', 'note', 'attack', 'decay', 'sustain', 'release', 'pan')

    def __init__(self, kind, rec):
        self.kind = kind
        self.swav, self.swar, self.note, self.attack, self.decay, self.sustain, self.release, self.pan = struct.unpack_from('<HHBBBBBB', rec, 0)


class Bank:
    def __init__(self, data):
        cnt = u32(data, 0x38)
        self.data = data
        self.records = [(data[0x3C + i * 4], u16(data, 0x3C + i * 4 + 1)) for i in range(cnt)]

    def instrument(self, program, key):
        if program >= len(self.records):
            return None
        kind, off = self.records[program]
        d = self.data
        if kind == 0:
            return None
        if 1 <= kind <= 5:
            return Instrument(kind, d[off:off + 10])
        if kind == 16:  # drum set
            lo, hi = d[off], d[off + 1]
            if key < lo or key > hi:
                return None
            r = off + 2 + (key - lo) * 12
            return Instrument(u16(d, r), d[r + 2:r + 12])
        if kind == 17:  # key split
            for i in range(8):
                if key <= d[off + i]:
                    r = off + 8 + i * 12
                    return Instrument(u16(d, r), d[r + 2:r + 12])
            return None
        return None


# ---------------------------------------------------------------------------
# SSEQ sequencer
# ---------------------------------------------------------------------------

class Track:
    def __init__(self, pos):
        self.pos = pos
        self.wait = 0
        self.stack = []
        self.loops = []
        self.program = 0
        self.vol = 127
        self.expr = 127
        self.pan = 64
        self.transpose = 0
        self.bend = 0
        self.bend_range = 2
        self.note_wait = True
        self.tie = False
        self.porta = False
        self.porta_time = 0
        self.porta_key = 60
        self.mod_depth = 0
        self.mod_speed = 16
        self.mod_type = 0
        self.mod_range = 1
        self.mod_delay = 0
        self.attack = self.decay = self.sustain = self.release = -1
        self.ended = False
        self.cond = True
        self.last_key = 60
        self.visited = {}


class Note:
    __slots__ = ('tick', 'dur', 'key', 'vel', 'track', 'program', 'vol', 'expr', 'pan', 'transpose', 'bend', 'bend_range', 'mod_depth', 'mod_speed', 'mod_type', 'mod_range', 'mod_delay', 'adsr', 'porta_from', 'porta_time')


def read_varlen(b, pos):
    v = 0
    while True:
        c = b[pos]
        pos += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, pos


def sequence(sseq, max_seconds=15 * 60):
    """Simulates the sequence; returns (notes, tick_times, loop_ticks, master_vol_events)."""
    base = u32(sseq, 0x18)
    tracks = [Track(base)]
    alloc = 0xFFFF
    tempo = 120
    variables = [0] * 32
    notes = []
    tick = 0
    tick_time = [0.0]
    time = 0.0
    loop = None  # (start_tick, end_tick)
    master_vol = 127
    tempo_counter = 0
    opened = False

    def exec_track(t, ti):
        nonlocal tempo, alloc, loop, master_vol, opened
        b = sseq
        while not t.ended and t.wait == 0:
            at = t.pos
            if at not in t.visited:
                t.visited[at] = tick
            cmd = b[t.pos]
            t.pos += 1
            # prefixes: random / variable / conditional
            arg_override = None
            if cmd == 0xA0:
                cmd = b[t.pos]; t.pos += 1
                lo = s16(b, t.pos); hi = s16(b, t.pos + 2); t.pos += 4
                arg_override = random.randint(min(lo, hi), max(lo, hi))
            elif cmd == 0xA1:
                cmd = b[t.pos]; t.pos += 1
                arg_override = variables[b[t.pos] & 31]; t.pos += 1
            elif cmd == 0xA2:
                cmd = b[t.pos]; t.pos += 1
                if not t.cond:
                    # skip the command's arguments
                    t.pos = skip_args(b, cmd, t.pos)
                    continue
            if cmd < 0x80:
                vel = b[t.pos]; t.pos += 1
                if arg_override is not None:
                    dur = arg_override
                else:
                    dur, t.pos = read_varlen(b, t.pos)
                n = Note()
                n.tick, n.dur, n.key, n.vel, n.track = tick, dur, cmd, vel, ti
                n.program, n.vol, n.expr, n.pan, n.transpose, n.bend, n.bend_range = t.program, t.vol, t.expr, t.pan, t.transpose, t.bend, t.bend_range
                n.mod_depth, n.mod_speed, n.mod_type, n.mod_range, n.mod_delay = t.mod_depth, t.mod_speed, t.mod_type, t.mod_range, t.mod_delay
                n.adsr = (t.attack, t.decay, t.sustain, t.release)
                n.porta_from, n.porta_time = (t.porta_key if t.porta else None), t.porta_time
                t.porta_key = cmd
                t.last_key = cmd
                notes.append(n)
                if t.note_wait:
                    t.wait = dur
                continue
            if cmd == 0x80:
                if arg_override is not None:
                    t.wait = arg_override
                else:
                    t.wait, t.pos = read_varlen(b, t.pos)
            elif cmd == 0x81:
                if arg_override is not None:
                    v = arg_override
                else:
                    v, t.pos = read_varlen(b, t.pos)
                t.program = v & 0x7F
            elif cmd == 0x93:
                tn = b[t.pos]; off = base + u24(b, t.pos + 1); t.pos += 4
                if not opened:
                    pass
                while len(tracks) <= tn:
                    tracks.append(None)
                if tracks[tn] is None:
                    tracks[tn] = Track(off)
            elif cmd == 0x94:
                off = base + u24(b, t.pos); t.pos += 3
                if off in t.visited and loop is None:
                    loop = (t.visited[off], tick)
                if off in t.visited and loop is not None and tick >= loop[1] + (loop[1] - loop[0]):
                    t.ended = True  # second pass done
                else:
                    t.pos = off
            elif cmd == 0x95:
                off = base + u24(b, t.pos); t.pos += 3
                t.stack.append(t.pos)
                t.pos = off
            elif 0xB0 <= cmd <= 0xBD:
                var = b[t.pos] & 31; val = arg_override if arg_override is not None else s16(b, t.pos + 1); t.pos += 3
                v = variables
                if cmd == 0xB0: v[var] = val
                elif cmd == 0xB1: v[var] += val
                elif cmd == 0xB2: v[var] -= val
                elif cmd == 0xB3: v[var] *= val
                elif cmd == 0xB4: v[var] = int(v[var] / val) if val else 0
                elif cmd == 0xB5: v[var] = (v[var] << val) if val >= 0 else (v[var] >> -val)
                elif cmd == 0xB6: v[var] = random.randint(min(0, val), max(0, val))
                elif cmd == 0xB8: t.cond = v[var] == val
                elif cmd == 0xB9: t.cond = v[var] >= val
                elif cmd == 0xBA: t.cond = v[var] > val
                elif cmd == 0xBB: t.cond = v[var] <= val
                elif cmd == 0xBC: t.cond = v[var] < val
                elif cmd == 0xBD: t.cond = v[var] != val
            elif cmd in (0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6):
                val = arg_override if arg_override is not None else b[t.pos]; t.pos += 1
                if cmd == 0xC0: t.pan = val
                elif cmd == 0xC1: t.vol = val
                elif cmd == 0xC2: master_vol = val
                elif cmd == 0xC3: t.transpose = val - 256 if val > 127 else val
                elif cmd == 0xC4: t.bend = val - 256 if val > 127 else val
                elif cmd == 0xC5: t.bend_range = val
                elif cmd == 0xC7: t.note_wait = bool(val)
                elif cmd == 0xC8: t.tie = bool(val)
                elif cmd == 0xC9: t.porta_key = val; t.porta = True
                elif cmd == 0xCA: t.mod_depth = val
                elif cmd == 0xCB: t.mod_speed = val
                elif cmd == 0xCC: t.mod_type = val
                elif cmd == 0xCD: t.mod_range = val
                elif cmd == 0xCE: t.porta = bool(val)
                elif cmd == 0xCF: t.porta_time = val
                elif cmd == 0xD0: t.attack = val
                elif cmd == 0xD1: t.decay = val
                elif cmd == 0xD2: t.sustain = val
                elif cmd == 0xD3: t.release = val
                elif cmd == 0xD4: t.loops.append([t.pos, val])
                elif cmd == 0xD5: t.expr = val
            elif cmd in (0xE0, 0xE1, 0xE3):
                val = arg_override if arg_override is not None else s16(b, t.pos); t.pos += 2
                if cmd == 0xE0: t.mod_delay = val
                elif cmd == 0xE1: tempo = max(1, val & 0xFFFF)
            elif cmd == 0xFC:
                if t.loops:
                    top = t.loops[-1]
                    if top[1] == 0:
                        t.pos = top[0]  # infinite loop: treat like a song loop
                        if loop is None:
                            loop = (t.visited.get(top[0], tick), tick)
                        elif tick >= loop[1] + (loop[1] - loop[0]):
                            t.ended = True
                    else:
                        top[1] -= 1
                        if top[1] > 0:
                            t.pos = top[0]
                        else:
                            t.loops.pop()
            elif cmd == 0xFD:
                if t.stack:
                    t.pos = t.stack.pop()
                else:
                    t.ended = True
            elif cmd == 0xFE:
                alloc = u16(b, t.pos); t.pos += 2
            elif cmd == 0xFF:
                t.ended = True
            else:
                raise ValueError('unknown SSEQ command 0x%02x at %d' % (cmd, t.pos - 1))

    def skip_args(b, cmd, pos):
        if cmd < 0x80:
            pos += 1
            _, pos = read_varlen(b, pos)
            return pos
        if cmd in (0x80, 0x81):
            _, pos = read_varlen(b, pos)
            return pos
        if cmd == 0x93: return pos + 4
        if cmd in (0x94, 0x95): return pos + 3
        if 0xB0 <= cmd <= 0xBD: return pos + 3
        if 0xC0 <= cmd <= 0xD6: return pos + 1
        if cmd in (0xE0, 0xE1, 0xE3): return pos + 2
        if cmd == 0xFE: return pos + 2
        return pos

    max_ticks = int(max_seconds * 1000)  # generous; the time limit below is what matters
    while tick < max_ticks and time < max_seconds:
        for ti, t in enumerate(tracks):
            if t is None or t.ended:
                continue
            exec_track(t, ti)
        if all(t is None or t.ended for t in tracks):
            break
        # advance one tick
        for t in tracks:
            if t is not None and not t.ended and t.wait > 0:
                t.wait -= 1
        tick += 1
        time += 60.0 / (tempo * TICKS_PER_QUARTER)
        tick_time.append(time)
        if loop is not None and tick > loop[1] + (loop[1] - loop[0]) + 1:
            # both passes done; stop everything
            for t in tracks:
                if t is not None:
                    t.ended = True
    return notes, tick_time, loop, master_vol


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

def envelope(attack, decay, sustain, release, hold_updates, max_updates):
    """Amplitude per driver update (192 Hz) while the note is held for hold_updates, then released."""
    a_rate, d_rate, s_lvl, r_rate = cnv_attack(attack), cnv_fall(decay), cnv_sust(sustain), cnv_fall(release)
    out = []
    ampl = float(AMPL_MIN)
    phase = 0  # 0 attack, 1 decay, 2 sustain
    for i in range(max_updates):
        if i < hold_updates:
            if phase == 0:
                ampl = ampl * a_rate / 256.0
                if ampl > -1:
                    ampl = 0.0
                    phase = 1
            elif phase == 1:
                ampl -= d_rate
                if ampl <= s_lvl:
                    ampl = float(s_lvl)
                    phase = 2
        else:
            ampl -= r_rate
            if ampl <= AMPL_MIN:
                out.append(0.0)
                break
        out.append(10.0 ** (ampl / 20480.0))
    return np.array(out, dtype=np.float32)


class Synth:
    def __init__(self, sdat, bank_idx):
        bank = sdat.bank(bank_idx)
        self.bank = Bank(bank['file'])
        self.warcs = [WaveArchive(sdat.warc(w)) for w in bank['warcs']]
        self.rng = np.random.default_rng(1)

    def render(self, notes, tick_time, seq_vol, master_vol):
        total_ticks = len(tick_time) - 1
        def t_of(tick):
            return tick_time[min(tick, total_ticks)]
        end_time = max((t_of(n.tick + max(1, n.dur)) for n in notes), default=0) + MAX_RELEASE_S
        out = np.zeros((int(end_time * OUT_RATE) + OUT_RATE, 2), dtype=np.float32)
        for n in notes:
            inst = self.bank.instrument(n.program, n.key)
            if inst is None or inst.kind == 0:
                continue
            start = t_of(n.tick)
            hold = max(1.0 / UPDATE_HZ, t_of(n.tick + n.dur) - start) if n.dur > 0 else 1e9
            adsr = [n.adsr[0] if n.adsr[0] >= 0 else inst.attack, n.adsr[1] if n.adsr[1] >= 0 else inst.decay,
                    n.adsr[2] if n.adsr[2] >= 0 else inst.sustain, n.adsr[3] if n.adsr[3] >= 0 else inst.release]
            hold_updates = int(math.ceil(hold * UPDATE_HZ)) if hold < 1e8 else 10 ** 9
            env = envelope(*adsr, hold_updates, int((min(hold, 60) + MAX_RELEASE_S) * UPDATE_HZ))
            n_samples = int(len(env) * OUT_RATE / UPDATE_HZ)
            if n_samples <= 0:
                continue
            # pitch: semitones relative to the sample's base note
            semis = n.key + n.transpose - (inst.note if inst.kind in (1, 4) else 60) + n.bend * n.bend_range / 128.0
            tt = np.arange(n_samples, dtype=np.float32) / OUT_RATE
            pitch = np.full(n_samples, semis, dtype=np.float32)
            if n.porta_from is not None and n.porta_time > 0:
                glide = max(1.0 / UPDATE_HZ, n.porta_time * n.porta_time * abs(n.key - n.porta_from) / 48.0 / UPDATE_HZ)
                pitch += (n.porta_from - n.key) * np.clip(1 - tt / glide, 0, 1)
            if n.mod_depth > 0 and n.mod_type == 0:
                freq = 0.1875 * max(1, n.mod_speed)
                delay = n.mod_delay / UPDATE_HZ
                lfo = np.sin(2 * np.pi * freq * np.clip(tt - delay, 0, None)) * (n.mod_depth * n.mod_range / 64.0) * (tt >= delay)
                pitch += lfo.astype(np.float32)
            ratio = np.exp2(pitch / 12.0)
            if inst.kind in (1, 4):
                warc = self.warcs[inst.swar] if inst.swar < len(self.warcs) else None
                if warc is None or inst.swav >= len(warc.offsets):
                    continue
                w = warc.wave(inst.swav)
                inc = ratio * (w.rate / OUT_RATE)
                pos = np.cumsum(inc)
                if w.loop:
                    beyond = pos >= w.loop_start
                    pos = np.where(beyond, w.loop_start + np.mod(pos - w.loop_start, w.loop_len), pos)
                    valid = n_samples
                else:
                    cut = np.searchsorted(pos, len(w.samples) - 2)
                    valid = min(n_samples, int(cut))
                    if valid <= 0:
                        continue
                    pos = pos[:valid]
                idx = pos.astype(np.int64)
                frac = (pos - idx).astype(np.float32)
                s0 = w.samples[np.minimum(idx, len(w.samples) - 1)]
                s1 = w.samples[np.minimum(idx + 1, len(w.samples) - 1)]
                sig = s0 + (s1 - s0) * frac
                inst_pan = inst.pan
            elif inst.kind == 2:  # PSG square wave; swav field holds the duty (0..7)
                freq = 440.0 * np.exp2((n.key + n.transpose - 69 + n.bend * n.bend_range / 128.0) / 12.0)
                phase = np.cumsum(ratio / np.exp2(semis / 12.0) * freq / OUT_RATE) % 1.0
                duty = (inst.swav + 1) / 8.0
                sig = np.where(phase < duty, 0.5, -0.5).astype(np.float32)
                valid = n_samples
                inst_pan = inst.pan
            elif inst.kind == 3:  # noise
                sig = (self.rng.random(n_samples, dtype=np.float32) - 0.5)
                valid = n_samples
                inst_pan = inst.pan
            else:
                continue
            # envelope at the output rate
            env_pos = np.arange(valid) * (UPDATE_HZ / OUT_RATE)
            env_s = np.interp(env_pos, np.arange(len(env)), env).astype(np.float32)
            gain = (seq_vol / 127.0) * (master_vol / 127.0) * (n.vol / 127.0) * (n.expr / 127.0) * (n.vel / 127.0)
            pan = max(0, min(127, n.pan + (inst_pan - 64)))
            p = pan / 127.0 * (math.pi / 2)
            mono = sig[:valid] * env_s * gain
            s0i = int(start * OUT_RATE)
            e = min(len(out), s0i + valid)
            if e <= s0i:
                continue
            out[s0i:e, 0] += mono[: e - s0i] * math.cos(p)
            out[s0i:e, 1] += mono[: e - s0i] * math.sin(p)
        return out


# ---------------------------------------------------------------------------

def write_wav(path, data, rate):
    pcm = np.clip(data * 32767, -32768, 32767).astype('<i2')
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + pcm.nbytes) + b'WAVE')
        f.write(b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 2, rate, rate * 4, 4, 16))
        f.write(b'data' + struct.pack('<I', pcm.nbytes))
        f.write(pcm.tobytes())


def encode(wav, base):
    outs = {}
    for ext, args in (('ogg', ['-c:a', 'libvorbis', '-q:a', '3']), ('m4a', ['-c:a', 'aac', '-b:a', '112k'])):
        target = base + '.' + ext
        try:
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, *args, target], check=True)
            outs[ext] = os.path.basename(target)
        except Exception as e:  # noqa: BLE001
            print('  encode failed', ext, e)
    return outs


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    sdat_path, out_dir, names = sys.argv[1], sys.argv[2], sys.argv[3:]
    os.makedirs(out_dir, exist_ok=True)
    sdat = Sdat(open(sdat_path, 'rb').read())
    meta_path = os.path.join(out_dir, 'tracks.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for name in names:
        seq = sdat.seq(name)
        notes, tick_time, loop, master_vol = sequence(seq['file'])
        synth = Synth(sdat, seq['bank'])
        audio = synth.render(notes, tick_time, seq['vol'], master_vol)
        # trim silence at the end, normalise
        level = np.max(np.abs(audio)) or 1.0
        audio = audio / level * 0.89
        nz = np.nonzero(np.max(np.abs(audio), axis=1) > 1e-4)[0]
        end = int(nz[-1]) + 1 if len(nz) else len(audio)
        if loop:
            loop_len_s = tick_time[loop[1]] - tick_time[loop[0]]
            loop_start_s = tick_time[loop[0]] + loop_len_s  # second pass
            loop_end_s = loop_start_s + loop_len_s
            end = min(len(audio), int((loop_end_s + 0.5) * OUT_RATE))
        audio = audio[:end]
        if loop:
            # fade the tail after the loop end so an unlooped play does not stop dead
            tail = int(0.5 * OUT_RATE)
            audio[-tail:] *= np.linspace(1, 0, tail, dtype=np.float32)[:, None]
        base = os.path.join(out_dir, name.lower())
        wav = base + '.wav'
        write_wav(wav, audio, OUT_RATE)
        files = encode(wav, base)
        entry = {'files': files, 'duration': len(audio) / OUT_RATE, 'notes': len(notes)}
        if loop:
            entry['loopStart'] = loop_start_s
            entry['loopEnd'] = loop_end_s
        meta[name] = entry
        print(f"{name}: {len(notes)} notes, {len(audio) / OUT_RATE:.1f}s, loop {entry.get('loopStart')}..{entry.get('loopEnd')}")
    json.dump(meta, open(meta_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
