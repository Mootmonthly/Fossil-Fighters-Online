/**
 * Background music: the game's own tracks, rendered from its sound archive, played through Web Audio so that
 * songs loop seamlessly at their real loop points. Browsers only allow sound after a user gesture, so the
 * context is created on the first pointer or key event and whatever was requested before then starts at that moment.
 */

export type MusicRole = 'menu' | 'cleaning' | 'prepare' | 'battle';
export type JingleRole = 'win' | 'lose' | 'cleanSuccess' | 'cleanFail';

interface TrackMeta {
  files: { ogg?: string; m4a?: string };
  duration: number;
  loopStart?: number;
  loopEnd?: number;
}

const ROLE_TRACKS: Record<MusicRole | JingleRole, string> = {
  menu: 'BGM_SEQ_FLD03_KASEKIGUILD',
  cleaning: 'BGM_SEQ_CLEANING',
  prepare: 'BGM_SEQ_BTL_PREPARE',
  battle: 'BGM_SEQ_BTL_NORMAL',
  win: 'JINGLE_SEQ_BTL_WIN',
  lose: 'JINGLE_SEQ_BTLLOSE',
  cleanSuccess: 'JINGLE_SEQ_KEZURI_SUCCESS1',
  cleanFail: 'JINGLE_SEQ_KEZURI_FAILURE',
};

const FADE = 0.7;

interface Playing {
  role: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private meta: Promise<Record<string, TrackMeta>> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private current: Playing | null = null;
  private wanted: MusicRole | null = null;
  private jingleActive = false;
  private listeners = new Set<() => void>();
  volume = Number(localStorage.getItem('ffo.volume') ?? '0.5');
  muted = localStorage.getItem('ffo.muted') === '1';
  unlocked = false;

  constructor() {
    const unlock = () => {
      this.unlocked = true;
      this.ensureContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      if (this.wanted && !this.current) this.play(this.wanted);
      this.emit();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private loadMeta() {
    if (!this.meta) this.meta = fetch('/audio/tracks.json').then((r) => r.json() as Promise<Record<string, TrackMeta>>);
    return this.meta;
  }

  private async buffer(track: string): Promise<AudioBuffer> {
    let p = this.buffers.get(track);
    if (!p) {
      p = (async () => {
        const meta = (await this.loadMeta())[track];
        if (!meta) throw new Error(`no track ${track}`);
        const probe = document.createElement('audio');
        const file = meta.files.ogg && probe.canPlayType('audio/ogg; codecs=vorbis') ? meta.files.ogg : meta.files.m4a ?? meta.files.ogg;
        const data = await (await fetch(`/audio/${file}`)).arrayBuffer();
        const ctx = this.ensureContext()!;
        return await ctx.decodeAudioData(data);
      })();
      this.buffers.set(track, p);
      p.catch(() => this.buffers.delete(track));
    }
    return p;
  }

  /** Switches the looping background track with a short crossfade. */
  play(role: MusicRole) {
    this.wanted = role;
    if (!this.unlocked || this.jingleActive) return;
    if (this.current?.role === role) return;
    void this.start(ROLE_TRACKS[role], role, true);
  }

  /** Plays a one-shot jingle over silence, then resumes the background track that is wanted by then. */
  jingle(role: JingleRole) {
    if (!this.unlocked) return;
    this.jingleActive = true;
    void this.start(ROLE_TRACKS[role], role, false).then((src) => {
      if (!src) {
        this.jingleActive = false;
        return;
      }
      src.onended = () => {
        this.jingleActive = false;
        if (this.current?.source === src) this.current = null;
        if (this.wanted) this.play(this.wanted);
      };
    });
  }

  private async start(track: string, role: string, loop: boolean): Promise<AudioBufferSourceNode | null> {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return null;
    let buf: AudioBuffer;
    let meta: TrackMeta;
    try {
      [buf, meta] = await Promise.all([this.buffer(track), this.loadMeta().then((m) => m[track])]);
    } catch {
      return null;
    }
    // the wanted track may have changed while loading
    if (loop && this.wanted !== role) return null;
    if (loop && this.current?.role === role) return this.current.source;
    const now = ctx.currentTime;
    this.fadeOutCurrent(now, loop ? FADE : 0.15);
    const source = ctx.createBufferSource();
    source.buffer = buf;
    if (loop && meta.loopStart !== undefined && meta.loopEnd !== undefined) {
      source.loop = true;
      source.loopStart = meta.loopStart;
      source.loopEnd = meta.loopEnd;
    } else if (loop) {
      source.loop = true;
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(loop ? 0.0001 : 1, now);
    if (loop) gain.gain.exponentialRampToValueAtTime(1, now + FADE);
    source.connect(gain);
    gain.connect(this.master);
    source.start(now);
    this.current = { role, source, gain };
    return source;
  }

  private fadeOutCurrent(now: number, seconds: number) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    cur.source.onended = null;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(Math.max(0.0001, cur.gain.gain.value), now);
    cur.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    cur.source.stop(now + seconds + 0.05);
  }

  stop() {
    this.wanted = null;
    if (this.ctx) this.fadeOutCurrent(this.ctx.currentTime, FADE);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('ffo.volume', String(this.volume));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem('ffo.muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
    this.emit();
  }
}

export const music = new Music();
