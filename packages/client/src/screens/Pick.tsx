import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { FORMATION_ZONES, isTeamCompatible, ZONE_NAMES, type Formation, type Zone } from '@ffo/shared';
import { ElementBadge, Medal } from '../components/Vivo.js';

export interface PickView {
  id: number;
  speciesId: string;
  name: string;
  rank: number;
  element: string;
  range: string;
  stats: { lp: number; attack: number; defense: number; accuracy: number; speed: number };
}

export interface PickPayload {
  roomId: string;
  kind: 'ranked' | 'private' | 'solo';
  side: 0 | 1;
  pickDeadline: number;
  pickSeconds: number;
  picks: number;
  players: string[];
  you: PickView[];
  opponent: PickView[];
}

const SLOT_HINTS: Record<Formation, string[]> = {
  cambrian: ['AZ+ · front, closest to the enemy', 'SZ · rear, upper', 'SZ · rear, lower'],
  jurassic: ['AZ · front, upper', 'SZ+ · rear centre', 'AZ · front, lower'],
};

/** Small hex flower showing where the three slots start in each formation (you are on the left, facing right). */
function FlowerDiagram({ formation }: { formation: Formation }) {
  const angles: Record<Zone, number> = { 0: 0, 1: -60, 2: -120, 3: 180, 4: 120, 5: 60 };
  const R = 30, HR = 16;
  const zones = FORMATION_ZONES[formation];
  const hex = (cx: number, cy: number) => Array.from({ length: 6 }, (_, i) => `${cx + HR * Math.cos((Math.PI / 3) * i - Math.PI / 2)},${cy + HR * Math.sin((Math.PI / 3) * i - Math.PI / 2)}`).join(' ');
  return (
    <svg viewBox="0 0 176 120" width={176} height={120} aria-hidden>
      <polygon points={hex(62, 60)} fill="#e9dfbf" stroke="#8a7a52" />
      {([0, 1, 2, 3, 4, 5] as Zone[]).map((z) => {
        const a = (angles[z] * Math.PI) / 180;
        const cx = 62 + R * Math.cos(a), cy = 60 + R * Math.sin(a);
        const slot = zones.indexOf(z);
        return (
          <g key={z}>
            <polygon points={hex(cx, cy)} fill={slot >= 0 ? '#f6c23a' : '#e9dfbf'} stroke={slot >= 0 ? '#4a3410' : '#8a7a52'} strokeWidth={slot >= 0 ? 2 : 1} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={slot >= 0 ? 12 : 8} fontWeight={800} fill={slot >= 0 ? '#2d2415' : '#8a7a52'}>{slot >= 0 ? slot + 1 : ZONE_NAMES[z]}</text>
          </g>
        );
      })}
      <text x={122} y={64} fontSize={10} fill="#6e5e43" fontWeight={800}>enemy →</text>
    </svg>
  );
}

function PickCard({ v, index, onClick, dim }: { v: PickView; index?: number; onClick?: () => void; dim?: boolean }) {
  return (
    <div className={`card pick-card ${onClick ? 'selectable' : ''} ${index !== undefined ? 'selected' : ''} ${dim ? 'dim' : ''}`} onClick={onClick}>
      {index !== undefined && <span className="slot-tag">{index + 1}</span>}
      <div className="row" style={{ gap: 8 }}>
        <Medal speciesId={v.speciesId} />
        <div>
          <b>{v.name}</b>
          <div className="small muted">Rank {v.rank} · {v.range}-range</div>
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <ElementBadge element={v.element as never} />
        <span className="badge">LP {v.stats.lp}</span>
      </div>
      <div className="small muted">ATK {v.stats.attack} · DEF {v.stats.defense} · ACC {v.stats.accuracy} · SPD {v.stats.speed}</div>
    </div>
  );
}

export function PickScreen({ pick, ready, socket }: { pick: PickPayload; ready: boolean[]; socket: Socket }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [formation, setFormation] = useState<Formation>('cambrian');
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    setChosen([]);
    setLocked(false);
    setFormation('cambrian');
  }, [pick.roomId]);
  const need = Math.min(pick.picks, pick.you.length);
  const secondsLeft = Math.max(0, Math.ceil((pick.pickDeadline - now) / 1000));
  const chosenViews = chosen.map((id) => pick.you.find((v) => v.id === id)!).filter(Boolean);
  const compatible = useMemo(() => chosenViews.length === 3 && isTeamCompatible(chosenViews.map((v) => v.speciesId)), [chosenViews]);
  const toggle = (id: number) => {
    if (locked) return;
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < need ? [...c, id] : c));
  };
  const lockIn = () => {
    if (chosen.length !== need) return;
    socket.emit('battle:choose', { ids: chosen, formation });
    setLocked(true);
  };
  const me = pick.side, them = (1 - pick.side) as 0 | 1;
  return (
    <div className="pick">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Choose your fighters</h2>
          <div className={`pick-timer ${secondsLeft <= 10 ? 'low' : ''}`}>{secondsLeft}s</div>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Study {pick.players[them]}'s team, then pick {need} of yours in slot order and choose a formation. If the timer runs out, your first {need} go in Cambrian formation.
        </p>
        <div className="pick-columns">
          <div>
            <h3>{pick.players[them]}'s team {ready[them] ? <span className="badge" style={{ color: 'var(--good)' }}>locked in</span> : <span className="badge muted">choosing…</span>}</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {pick.opponent.map((v) => <PickCard key={v.id} v={v} dim />)}
            </div>
          </div>
          <div>
            <h3>Your team · {chosen.length}/{need} chosen</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {pick.you.map((v) => <PickCard key={v.id} v={v} index={chosen.includes(v.id) ? chosen.indexOf(v.id) : undefined} onClick={() => toggle(v.id)} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="panel pick-side">
        <h3>Formation</h3>
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button className={formation === 'cambrian' ? 'primary' : ''} disabled={locked} onClick={() => setFormation('cambrian')}>Cambrian</button>
          <button className={formation === 'jurassic' ? 'primary' : ''} disabled={locked} onClick={() => setFormation('jurassic')}>Jurassic</button>
        </div>
        <FlowerDiagram formation={formation} />
        <div className="small muted" style={{ marginBottom: 8 }}>
          {formation === 'cambrian' ? 'One attacker up front backed by two supporters: full support effects, one target for the enemy.' : 'Two attackers up front and one supporter behind: more attacks, but support effects are halved.'}
        </div>
        <ol className="slots">
          {Array.from({ length: need }, (_, i) => (
            <li key={i}>
              <span className="slot-tag">{i + 1}</span>
              <div>
                <b>{chosenViews[i]?.name ?? <span className="muted">click a vivosaur</span>}</b>
                <div className="small muted">{SLOT_HINTS[formation][i]}</div>
              </div>
            </li>
          ))}
        </ol>
        {need === 3 && (compatible ? <div className="badge" style={{ color: 'var(--good)' }}>Team Skills available ✓</div> : chosen.length === 3 ? <div className="badge muted">No Team Skill for this trio</div> : null)}
        <div style={{ marginTop: 12 }}>
          {locked ? (
            <div className="muted">Locked in. {ready[them] ? 'Starting…' : `Waiting for ${pick.players[them]}…`}</div>
          ) : (
            <button className="primary" style={{ width: '100%' }} disabled={chosen.length !== need} onClick={lockIn}>Lock in</button>
          )}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>{pick.players[me]} vs {pick.players[them]} · {pick.kind} battle</div>
      </div>
    </div>
  );
}
