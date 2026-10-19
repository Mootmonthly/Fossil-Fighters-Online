import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  canRotate, findVivosaur, getVivosaur, previewDamage, rotationCost, skillAvailability, supportPercent, tileDistance, ZONE_DEPTH, ZONE_NAMES,
  type BattleAction, type BattleEvent, type BattleState, type BattleVivosaur, type Zone,
} from '@ffo/shared';
import type { Snapshot } from '../api.js';
import { Medal, spriteSrc } from '../components/Vivo.js';

type SideIndex = 0 | 1;

interface StartPayload {
  roomId: string;
  kind: 'ranked' | 'private' | 'solo';
  side: SideIndex;
  state: BattleState;
  players: string[];
  turnDeadline: number;
  turnSeconds: number;
}

interface EndPayload {
  winner: SideIndex | null;
  reason: string | null;
  reward: { gold: number; rankPoints: number; won: boolean | null } | null;
  state: BattleState;
}

interface Float {
  id: number;
  side: SideIndex;
  slot: number;
  text: string;
  kind: 'dmg' | 'heal' | 'crit' | 'miss';
}

export function BattleScreen({ snap, socket, notify, refresh }: { snap: Snapshot; socket: Socket | null; notify: (t: string, e?: boolean) => void; refresh: () => Promise<void> }) {
  const [battle, setBattle] = useState<StartPayload | null>(null);
  const [state, setState] = useState<BattleState | null>(null);
  const [end, setEnd] = useState<EndPayload | null>(null);
  const [queued, setQueued] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [deadline, setDeadline] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [shake, setShake] = useState<string | null>(null);
  const floatId = useRef(0);
  const [disconnected, setDisconnected] = useState<string | null>(null);

  const pushFloats = useCallback((events: BattleEvent[]) => {
    const add: Float[] = [];
    for (const e of events) {
      if (e.type === 'damage' && e.amount > 0) add.push({ id: ++floatId.current, side: e.side, slot: e.slot, text: `-${e.amount}`, kind: e.crit ? 'crit' : 'dmg' });
      if (e.type === 'heal' && e.amount > 0) add.push({ id: ++floatId.current, side: e.side, slot: e.slot, text: `+${e.amount}`, kind: 'heal' });
      if (e.type === 'miss') add.push({ id: ++floatId.current, side: e.side, slot: e.slot, text: 'MISS', kind: 'miss' });
    }
    if (add.length) {
      setFloats((f) => [...f, ...add]);
      setShake(`${add[0].side}-${add[0].slot}`);
      window.setTimeout(() => setShake(null), 400);
      window.setTimeout(() => setFloats((f) => f.filter((x) => !add.includes(x))), 1300);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onStart = (p: StartPayload) => {
      setBattle(p);
      setState(p.state);
      setEnd(null);
      setDeadline(p.turnDeadline);
      setQueued(false);
      setRoomCode(null);
      setDisconnected(null);
    };
    const onUpdate = (p: { state: BattleState; events: BattleEvent[]; turnDeadline: number }) => {
      setState(p.state);
      setDeadline(p.turnDeadline);
      pushFloats(p.events);
    };
    const onEnd = (p: EndPayload) => {
      setEnd(p);
      setState(p.state);
      refresh();
    };
    const onRejected = (p: { message: string }) => notify(p.message, true);
    const onTimer = (p: { turnDeadline: number }) => setDeadline(p.turnDeadline);
    const onQueue = (p: { queued: boolean }) => setQueued(p.queued);
    const onRoom = (p: { code: string }) => setRoomCode(p.code);
    const onError = (p: { message: string }) => notify(p.message, true);
    const onDisc = (p: { side: SideIndex; graceSeconds: number }) => setDisconnected(`Opponent disconnected. They have ${p.graceSeconds}s to return or they forfeit.`);
    socket.on('battle:start', onStart);
    socket.on('battle:update', onUpdate);
    socket.on('battle:end', onEnd);
    socket.on('battle:rejected', onRejected);
    socket.on('battle:timer', onTimer);
    socket.on('queue:status', onQueue);
    socket.on('room:created', onRoom);
    socket.on('error', onError);
    socket.on('battle:opponentDisconnected', onDisc);
    return () => {
      socket.off('battle:start', onStart);
      socket.off('battle:update', onUpdate);
      socket.off('battle:end', onEnd);
      socket.off('battle:rejected', onRejected);
      socket.off('battle:timer', onTimer);
      socket.off('queue:status', onQueue);
      socket.off('room:created', onRoom);
      socket.off('error', onError);
      socket.off('battle:opponentDisconnected', onDisc);
    };
  }, [socket, notify, refresh, pushFloats]);

  const act = useCallback((action: BattleAction) => socket?.emit('battle:action', action), [socket]);

  if (!socket) return <div className="panel">Connecting…</div>;

  if (battle && state) {
    return (
      <Arena
        battle={battle}
        state={state}
        end={end}
        deadline={deadline}
        floats={floats}
        shake={shake}
        disconnected={disconnected}
        act={act}
        leave={() => {
          setBattle(null);
          setState(null);
          setEnd(null);
        }}
      />
    );
  }

  const team = snap.user.team.map((id) => snap.vivosaurs.find((v) => v.id === id)).filter(Boolean);
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="panel">
        <h2>Fossil Battle</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted small">Your team:</span>
          {team.length === 0 ? <span className="muted">none set</span> : team.map((v) => <Medal key={v!.id} speciesId={v!.displaySpeciesId} title={findVivosaur(v!.displaySpeciesId)?.name} />)}
        </div>
        <div className="grid">
          <div className="card">
            <b>Solo battle</b>
            <div className="small muted">Fight a bot team matched to your ranks. Good for testing teams and earning a little G.</div>
            <button className="primary" disabled={team.length === 0} onClick={() => socket.emit('solo:start')}>Start solo battle</button>
          </div>
          <div className="card">
            <b>Ranked match</b>
            <div className="small muted">Queue up against another online fighter. Needs a full team of three. Winner takes the prize money.</div>
            {queued ? (
              <button onClick={() => socket.emit('queue:leave')}>Searching for an opponent… (cancel)</button>
            ) : (
              <button className="primary" disabled={team.length < 3} onClick={() => socket.emit('queue:join')}>Find a match</button>
            )}
          </div>
          <div className="card">
            <b>Private room</b>
            <div className="small muted">Battle a friend with a room code.</div>
            <div className="row">
              <button onClick={() => socket.emit('room:create')}>Create room</button>
              {roomCode && <span className="badge" style={{ fontSize: 16 }}>Code: {roomCode}</span>}
            </div>
            <div className="row">
              <input placeholder="Enter code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ width: 130 }} />
              <button disabled={joinCode.length < 4} onClick={() => socket.emit('room:join', joinCode)}>Join</button>
            </div>
          </div>
        </div>
      </div>
      <div className="panel">
        <h3>Battle rules (Champions)</h3>
        <ul className="muted small" style={{ lineHeight: 1.6, paddingLeft: 18 }}>
          <li>The team with the higher total Speed moves first. FP recharges every turn (hero level 20: +230, max 900).</li>
          <li>Each vivosaur may use one skill per turn. Rotating the formation costs 5 FP per step, up to 15, until a skill is used.</li>
          <li>Front tiles are the Attack Zone (AZ); rear tiles are the Support Zone (SZ). SZ vivosaurs apply their support effects to AZ vivosaurs, halved when two share the AZ.</li>
          <li>Range matters: Close-Range hits hardest at 1 tile, Mid-Range at 3, Long-Range at 7. Water beats Fire beats Earth beats Air beats Water for 1.5× damage.</li>
          <li>Team Skills need a compatible trio and cannot score critical hits.</li>
          <li>Turns are limited to 75 seconds. Leaving a match counts as a forfeit.</li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

const W = 1000, H = 600, MIDX = 500, MIDY = 300;
const HEX_RX = 60, HEX_RY = 40;

/** Horizontal field: the player's team stands on the left facing right, the enemy on the right facing left. */
function zonePos(zone: Zone, mine: boolean): { x: number; y: number } {
  const depth = ZONE_DEPTH[zone];
  const lateral = zone === 1 || zone === 2 ? -1 : zone === 4 || zone === 5 ? 1 : 0;
  const dx = 95 + depth * 118;
  const x = mine ? MIDX - dx : MIDX + dx;
  const y = MIDY + lateral * 128;
  return { x, y };
}

function hexPoints(x: number, y: number, rx: number, ry: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${x + rx * Math.cos(a)},${y + ry * Math.sin(a)}`;
  }).join(' ');
}

function Hex({ x, y, className, onClick }: { x: number; y: number; className: string; onClick?: () => void }) {
  return (
    <g onClick={onClick}>
      <polygon points={hexPoints(x, y + 8, HEX_RX, HEX_RY)} fill="rgba(0,0,0,.25)" />
      <polygon points={hexPoints(x, y, HEX_RX, HEX_RY)} className={className} />
      <polygon points={hexPoints(x, y, HEX_RX - 8, HEX_RY - 6)} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={2} pointerEvents="none" />
    </g>
  );
}

const STATUS_SHORT: Record<string, string> = { poison: 'PSN', sleep: 'SLP', scare: 'SCR', excite: 'EXC', confuse: 'CNF', enrage: 'ENR', infection: 'INF', enflame: 'ATK↑', harden: 'DEF↑', quicken: 'SPD↑', counter: 'CTR', charge: 'CHG' };

function Arena({ battle, state, end, deadline, floats, shake, disconnected, act, leave }: { battle: StartPayload; state: BattleState; end: EndPayload | null; deadline: number; floats: Float[]; shake: string | null; disconnected: string | null; act: (a: BattleAction) => void; leave: () => void }) {
  const me = battle.side;
  const them: SideIndex = me === 0 ? 1 : 0;
  const mySide = state.sides[me];
  const myTurn = state.active === me && state.phase === 'active';
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [selSkill, setSelSkill] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!myTurn) setSelSkill(null);
  }, [myTurn, state.turn]);

  const selected = selSlot !== null ? mySide.vivosaurs[selSlot] : null;
  const skills = selected ? skillAvailability(state, me, selected.slot) : [];
  const skillData = selSkill !== null && selected ? getVivosaur(selected.speciesId).skills[selSkill] : null;
  const needsTarget = skillData ? skillData.target === 'enemy' || skillData.target === 'ally' : false;

  const legalTargets = useMemo(() => {
    const set = new Set<string>();
    if (!skillData || !selected) return set;
    if (skillData.target === 'enemy') for (const v of state.sides[them].vivosaurs) if (!v.ko) set.add(`${them}-${v.slot}`);
    if (skillData.target === 'ally') for (const v of mySide.vivosaurs) if (!v.ko && !(skillData.effects.some((e) => e.type === 'lawOfTheJungle') && v.slot === selected.slot)) set.add(`${me}-${v.slot}`);
    return set;
  }, [skillData, selected, state, me, them, mySide]);

  const fire = (target?: { side: SideIndex; slot: number }) => {
    if (!selected || selSkill === null) return;
    act({ type: 'skill', slot: selected.slot, skill: selSkill, target });
    setSelSkill(null);
  };

  const clickVivo = (side: SideIndex, v: BattleVivosaur) => {
    if (!myTurn) return;
    if (skillData && needsTarget && legalTargets.has(`${side}-${v.slot}`)) return fire({ side, slot: v.slot });
    if (side === me && !v.ko) {
      setSelSlot(v.slot);
      setSelSkill(null);
    }
  };

  const rot = canRotate(state, me);
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  const formation = (side: SideIndex) => (state.sides[side].vivosaurs.some((v) => v.zone === 0) ? 'Cambrian' : 'Jurassic');

  const supportArrows = (side: SideIndex, v: BattleVivosaur) => {
    if (v.ko) return [];
    const out: { label: string; value: number }[] = [];
    for (const [k, label] of [['attack', 'ATK'], ['defense', 'DEF'], ['accuracy', 'ACC'], ['speed', 'SPD']] as const) {
      const pct = supportPercent(state, side, v, k);
      if (pct !== 0) out.push({ label, value: pct });
    }
    return out;
  };

  const renderVivo = (side: SideIndex, v: BattleVivosaur) => {
    const mine = side === me;
    const { x, y } = zonePos(v.zone, mine);
    const species = getVivosaur(v.speciesId);
    const isAz = ZONE_DEPTH[v.zone] <= 1;
    const targetable = legalTargets.has(`${side}-${v.slot}`);
    const isSel = mine && selSlot === v.slot;
    const hp = v.maxLp ? v.lp / v.maxLp : 0;
    const key = `${side}-${v.slot}`;
    const dist = selected && !mine ? tileDistance(selected.zone, v.zone) : null;
    const prev = selected && selSkill !== null && !mine && skillData?.power !== null && skillData?.power !== undefined ? previewDamage(state, me, selected.slot, selSkill, { side, slot: v.slot }) : null;
    const arrows = supportArrows(side, v);
    const spriteSize = 112;
    return (
      <g key={key} className={shake === key ? 'shake' : ''} style={{ cursor: targetable || (mine && !v.ko) ? 'pointer' : 'default' }}>
        <Hex x={x} y={y} className={`hex ${isAz ? 'az' : 'sz'} ${mine ? 'mine' : 'theirs'} ${targetable ? 'targetable' : ''} ${isSel ? 'selected' : ''} ${v.ko ? 'ko' : ''}`} onClick={() => clickVivo(side, v)} />
        <g pointerEvents="none">
          <text x={x} y={y + HEX_RY - 6} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,.75)" fontWeight={700}>{ZONE_NAMES[v.zone]}{dist !== null ? ` · ${dist} tiles` : ''}</text>
          {!v.ko ? (
            <image href={spriteSrc(species.id)} x={x - spriteSize / 2} y={y - spriteSize + 14} width={spriteSize} height={spriteSize} className="vivo-sprite" transform={mine ? `translate(${x * 2},0) scale(-1,1)` : undefined} preserveAspectRatio="xMidYMax meet" />
          ) : (
            <text x={x} y={y - 8} textAnchor="middle" fontSize={16} fill="#d8d8d8" fontWeight={900} style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 4 }}>KO</text>
          )}
          {/* name plate above the sprite */}
          <rect x={x - 64} y={y - spriteSize - 4} width={128} height={18} rx={9} fill="rgba(0,0,0,.55)" />
          <text x={x} y={y - spriteSize + 9} textAnchor="middle" fontSize={12} fontWeight={900} fill="#fff">{v.name}{v.rank < 20 ? ` · R${v.rank}` : ''}</text>
          {/* LP bar beneath the tile */}
          <rect x={x - 52} y={y + HEX_RY + 8} width={104} height={12} rx={6} fill="rgba(0,0,0,.6)" />
          <rect x={x - 50} y={y + HEX_RY + 10} width={100 * hp} height={8} rx={4} className={`hpbar-fill ${hp < 0.25 ? 'low' : hp < 0.5 ? 'mid' : ''}`} />
          <text x={x} y={y + HEX_RY + 32} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 3 }}>{v.lp} / {v.maxLp}</text>
          {arrows.length > 0 && (
            <text x={x} y={y + HEX_RY + 45} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#ffe08a" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 2.5 }}>
              {arrows.map((a) => `${a.label}${a.value > 0 ? '↑' : '↓'}${Math.abs(a.value)}%`).join('  ')}
            </text>
          )}
          {v.statuses.length > 0 && (
            <text x={x} y={y + HEX_RY + (arrows.length ? 57 : 45)} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#9ad7ff" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 2.5 }}>
              {v.statuses.map((st) => `${STATUS_SHORT[st.kind] ?? st.kind}${st.tier >= 2 ? '+' : ''}`).join(' ')}
            </text>
          )}
          {prev && (
            <text x={x} y={y - spriteSize - 12} textAnchor="middle" fontSize={12} fill="#ffd56b" fontWeight={900} style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 3 }}>
              {prev.min}–{prev.max} dmg · range ×{prev.rangeMult}{prev.elementMult !== 1 ? ` · element ×${prev.elementMult}` : ''}
            </text>
          )}
          {floats.filter((f) => f.side === side && f.slot === v.slot).map((f) => (
            <text key={f.id} x={x} y={y - 30} textAnchor="middle" className={`float-dmg ${f.kind === 'heal' ? 'heal' : f.kind === 'crit' ? 'crit' : f.kind === 'miss' ? 'miss' : ''}`}>{f.text}{f.kind === 'crit' ? '!' : ''}</text>
          ))}
        </g>
      </g>
    );
  };

  // Draw order: back-most first so front sprites overlap correctly.
  const drawOrder = (side: SideIndex) => [...state.sides[side].vivosaurs].sort((a, b) => zonePos(a.zone, side === me).y - zonePos(b.zone, side === me).y);

  return (
    <div className="battle">
      <div className="arena" style={{ position: 'relative' }}>
        <div className="turn-banner">{state.phase === 'finished' ? 'Battle over' : myTurn ? `Your turn · ${secondsLeft}s` : `${battle.players[them]}'s turn · ${secondsLeft}s`} · Turn {state.turn}</div>
        <svg viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f0cf7a" />
              <stop offset="0.55" stopColor="#dfb45a" />
              <stop offset="1" stopColor="#c99a3e" />
            </linearGradient>
            <radialGradient id="spot" cx="0.5" cy="0.5" r="0.7">
              <stop offset="0" stopColor="#fff2c2" stopOpacity="0.55" />
              <stop offset="1" stopColor="#fff2c2" stopOpacity="0" />
            </radialGradient>
            <filter id="grain" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.1  0 0 0 0.35 0" />
            </filter>
            <pattern id="honey" width="104" height="60" patternUnits="userSpaceOnUse" patternTransform="translate(0,0)">
              <polygon points={hexPoints(52, 30, 34, 20)} fill="none" stroke="#8a5a22" strokeOpacity="0.28" strokeWidth="2" />
              <polygon points={hexPoints(0, 0, 34, 20)} fill="none" stroke="#8a5a22" strokeOpacity="0.28" strokeWidth="2" />
              <polygon points={hexPoints(104, 0, 34, 20)} fill="none" stroke="#8a5a22" strokeOpacity="0.28" strokeWidth="2" />
              <polygon points={hexPoints(0, 60, 34, 20)} fill="none" stroke="#8a5a22" strokeOpacity="0.28" strokeWidth="2" />
              <polygon points={hexPoints(104, 60, 34, 20)} fill="none" stroke="#8a5a22" strokeOpacity="0.28" strokeWidth="2" />
            </pattern>
            <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5a1f16" />
              <stop offset="1" stopColor="#8b3a24" />
            </linearGradient>
          </defs>
          {/* arena floor */}
          <rect width={W} height={H} fill="url(#sand)" />
          <rect width={W} height={H} filter="url(#grain)" opacity="0.5" />
          <rect width={W} height={H} fill="url(#honey)" />
          <ellipse cx={MIDX} cy={MIDY} rx={420} ry={240} fill="url(#spot)" />
          {/* stadium wall at the top */}
          <rect x={0} y={0} width={W} height={34} fill="url(#wall)" />
          <rect x={0} y={34} width={W} height={6} fill="#f3d9a0" opacity="0.8" />
          {Array.from({ length: 50 }, (_, i) => (
            <circle key={i} cx={10 + i * 20} cy={12 + ((i * 7) % 3) * 5} r={3} fill={['#ffd1a1', '#ff9b6b', '#c9e7ff', '#ffe36b'][i % 4]} opacity="0.55" />
          ))}
          {/* centre divider */}
          <rect x={MIDX - 16} y={40} width={32} height={H - 40} fill="#6b3f1d" />
          <rect x={MIDX - 6} y={40} width={12} height={H - 40} fill="#a86f38" />
          <rect x={MIDX - 16} y={40} width={32} height={H - 40} fill="none" stroke="#3e2410" strokeWidth={3} />
          {/* side labels */}
          <rect x={12} y={6} width={300} height={22} rx={11} fill="rgba(0,0,0,.45)" />
          <text x={24} y={22} fontSize={13} fontWeight={900} fill="#ffe9c4">{battle.players[me]} (you) · {formation(me)} formation</text>
          <rect x={W - 312} y={6} width={300} height={22} rx={11} fill="rgba(0,0,0,.45)" />
          <text x={W - 24} y={22} fontSize={13} fontWeight={900} fill="#dbe9ff" textAnchor="end">{battle.players[them]} · {formation(them)} formation</text>
          {drawOrder(them).map((v) => renderVivo(them, v))}
          {drawOrder(me).map((v) => renderVivo(me, v))}
          {/* FP counters */}
          <g>
            <rect x={14} y={H - 58} width={150} height={44} rx={10} fill="#b4311f" stroke="#ffcf8a" strokeWidth={2} />
            <text x={30} y={H - 30} fontSize={14} fontWeight={900} fill="#ffe9c4">FP</text>
            <text x={152} y={H - 26} fontSize={24} fontWeight={900} fill="#fff" textAnchor="end">{mySide.fp}</text>
            <rect x={W - 164} y={H - 58} width={150} height={44} rx={10} fill="#1f4fb4" stroke="#bcd7ff" strokeWidth={2} />
            <text x={W - 148} y={H - 30} fontSize={14} fontWeight={900} fill="#dbe9ff">FP</text>
            <text x={W - 26} y={H - 26} fontSize={24} fontWeight={900} fill="#fff" textAnchor="end">{state.sides[them].fp}</text>
          </g>
        </svg>
        {disconnected && !end && <div className="turn-banner" style={{ top: 'auto', bottom: 10 }}>{disconnected}</div>}
        {end && (
          <div className="overlay">
            <div className="panel">
              <h2>{end.winner === null ? 'Draw' : end.winner === me ? 'Victory!' : 'Defeat'}</h2>
              <div className="muted">{end.reason === 'forfeit' ? 'The battle ended by forfeit.' : end.reason === 'turn limit' ? 'Turn limit reached.' : 'All vivosaurs on one side were knocked out.'}</div>
              {end.reward && (
                <div style={{ marginTop: 10 }}>
                  <div className="gold">+{end.reward.gold.toLocaleString()} G</div>
                  <div className="small muted">Every vivosaur that fought gained {end.reward.rankPoints} rank points.</div>
                </div>
              )}
              <button className="primary" style={{ marginTop: 12 }} onClick={leave}>Back to lobby</button>
            </div>
          </div>
        )}
      </div>

      <div className="panel side-panel">
        <div>
          <div className="row small" style={{ justifyContent: 'space-between' }}><b>FP</b><span>{mySide.fp} / {mySide.fpMax} (+{mySide.fpGain}/turn)</span></div>
          <div className="fpbar"><div style={{ width: `${(mySide.fp / mySide.fpMax) * 100}%` }} /></div>
          {mySide.teamCompatible ? <div className="small" style={{ color: 'var(--good)' }}>Team Skills available</div> : <div className="small muted">Team not compatible (no Team Skills)</div>}
        </div>
        <div className="row">
          <button disabled={!myTurn || !rot.ok || mySide.fp < rotationCost(mySide, 1)} title={rot.reason} onClick={() => act({ type: 'rotate', steps: 1, direction: -1 })}>↺ Rotate ({rotationCost(mySide, 1)} FP)</button>
          <button disabled={!myTurn || !rot.ok || mySide.fp < rotationCost(mySide, 1)} title={rot.reason} onClick={() => act({ type: 'rotate', steps: 1, direction: 1 })}>Rotate ↻</button>
        </div>
        <div className="row">
          <button className="primary" disabled={!myTurn} onClick={() => act({ type: 'endTurn' })}>End turn</button>
          <button className="danger" disabled={state.phase !== 'active'} onClick={() => { if (confirm('Forfeit this battle?')) act({ type: 'forfeit' }); }}>Forfeit</button>
        </div>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            {mySide.vivosaurs.map((v) => (
              <button key={v.slot} className={selSlot === v.slot ? 'primary' : ''} disabled={v.ko} onClick={() => { setSelSlot(v.slot); setSelSkill(null); }} style={{ padding: '4px 8px' }}>
                <Medal speciesId={v.speciesId} />
              </button>
            ))}
          </div>
          {selected ? (
            <>
              <div className="small muted" style={{ marginBottom: 4 }}>
                <b style={{ color: 'var(--text)' }}>{selected.name}</b> · {getVivosaur(selected.speciesId).range}-range · {ZONE_NAMES[selected.zone]} {selected.acted ? '· acted' : ''}
              </div>
              <div className="skill-list">
                {skills.map((a) => (
                  <button key={a.index} className={`skill ${a.skill.kind} ${selSkill === a.index ? 'selected' : ''}`} disabled={!myTurn || !a.usable} title={a.reason} onClick={() => {
                    if (a.skill.target === 'enemy' || a.skill.target === 'ally') setSelSkill(a.index);
                    else { setSelSkill(a.index); act({ type: 'skill', slot: selected.slot, skill: a.index }); setSelSkill(null); }
                  }}>
                    <span className="name">{a.skill.name}{a.skill.kind === 'team' ? ' ★' : ''}</span>
                    <span>{a.skill.power ?? '—'} · {a.skill.fp} FP</span>
                    <span className="meta">{a.skill.text || (a.skill.target === 'allEnemies' ? 'Hits every enemy' : a.skill.target === 'enemy' ? 'Single target' : '')}{a.reason ? ` · ${a.reason}` : ''}</span>
                  </button>
                ))}
              </div>
              {needsTarget && selSkill !== null && <div className="small" style={{ color: 'var(--accent)', marginTop: 6 }}>Choose a {skillData?.target === 'enemy' ? 'target' : 'teammate'} on the field.</div>}
            </>
          ) : (
            <div className="small muted">Select one of your vivosaurs to see its skills.</div>
          )}
        </div>
        <BattleLog state={state} me={me} players={battle.players} />
      </div>
    </div>
  );
}

function BattleLog({ state, me, players }: { state: BattleState; me: SideIndex; players: string[] }) {
  const lines = useMemo(() => {
    const name = (side: SideIndex, slot: number) => state.sides[side].vivosaurs[slot]?.name ?? '?';
    const who = (side: SideIndex) => (side === me ? 'You' : players[side]);
    const out: { cls: string; text: string }[] = [];
    for (const e of state.log.slice(-80)) {
      switch (e.type) {
        case 'battleStart': out.push({ cls: 'ev-turn', text: `Battle start! ${who(e.first)} move${e.first === me ? '' : 's'} first (speed ${e.speeds[0]} vs ${e.speeds[1]}).` }); break;
        case 'turnStart': out.push({ cls: 'ev-turn', text: `Turn ${e.turn}: ${who(e.side)} (+${e.fpGained} FP → ${e.fp})` }); break;
        case 'skill': out.push({ cls: '', text: `${name(e.side, e.slot)} used ${e.skillName}${e.fpCost ? ` (${e.fpCost} FP)` : ''}${e.targets.length === 1 ? ` on ${name(e.targets[0].side, e.targets[0].slot)}` : ''}.` }); break;
        case 'damage':
          if (e.source === 'skill') out.push({ cls: 'ev-damage', text: `${name(e.side, e.slot)} took ${e.amount} damage${e.crit ? ' (critical!)' : ''}${e.elementMult > 1 ? ' (elemental advantage)' : ''}.` });
          else if (e.source === 'counter') out.push({ cls: 'ev-damage', text: `Countered! ${name(e.side, e.slot)} took ${e.amount} damage.` });
          else out.push({ cls: 'ev-damage', text: `${name(e.side, e.slot)} took ${e.amount} damage from ${e.source === 'autoCounter' ? 'Auto Counter' : e.source}.` });
          break;
        case 'miss': out.push({ cls: '', text: `The attack on ${name(e.side, e.slot)} missed.` }); break;
        case 'heal': out.push({ cls: 'ev-heal', text: `${name(e.side, e.slot)} recovered ${e.amount} LP (${e.source}).` }); break;
        case 'status': out.push({ cls: 'ev-status', text: e.applied ? `${name(e.side, e.slot)} is afflicted with ${e.tier >= 2 ? 'Super ' : ''}${e.status}.` : `${name(e.side, e.slot)} resisted ${e.status}.` }); break;
        case 'cure': out.push({ cls: 'ev-heal', text: `${name(e.side, e.slot)} was cured of ailments.` }); break;
        case 'statusExpired': out.push({ cls: '', text: `${name(e.side, e.slot)}'s ${e.status} wore off.` }); break;
        case 'ko': out.push({ cls: 'ev-damage', text: `${name(e.side, e.slot)} was knocked out!` }); break;
        case 'resurrect': out.push({ cls: 'ev-heal', text: `${name(e.side, e.slot)} rose again!` }); break;
        case 'transform': out.push({ cls: 'ev-status', text: `${findVivosaur(e.from)?.name ?? e.from} transformed into ${findVivosaur(e.to)?.name ?? e.to}!` }); break;
        case 'rotate': out.push({ cls: '', text: `${who(e.side)} rotated ${Math.abs(e.steps)} step${Math.abs(e.steps) === 1 ? '' : 's'}${e.cause === 'skill' ? ' (knocked by a skill)' : e.cause === 'excite' ? ' (Super Excite)' : ''}${e.fpCost ? ` for ${e.fpCost} FP` : ''}.` }); break;
        case 'fp': if (e.amount) out.push({ cls: '', text: `${who(e.side)} ${e.amount > 0 ? 'gained' : 'lost'} ${Math.abs(e.amount)} FP (${e.source}).` }); break;
        case 'confused': out.push({ cls: 'ev-status', text: `${name(e.side, e.slot)} is confused${e.acted ? ' and lashed out' : ' and did nothing'}.` }); break;
        case 'link': out.push({ cls: '', text: `${name(e.side, e.slot)} joined in with Link!` }); break;
        case 'wake': out.push({ cls: '', text: `${name(e.side, e.slot)} woke up.` }); break;
        case 'forfeit': out.push({ cls: 'ev-turn', text: `${who(e.side)} forfeited.` }); break;
        case 'battleEnd': out.push({ cls: 'ev-turn', text: e.winner === null ? 'The battle ended in a draw.' : `${who(e.winner)} won the battle!` }); break;
        default: break;
      }
    }
    return out.reverse();
  }, [state.log, me, players, state.sides]);
  return (
    <div className="log">
      {lines.map((l, i) => (
        <div key={i} className={l.cls}>{l.text}</div>
      ))}
    </div>
  );
}
