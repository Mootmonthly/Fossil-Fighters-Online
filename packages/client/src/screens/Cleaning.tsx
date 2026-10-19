import { useCallback, useEffect, useRef, useState } from 'react';
import { CLEANING_TIME_SECONDS, findVivosaur, MIN_CLEAN_SCORE, nextRandom } from '@ffo/shared';
import { api, type CleanResult, type FossilView, type Snapshot } from '../api.js';
import { Medal } from '../components/Vivo.js';
import { drawFossil, type BoneStyle } from './fossilArt.js';

type Run = <T extends Snapshot>(fn: () => Promise<T>) => Promise<T | null>;
type Tool = 'hammer' | 'drill';

const COLS = 128;
const ROWS = 96;
const CELL = 5;
const ROCK_SHAPES = 18;

interface Cell {
  rock: number; // 0..3 layers remaining (-1 = outside the rock)
  fossil: boolean;
  damaged: boolean;
}

interface Dig {
  cells: Cell[];
  fossilCells: number;
  delicate: boolean;
  dark: boolean;
  hardness: number; // layers the hammer removes per hit (soft rock = 2)
  rockCanvas: HTMLCanvasElement; // official rock icon scaled up: the surface layer
  boneCanvas: HTMLCanvasElement; // procedural fossil artwork
}

export function rockShape(seed: number): number {
  return (Math.abs(seed) % ROCK_SHAPES) + 1;
}

export function rockIconSrc(seed: number): string {
  return `/img/rocks/${String(rockShape(seed)).padStart(2, '0')}.png`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hash(x: number, y: number): number {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Builds the dig from the server-provided seed: official rock silhouette, procedural bones inside it. */
async function generateDig(fossil: FossilView): Promise<Dig> {
  let st = fossil.rockSeed || 1;
  const rnd = () => {
    const r = nextRandom(st);
    st = r.state;
    return r.value;
  };
  const W = COLS * CELL, H = ROWS * CELL;
  const img = await loadImage(rockIconSrc(fossil.rockSeed));
  const cells: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ rock: -1, fossil: false, damaged: false }));
  const rockCanvas = document.createElement('canvas');
  rockCanvas.width = W;
  rockCanvas.height = H;
  const rctx = rockCanvas.getContext('2d')!;
  rctx.imageSmoothingEnabled = false;
  let minX = COLS, maxX = 0, minY = ROWS, maxY = 0;
  if (img) {
    // The wiki icon is a small rock drawn on a pale card. Read it at native size, flood-fill the bright
    // card/backdrop pixels from the border, and keep the unreached (darker or enclosed) pixels as rock.
    const iw = img.width, ih = img.height;
    const small = document.createElement('canvas');
    small.width = iw;
    small.height = ih;
    const sctx = small.getContext('2d')!;
    sctx.drawImage(img, 0, 0);
    const d = sctx.getImageData(0, 0, iw, ih).data;
    const bright = (i: number) => d[i * 4 + 3] < 40 || 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2] > 212;
    const reached = new Uint8Array(iw * ih);
    const stack: number[] = [];
    for (let x = 0; x < iw; x++) stack.push(x, (ih - 1) * iw + x);
    for (let y = 0; y < ih; y++) stack.push(y * iw, y * iw + iw - 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (reached[i] || !bright(i)) continue;
      reached[i] = 1;
      const x = i % iw, y = Math.floor(i / iw);
      if (x > 0) stack.push(i - 1);
      if (x < iw - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - iw);
      if (y < ih - 1) stack.push(i + iw);
    }
    let bx0 = iw, bx1 = 0, by0 = ih, by1 = 0;
    for (let i = 0; i < iw * ih; i++) {
      if (reached[i]) continue;
      const x = i % iw, y = Math.floor(i / iw);
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    const bw0 = Math.max(1, bx1 - bx0 + 1), bh0 = Math.max(1, by1 - by0 + 1);
    // Scale the rock to fill most of the tray. The icons are drawn flat, so stretch them vertically
    // towards a 3:2 silhouette to leave room for the fossil.
    const sx = Math.max(2, Math.floor((W * 0.84) / bw0));
    const sy = Math.max(sx, Math.min(sx * 3, Math.floor((H * 0.84) / bh0), Math.round((sx * bw0) / 1.5 / bh0)));
    const dw = bw0 * sx, dh = bh0 * sy;
    const ox = Math.floor((W - dw) / 2), oy = Math.floor((H - dh) / 2);
    rctx.drawImage(img, bx0, by0, bw0, bh0, ox, oy, dw, dh);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * CELL + 2 - ox, py = y * CELL + 2 - oy;
        if (px < 0 || py < 0 || px >= dw || py >= dh) continue;
        const ix = bx0 + Math.floor(px / sx), iy = by0 + Math.floor(py / sy);
        if (reached[iy * iw + ix]) continue;
        cells[y * COLS + x].rock = 3;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  } else {
    rctx.fillStyle = '#c8b070';
    rctx.beginPath();
    rctx.ellipse(W / 2, H / 2, W * 0.4, H * 0.42, 0, 0, Math.PI * 2);
    rctx.fill();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const dx = (x + 0.5 - COLS / 2) / (COLS * 0.4), dy = (y + 0.5 - ROWS / 2) / (ROWS * 0.42);
        if (dx * dx + dy * dy <= 1) {
          cells[y * COLS + x].rock = 3;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  // Fossil inside the rock's bounding box, leaving a margin of stone around it.
  const part = (fossil.part ?? 'head') as 'head' | 'body' | 'arms' | 'legs';
  const style: BoneStyle = fossil.kind === 'wondrous' ? 'silver' : fossil.kind === 'miraculous' ? 'gold' : fossil.redBoned ? 'red' : 'normal';
  const boneCanvas = document.createElement('canvas');
  boneCanvas.width = W;
  boneCanvas.height = H;
  const bctx = boneCanvas.getContext('2d')!;
  const bw = (maxX - minX + 1) * CELL, bh = (maxY - minY + 1) * CELL;
  const box = { x: minX * CELL + bw * 0.14, y: minY * CELL + bh * 0.16, w: bw * 0.72, h: bh * 0.68 };
  drawFossil(bctx, part, style, fossil.rockSeed, box);
  const bonePixels = bctx.getImageData(0, 0, W, H).data;
  let fossilCells = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = cells[y * COLS + x];
      if (c.rock < 0) continue;
      // a cell counts as bone when most of its pixels are drawn
      let hit = 0;
      for (let sy = 0; sy < CELL; sy += 2) for (let sx = 0; sx < CELL; sx += 2) if (bonePixels[((y * CELL + sy) * W + x * CELL + sx) * 4 + 3] > 90) hit++;
      if (hit >= 5) {
        c.fossil = true;
        fossilCells++;
      }
    }
  }
  const delicate = fossil.kind === 'wondrous' || fossil.kind === 'miraculous';
  return { cells, fossilCells: Math.max(1, fossilCells), delicate, dark: fossil.kind === 'dark', hardness: rnd() < 0.3 ? 2 : 1, rockCanvas, boneCanvas };
}

function scoreOf(dig: Dig): { exposed: number; damage: number; score: number } {
  let exposed = 0, damaged = 0;
  for (const c of dig.cells) {
    if (!c.fossil) continue;
    if (c.damaged) damaged++;
    else if (c.rock === 0) exposed++;
  }
  const exposedPct = (exposed / dig.fossilCells) * 100;
  const damagePct = (damaged / dig.fossilCells) * 100 * (dig.delicate ? 2.5 : 2);
  return { exposed: exposedPct, damage: Math.min(100, damagePct), score: Math.max(0, Math.min(100, Math.round(exposedPct - damagePct))) };
}

export function CleaningScreen({ snap, run, notify, initialFossil, onDone }: { snap: Snapshot; run: Run; notify: (t: string, e?: boolean) => void; initialFossil: number | null; onDone: () => void }) {
  const rocks = snap.fossils.filter((f) => f.state === 'rock');
  const [active, setActive] = useState<FossilView | null>(() => rocks.find((f) => f.id === initialFossil) ?? null);
  const [result, setResult] = useState<CleanResult | null>(null);

  if (active) {
    return (
      <CleaningGame
        fossil={active}
        onFinish={async (score, durationMs) => {
          const out = await run(() => api.clean(active.id, score, durationMs));
          setActive(null);
          onDone();
          if (out) {
            setResult(out.result);
            notify(out.result.message, !out.result.success);
          }
        }}
        onCancel={() => { setActive(null); onDone(); }}
      />
    );
  }

  return (
    <div className="grid">
      {result && (
        <div className="panel" style={{ borderColor: result.success ? 'var(--good)' : 'var(--bad)' }}>
          <div className="row">
            {result.vivosaur && <Medal speciesId={result.vivosaur.displaySpeciesId} big />}
            <div>
              <h3>{result.success ? (result.newSpecies ? 'New vivosaur revived!' : 'Fossil cleaned') : 'Cleaning failed'}</h3>
              <div>{result.message}</div>
              {result.vivosaur && <div className="small muted">{findVivosaur(result.vivosaur.displaySpeciesId)?.name} is now rank {result.vivosaur.rank}.</div>}
            </div>
            <div className="spacer" style={{ flex: 1 }} />
            <button onClick={() => setResult(null)}>Dismiss</button>
          </div>
        </div>
      )}
      <div className="panel">
        <h2>Cleaning Room</h2>
        <p className="muted small">Pick a rock. Use the <b>hammer</b> for the outer layers (it breaks fossil that is already exposed) and the <b>drill</b> near the bone. Reach {MIN_CLEAN_SCORE} points before time runs out. Wondrous and miraculous rocks are delicate, and dark rock's outer shell only yields to the hammer.</p>
        {rocks.length === 0 ? (
          <p className="muted">No uncleaned rocks. Buy some in the Fossil Shop.</p>
        ) : (
          <div className="grid cards">
            {rocks.map((f) => (
              <div key={f.id} className="card">
                <div className="row">
                  <img src={rockIconSrc(f.rockSeed)} alt="" width={48} height={48} style={{ imageRendering: 'pixelated', filter: f.kind === 'dark' ? 'brightness(.35) saturate(.3)' : f.kind === 'wondrous' ? 'saturate(.2) brightness(1.2)' : f.kind === 'miraculous' ? 'hue-rotate(-10deg) saturate(1.8)' : undefined }} />
                  <div>
                    <b style={{ textTransform: 'capitalize' }}>{f.kind} rock</b>
                    <div className="small muted">{f.element ? `${f.element} type` : f.kind === 'wondrous' ? `silver ${f.part}` : f.kind === 'miraculous' ? 'gold fossil' : 'unknown'}</div>
                  </div>
                </div>
                <div className="row">
                  <button className="primary" onClick={() => setActive(f)}>Clean</button>
                  <button onClick={async () => { const out = await run(() => api.sell(f.id)); if (out) notify(`Sold for ${out.value} G`); }}>Sell</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CleaningGame({ fossil, onFinish, onCancel }: { fossil: FossilView; onFinish: (score: number, durationMs: number) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const digRef = useRef<Dig | null>(null);
  const dirty = useRef(true);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('hammer');
  const [xray, setXray] = useState(2);
  const [xrayUntil, setXrayUntil] = useState(0);
  const [timeLeft, setTimeLeft] = useState(CLEANING_TIME_SECONDS);
  const [stats, setStats] = useState({ exposed: 0, damage: 0, score: 0 });
  const [done, setDone] = useState(false);
  const startRef = useRef(0);
  const drilling = useRef(false);
  const lastDrill = useRef(0);
  const finishedRef = useRef(false);

  // Build the dig (loads the rock icon) and start the clock when it is ready.
  useEffect(() => {
    let cancelled = false;
    generateDig(fossil).then((dig) => {
      if (cancelled) return;
      digRef.current = dig;
      dirty.current = true;
      startRef.current = Date.now();
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fossil]);

  const finish = useCallback(() => {
    if (finishedRef.current || !digRef.current) return;
    finishedRef.current = true;
    setDone(true);
    const s = scoreOf(digRef.current);
    onFinish(s.score, Date.now() - startRef.current);
  }, [onFinish]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const left = CLEANING_TIME_SECONDS - Math.floor((Date.now() - startRef.current) / 1000);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) finish();
    }, 250);
    return () => window.clearInterval(id);
  }, [ready, finish]);

  // Render loop: redraws only when something changed (or the X-ray is active).
  useEffect(() => {
    let raf = 0;
    let lastXray = false;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current, dig = digRef.current;
      if (!canvas || !dig) return;
      const showX = Date.now() < xrayUntil;
      if (!dirty.current && showX === lastXray) return;
      dirty.current = false;
      lastXray = showX;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      // cleaning tray
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, '#3a3f4b');
      g.addColorStop(1, '#23262e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,.04)';
      for (let i = 0; i < canvas.height; i += 24) ctx.fillRect(0, i, canvas.width, 1);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = dig.cells[y * COLS + x];
          if (c.rock < 0) continue;
          const px = x * CELL, py = y * CELL;
          const n = hash(x, y);
          if (c.rock === 3) {
            if (dig.dark) {
              ctx.fillStyle = n < 0.5 ? '#2a2333' : '#231c2b';
              ctx.fillRect(px, py, CELL, CELL);
            } else {
              ctx.drawImage(dig.rockCanvas, px, py, CELL, CELL, px, py, CELL, CELL);
              if (n < 0.12) {
                ctx.fillStyle = 'rgba(0,0,0,.18)';
                ctx.fillRect(px, py, CELL, CELL);
              }
            }
          } else if (c.rock === 2) {
            ctx.fillStyle = n < 0.5 ? '#b2935c' : n < 0.85 ? '#a58753' : '#8f7345';
            ctx.fillRect(px, py, CELL, CELL);
          } else if (c.rock === 1) {
            ctx.fillStyle = n < 0.5 ? '#d9c08c' : n < 0.85 ? '#cdb47f' : '#bfa470';
            ctx.fillRect(px, py, CELL, CELL);
          } else if (c.fossil) {
            ctx.drawImage(dig.boneCanvas, px, py, CELL, CELL, px, py, CELL, CELL);
            if (c.damaged) {
              ctx.fillStyle = 'rgba(128, 48, 170, .78)';
              ctx.fillRect(px, py, CELL, CELL);
            }
          } else {
            ctx.fillStyle = n < 0.5 ? '#4e3d2d' : n < 0.85 ? '#45362a' : '#3b2e24';
            ctx.fillRect(px, py, CELL, CELL);
          }
          if (showX && c.fossil && c.rock > 0) {
            ctx.fillStyle = 'rgba(120, 200, 255, .55)';
            ctx.fillRect(px, py, CELL, CELL);
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [xrayUntil, ready]);

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * COLS, y: ((e.clientY - rect.top) / rect.height) * ROWS };
  };

  const strike = useCallback((x: number, y: number, t: Tool) => {
    const dig = digRef.current;
    if (!dig) return;
    const radius = t === 'hammer' ? 5.5 : 2.4;
    const power = t === 'hammer' ? dig.hardness : 1;
    let changed = false;
    for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
      for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        if (d > radius) continue;
        const c = dig.cells[cy * COLS + cx];
        if (c.rock < 0) continue;
        if (c.rock > 0) {
          if (t === 'drill' && dig.dark && c.rock === 3) continue; // the dark shell resists the drill
          c.rock = Math.max(0, c.rock - power);
          changed = true;
          if (c.rock === 0 && c.fossil && t === 'hammer' && dig.delicate && d < radius * 0.6) c.damaged = true;
        } else if (c.fossil && !c.damaged) {
          if (t === 'hammer' && d < radius * 0.75) {
            c.damaged = true;
            changed = true;
          } else if (t === 'drill' && d < 1.2 && Math.random() < (dig.delicate ? 0.3 : 0.1)) {
            c.damaged = true;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      dirty.current = true;
      setStats(scoreOf(dig));
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (done || !ready) return;
    const { x, y } = cellAt(e);
    if (tool === 'hammer') strike(x, y, 'hammer');
    else {
      drilling.current = true;
      strike(x, y, 'drill');
      lastDrill.current = Date.now();
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (done || tool !== 'drill' || !drilling.current) return;
    if (Date.now() - lastDrill.current < 40) return;
    const { x, y } = cellAt(e);
    strike(x, y, 'drill');
    lastDrill.current = Date.now();
  };
  const stopDrill = () => {
    drilling.current = false;
  };

  useEffect(() => {
    if (stats.damage > 50 && !finishedRef.current) finish(); // the red bar passed the line
  }, [stats, finish]);

  const partLabel = fossil.kind === 'wondrous' ? `silver ${fossil.part} fossil` : fossil.kind === 'miraculous' ? 'gold fossil' : `${fossil.part} fossil`;
  return (
    <div className="cleaning">
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={COLS * CELL}
          height={ROWS * CELL}
          className={tool}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrill}
          onPointerLeave={stopDrill}
          onPointerCancel={stopDrill}
        />
        {!ready && <div className="overlay" style={{ borderRadius: 12 }}><div className="panel">Preparing the rock…</div></div>}
      </div>
      <div className="panel side-panel">
        <div className="row">
          <img src={rockIconSrc(fossil.rockSeed)} alt="" width={48} height={48} style={{ imageRendering: 'pixelated' }} />
          <div>
            <h3 style={{ textTransform: 'capitalize', margin: 0 }}>{fossil.kind} rock</h3>
            <div className="small muted">Contains a {partLabel}{fossil.redBoned ? ' (red-boned: +25 bonus)' : ''}.</div>
          </div>
        </div>
        <div className={`timer ${timeLeft <= 15 ? 'low' : ''}`}>{timeLeft}s</div>
        <div>
          <div className="row small" style={{ justifyContent: 'space-between' }}><span>Progress</span><b>{stats.score} pts</b></div>
          <div className="meter">
            <div className="fill" style={{ width: `${stats.exposed}%` }} />
            <div className="damage" style={{ width: `${stats.damage}%` }} />
            <div className="line" style={{ left: `${MIN_CLEAN_SCORE}%` }} />
          </div>
          <div className="small muted">Blue fills as bone is uncovered; red grows with damage. Pass the white line to succeed.</div>
        </div>
        <div className="tools">
          <button className={tool === 'hammer' ? 'active' : ''} onClick={() => setTool('hammer')}>🔨 Hammer</button>
          <button className={tool === 'drill' ? 'active' : ''} onClick={() => setTool('drill')}>🔩 Drill</button>
          <button disabled={xray <= 0} onClick={() => { setXray((n) => n - 1); setXrayUntil(Date.now() + 2500); }}>X-ray ({xray})</button>
        </div>
        <div className="row">
          <button className="primary" disabled={done || !ready} onClick={finish}>Finish cleaning</button>
          <button disabled={done} onClick={onCancel}>Back (keep rock)</button>
        </div>
      </div>
    </div>
  );
}
