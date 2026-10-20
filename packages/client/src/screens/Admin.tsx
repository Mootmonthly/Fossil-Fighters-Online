import { useEffect, useMemo, useState } from 'react';
import { findVivosaur, obtainableVivosaurs, PARTS } from '@ffo/shared';
import { api, type AdminStats, type AdminUserDetail, type AdminUserRow } from '../api.js';
import { ElementBadge, Medal } from '../components/Vivo.js';

type Tab = 'players' | 'stats';

export function AdminScreen({ notify }: { notify: (t: string, e?: boolean) => void }) {
  const [tab, setTab] = useState<Tab>('players');
  return (
    <div className="grid">
      <div className="tabs">
        <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>Players</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Vivosaur statistics</button>
      </div>
      {tab === 'players' ? <Players notify={notify} /> : <Stats />}
    </div>
  );
}

function Players({ notify }: { notify: (t: string, e?: boolean) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [gold, setGold] = useState('1000');
  const [rock, setRock] = useState({ kind: 'normal', element: 'any', species: '', part: 'any' });
  const load = (query: string) => api.admin.users(query).then((r) => setUsers(r.users)).catch((e) => notify(e.message, true));
  useEffect(() => {
    load('');
  }, []);
  const open = (id: number) => api.admin.user(id).then(setDetail).catch((e) => notify(e.message, true));
  const species = useMemo(() => obtainableVivosaurs(), []);
  const speciesId = species.find((v) => v.name.toLowerCase() === rock.species.trim().toLowerCase())?.id ?? null;

  const grantGold = async () => {
    if (!detail) return;
    try {
      const out = await api.admin.grantGold(detail.user.id, Number(gold));
      setDetail(out.detail);
      notify(`${detail.user.username} now has ${out.gold.toLocaleString()} G`);
      load(q);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const grantRock = async () => {
    if (!detail) return;
    if (rock.species && !speciesId) return notify('Unknown vivosaur name', true);
    try {
      const out = await api.admin.grantRock(detail.user.id, { kind: rock.kind, element: rock.element, speciesId, part: rock.part === 'any' ? null : rock.part });
      setDetail(out.detail);
      notify(`Rock #${out.fossilId} added to ${detail.user.username}'s case`);
      load(q);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: detail ? '1fr 1.3fr' : '1fr' }}>
      <div className="panel">
        <h2>Players</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); load(q); }}>
          <input placeholder="Search username" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit">Search</button>
        </form>
        <table className="admin-table">
          <thead><tr><th>#</th><th>Player</th><th>Gold</th><th>Elo · W/L</th><th>Vivos</th><th>Rocks</th><th>Joined</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={detail?.user.id === u.id ? 'active' : ''} onClick={() => open(u.id)}>
                <td>{u.id}</td><td><b>{u.username}</b>{u.is_admin ? ' ★' : ''}</td><td>{u.gold.toLocaleString()}</td><td>{u.elo} · {u.wins}/{u.losses}</td><td>{u.vivosaurs}</td><td>{u.rocks}</td><td className="small muted">{u.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="grid">
          <div className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{detail.user.username}</h2>
              <button onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="row" style={{ gap: 24 }}>
              <div><div className="muted small">Gold</div><b className="gold">{detail.user.gold.toLocaleString()} G</b></div>
              <div><div className="muted small">Elo</div><b>{detail.user.elo}</b></div>
              <div><div className="muted small">Ranked record</div><b>{detail.user.wins} W / {detail.user.losses} L</b></div>
              <div><div className="muted small">Vivosaurs</div><b>{detail.vivosaurs.length}</b></div>
              <div><div className="muted small">Rocks</div><b>{detail.fossils.filter((f) => f.state === 'rock').length}</b></div>
              <div><div className="muted small">Joined</div><b>{detail.user.createdAt.slice(0, 10)}</b></div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small muted">Chat: {detail.user.muted ? 'muted' : 'allowed'}</span>
              <button className={detail.user.muted ? '' : 'danger'} onClick={async () => { try { const out = await api.admin.mute(detail.user.id, !detail.user.muted); setDetail(out.detail); notify(out.detail.user.muted ? `${detail.user.username} muted` : `${detail.user.username} unmuted`); } catch (e) { notify((e as Error).message, true); } }}>{detail.user.muted ? 'Unmute in chat' : 'Mute in chat'}</button>
            </div>
            <h3 style={{ marginTop: 14 }}>Grant gold</h3>
            <div className="row">
              <input type="number" value={gold} onChange={(e) => setGold(e.target.value)} style={{ width: 140 }} />
              <button className="primary" onClick={grantGold}>Give G</button>
              <span className="small muted">Negative amounts take gold away.</span>
            </div>
            <h3 style={{ marginTop: 14 }}>Grant a fossil rock</h3>
            <div className="row">
              <select value={rock.kind} onChange={(e) => setRock({ ...rock, kind: e.target.value })}>
                <option value="normal">Normal rock</option><option value="dark">Dark rock (red-boned head)</option><option value="wondrous">Wondrous rock (silver)</option><option value="miraculous">Miraculous rock (gold)</option>
              </select>
              <select value={rock.element} onChange={(e) => setRock({ ...rock, element: e.target.value })} disabled={rock.kind !== 'normal' || !!speciesId}>
                <option value="any">Any element</option><option value="fire">Fire</option><option value="water">Water</option><option value="earth">Earth</option><option value="air">Air</option><option value="neutral">Neutral</option>
              </select>
              <input list="species-names" placeholder="Vivosaur (optional)" value={rock.species} onChange={(e) => setRock({ ...rock, species: e.target.value })} disabled={rock.kind === 'wondrous' || rock.kind === 'miraculous'} style={{ width: 170 }} />
              <datalist id="species-names">{species.map((v) => <option key={v.id} value={v.name} />)}</datalist>
              <select value={rock.part} onChange={(e) => setRock({ ...rock, part: e.target.value })} disabled={rock.kind === 'dark' || rock.kind === 'miraculous'}>
                <option value="any">Any part</option>{PARTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="primary" onClick={grantRock}>Give rock</button>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>A rock with a named vivosaur is shown to the player as identified, like a featured-shop rock.</div>
          </div>
          <div className="panel">
            <h3>Vivosaurs</h3>
            <table className="admin-table">
              <thead><tr><th></th><th>Vivosaur</th><th>Rank</th><th>Points</th><th>Head</th><th>Body</th><th>Arms</th><th>Legs</th><th>Silver / Gold</th></tr></thead>
              <tbody>
                {detail.vivosaurs.map((v) => (
                  <tr key={v.id}>
                    <td><Medal speciesId={v.displaySpeciesId} /></td><td><b>{v.nickname ?? findVivosaur(v.displaySpeciesId)?.name}</b>{v.nickname ? <span className="small muted"> ({findVivosaur(v.speciesId)?.name})</span> : null}</td>
                    <td>{v.rank}</td><td>{v.rankPoints}</td><td>{v.parts.head || '—'}</td><td>{v.parts.body || '—'}</td><td>{v.parts.arms || '—'}</td><td>{v.parts.legs || '—'}</td>
                    <td className="small">{v.silver ? `silver ${v.silver.part} ${v.silver.score}` : ''}{v.gold !== null ? ` gold ${v.gold}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Fossil case</h3>
            <table className="admin-table">
              <thead><tr><th>#</th><th>Rock</th><th>Contents</th><th>State</th><th>Score</th></tr></thead>
              <tbody>
                {detail.fossils.map((f) => (
                  <tr key={f.id}>
                    <td>{f.id}</td><td style={{ textTransform: 'capitalize' }}>{f.kind}{f.element ? ` · ${f.element}` : ''}</td>
                    <td>{f.speciesName ? `${f.speciesName} ${f.part ?? ''}` : f.kind === 'wondrous' ? `silver ${f.part}` : f.kind === 'miraculous' ? 'gold fossil' : '?'}{f.redBoned ? ' (red-boned)' : ''}{f.known ? ' · identified' : ''}</td>
                    <td>{f.state}</td><td>{f.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Recent matches</h3>
            <table className="admin-table">
              <thead><tr><th>#</th><th>Kind</th><th>Players</th><th>Result</th><th>Turns</th><th>When</th></tr></thead>
              <tbody>
                {detail.matches.map((m) => {
                  const mine = m.p1_user === detail.user.id ? 0 : 1;
                  const res = m.winner === null ? 'draw' : m.winner === mine ? 'won' : 'lost';
                  return <tr key={m.id}><td>{m.id}</td><td>{m.kind}</td><td>{m.p1_name} vs {m.p2_name}</td><td>{res}</td><td>{m.turns}</td><td className="small muted">{m.created_at}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stats() {
  const [solo, setSolo] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [sort, setSort] = useState<'picks' | 'winRate' | 'name'>('picks');
  useEffect(() => {
    api.admin.stats(solo).then(setStats).catch(() => setStats(null));
  }, [solo]);
  const rows = useMemo(() => {
    if (!stats) return [];
    const r = [...stats.vivosaurs];
    if (sort === 'picks') r.sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name));
    else if (sort === 'winRate') r.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.picks - a.picks);
    else r.sort((a, b) => Number(a.num) - Number(b.num));
    return r;
  }, [stats, sort]);
  const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Vivosaur statistics</h2>
        <label className="row small"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> include solo battles against the bot</label>
      </div>
      {stats && (
        <p className="small muted">
          {stats.totals.users} players · {stats.totals.matches} battles ({stats.totals.pvpMatches} between players) · {stats.teamsRecorded} teams recorded. Usage rate = share of recorded teams that included the vivosaur; win rate = that vivosaur's team wins over decided battles.
        </p>
      )}
      <div className="tabs">
        <button className={sort === 'picks' ? 'active' : ''} onClick={() => setSort('picks')}>By usage</button>
        <button className={sort === 'winRate' ? 'active' : ''} onClick={() => setSort('winRate')}>By win rate</button>
        <button className={sort === 'name' ? 'active' : ''} onClick={() => setSort('name')}>By number</button>
      </div>
      <table className="admin-table">
        <thead><tr><th></th><th>Vivosaur</th><th>Element</th><th>Picks</th><th>Usage</th><th>Wins</th><th>Losses</th><th>Win rate</th></tr></thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.speciesId}>
              <td><Medal speciesId={v.speciesId} /></td><td><b>#{v.num} {v.name}</b></td><td><ElementBadge element={v.element as never} /></td>
              <td>{v.picks}</td><td>{pct(v.usageRate)}</td><td>{v.wins}</td><td>{v.losses}</td><td>{pct(v.winRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
