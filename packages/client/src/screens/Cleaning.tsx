import { useCallback, useEffect, useRef, useState } from 'react';
import { CLEANING_TIME_SECONDS, findVivosaur, MIN_CLEAN_SCORE, nextRandom } from '@ffo/shared';
import { api, type CleanResult, type FossilView, type Snapshot } from '../api.js';
import { Medal } from '../components/Vivo.js';
import { RockIcon } from './Shop.js';

type Run = <T extends Snapshot>(fn: () => Promise<T>) => Promise<T | null>;
type Tool = 'hammer' | 'drill';

const COLS = 64;
const ROWS = 48;
const CELL = 10;

interface Cell {
  rock: number; // 0..3 layers remaining
  fossil: boolean;
  damaged: boolean;
}

interface Dig {
  cells: Cell[];
  fossilCells: number;
  delicate: boolean;
  dark: boolean;
  hardness: number; // hammer removes this many layers per hit (soft rock = 2)
}

/** Deterministic rock layout from the server-provided seed. The species stays hidden; only the shape differs. */
function generateDig(fossil: FossilView): Dig {
  let st = fossil.rockSeed || 1;
  const rnd = () => {
    const r = nextRandom(st);
    st = r.state;
    return r.value;
  };
  const cells: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ rock: 3, fossil: false, damaged: false }));
  // Rock outline: an irregular blob; outside the blob there is no rock at all.
  const cx = COLS / 2, cy = ROWS / 2;
  const wobble = Array.from({ length: 12 }, () => 0.75 + rnd() * 0.3);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const dx = (x - cx) / (COLS * 0.46), dy = (y - cy) / (ROWS * 0.46);
      const ang = Math.atan2(dy, dx);
      const idx = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 12) % 12;
      const r = Math.hypot(dx, dy);
      if (r > wobble[idx]) cells[y * COLS + x].rock = 0;
    }
  }
  // Fossil shape: several overlapping ellipses, biased by part type.
  const part = fossil.part ?? 'head';
  const blobs = part === 'head' ? 3 : part === 'body' ? 5 : part === 'arms' ? 4 : 4;
  const shapes: { x: number; y: number; rx: number; ry: number; rot: number }[] = [];
  for (let i = 0; i < blobs; i++) {
    shapes.push({
      x: cx + (rnd() - 0.5) * COLS * 0.35,
      y: cy + (rnd() - 0.5) * ROWS * 0.35,
      rx: part === 'body' ? 5 + rnd() * 9 : 4 + rnd() * 7,
      ry: part === 'arms' || part === 'legs' ? 2.5 + rnd() * 4 : 3 + rnd() * 6,
      rot: rnd() * Math.PI,
    });
  }
  let fossilCells = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = cells[y * COLS + x];
      if (c.rock === 0) continue;
      for (const s of shapes) {
        const dx = x - s.x, dy = y - s.y;
        const u = (dx * Math.cos(s.rot) + dy * Math.sin(s.rot)) / s.rx;
        const v = (-dx * Math.sin(s.rot) + dy * Math.cos(s.rot)) / s.ry;
        if (u * u + v * v <= 1) {
          c.fossil = true;
          break;
        }
      }
      if (c.fossil) fossilCells++;
    }
  }
  const delicate = fossil.kind === 'wondrous' || fossil.kind === 'miraculous';
  return { cells, fossilCells, delicate, dark: fossil.kind === 'dark', hardness: rnd() < 0.3 ? 2 : 1 };
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
                  <RockIcon kind={f.kind} element={f.element} />
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
  const digRef = useRef<Dig>(generateDig(fossil));
  const [tool, setTool] = useState<Tool>('hammer');
  const [xray, setXray] = useState(0); // remaining uses
  const [xrayUntil, setXrayUntil] = useState(0);
  const [timeLeft, setTimeLeft] = useState(CLEANING_TIME_SECONDS);
  const [stats, setStats] = useState(() => scoreOf(digRef.current));
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());
  const drilling = useRef(false);
  const lastDrill = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    setXray(2);
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setDone(true);
    const s = scoreOf(digRef.current);
    onFinish(s.score, Date.now() - startRef.current);
  }, [onFinish]);

  // Timer
  useEffect(() => {
    const id = window.setInterval(() => {
      const left = CLEANING_TIME_SECONDS - Math.floor((Date.now() - startRef.current) / 1000);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) finish();
    }, 250);
    return () => window.clearInterval(id);
  }, [finish]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const dig = digRef.current;
      const showX = Date.now() < xrayUntil;
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = dig.cells[y * COLS + x];
          let color: string | null = null;
          if (c.rock > 0) {
            color = dig.dark && c.rock === 3 ? '#1d1a24' : c.rock === 3 ? '#5a4634' : c.rock === 2 ? '#7a5e45' : '#a98a63';
            if (showX && c.fossil) color = c.rock === 3 ? '#6b7a86' : c.rock === 2 ? '#8ea0ad' : '#b7c6d1';
          } else if (c.fossil) {
            color = c.damaged ? '#7b3fa0' : fossil.kind === 'wondrous' ? '#dfe7f2' : fossil.kind === 'miraculous' ? '#f4cf5a' : fossil.redBoned ? '#e0a0a0' : '#f1e9d2';
          } else {
            // Check whether this cell is inside the rock blob at all (no fossil, rock cleared): dirt.
            color = '#3b3028';
          }
          ctx.fillStyle = color;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          if (c.rock > 0 && ((x * 7 + y * 13) % 11 === 0)) {
            ctx.fillStyle = 'rgba(255,255,255,.06)';
            ctx.fillRect(x * CELL + 2, y * CELL + 2, 3, 3);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [xrayUntil, fossil.kind, fossil.redBoned]);

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * COLS;
    const y = ((e.clientY - rect.top) / rect.height) * ROWS;
    return { x, y };
  };

  const strike = useCallback((x: number, y: number, t: Tool) => {
    const dig = digRef.current;
    const radius = t === 'hammer' ? 2.6 : 1.3;
    const power = t === 'hammer' ? dig.hardness : 1;
    let changed = false;
    for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
      for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        if (d > radius) continue;
        const c = dig.cells[cy * COLS + cx];
        if (c.rock > 0) {
          if (t === 'drill' && dig.dark && c.rock === 3) continue; // dark shell resists the drill
          c.rock = Math.max(0, c.rock - power);
          changed = true;
          // Hammer can crack bone right under the last layer on delicate rocks.
          if (c.rock === 0 && c.fossil && t === 'hammer' && dig.delicate && d < radius * 0.6) c.damaged = true;
        } else if (c.fossil && !c.damaged) {
          // Exposed fossil hit directly.
          if (t === 'hammer' && d < radius * 0.8) {
            c.damaged = true;
            changed = true;
          } else if (t === 'drill' && d < 0.6 && Math.random() < (dig.delicate ? 0.35 : 0.12)) {
            c.damaged = true;
            changed = true;
          }
        }
      }
    }
    if (changed) setStats(scoreOf(dig));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (done) return;
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
    if (Date.now() - lastDrill.current < 45) return;
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
      <div>
        <canvas
          ref={canvasRef}
          width={COLS * CELL}
          height={ROWS * CELL}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrill}
          onPointerLeave={stopDrill}
          onPointerCancel={stopDrill}
        />
      </div>
      <div className="panel side-panel">
        <h3 style={{ textTransform: 'capitalize' }}>{fossil.kind} rock</h3>
        <div className="small muted">Contains a {partLabel}{fossil.redBoned ? ' (red-boned: +25 bonus)' : ''}.</div>
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
          <button className="primary" disabled={done} onClick={finish}>Finish cleaning</button>
          <button disabled={done} onClick={onCancel}>Back (keep rock)</button>
        </div>
      </div>
    </div>
  );
}
