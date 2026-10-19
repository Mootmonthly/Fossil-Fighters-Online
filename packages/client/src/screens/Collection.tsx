import { useMemo, useState } from 'react';
import { findVivosaur, isTeamCompatible, MAX_RANK, pointsToNextRank, unlockedSkillCount } from '@ffo/shared';
import { api, type Snapshot, type VivosaurView } from '../api.js';
import { ElementBadge, Medal, StatBars, VivoCard, spriteSrc } from '../components/Vivo.js';
import { SkillTable, SupportLine } from './Fossilary.js';

type Run = <T extends Snapshot>(fn: () => Promise<T>) => Promise<T | null>;

export function CollectionScreen({ snap, run, notify }: { snap: Snapshot; run: Run; notify: (t: string, e?: boolean) => void }) {
  const [team, setTeam] = useState<number[]>(snap.user.team);
  const [sel, setSel] = useState<VivosaurView | null>(null);
  const [nick, setNick] = useState('');
  const superFossils = snap.fossils.filter((f) => f.state === 'cleaned' && (f.kind === 'wondrous' || f.kind === 'miraculous'));
  const storedParts = snap.fossils.filter((f) => f.state === 'cleaned' && (f.kind === 'normal' || f.kind === 'dark'));

  const teamSpecies = team.map((id) => snap.vivosaurs.find((v) => v.id === id)?.displaySpeciesId).filter((x): x is string => !!x);
  const compatible = teamSpecies.length === 3 && isTeamCompatible(teamSpecies);
  const dirty = JSON.stringify(team) !== JSON.stringify(snap.user.team);

  const toggle = (id: number) => {
    setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length < 3 ? [...t, id] : t));
  };
  const save = async () => {
    const out = await run(() => api.setTeam(team));
    if (out) notify('Team saved!');
  };
  const sorted = useMemo(() => [...snap.vivosaurs].sort((a, b) => Number(findVivosaur(a.speciesId)?.num) - Number(findVivosaur(b.speciesId)?.num)), [snap.vivosaurs]);

  return (
    <div className="grid" style={{ gridTemplateColumns: sel ? '1fr 420px' : '1fr' }}>
      <div className="grid">
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Battle team</h2>
            <div className="row">
              {compatible ? <span className="badge" style={{ color: 'var(--good)' }}>Team Skills ready ✓</span> : team.length === 3 ? <span className="badge muted">Not compatible: no Team Skills</span> : <span className="badge muted">{team.length}/3 chosen</span>}
              <button className="primary" disabled={!dirty || team.length === 0} onClick={save}>Save team</button>
            </div>
          </div>
          <div className="row">
            {[0, 1, 2].map((i) => {
              const v = snap.vivosaurs.find((x) => x.id === team[i]);
              return (
                <div key={i} className="card" style={{ minWidth: 160, minHeight: 70, justifyContent: 'center' }}>
                  {v ? (
                    <div className="row">
                      <Medal speciesId={v.displaySpeciesId} />
                      <div>
                        <b>{v.nickname ?? findVivosaur(v.displaySpeciesId)?.name}</b>
                        <div className="small muted">Rank {v.rank}{i === 0 ? ' · starts in AZ+' : ' · starts in SZ'}</div>
                      </div>
                    </div>
                  ) : (
                    <span className="muted">Empty slot {i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Click vivosaurs below to add or remove them. The first slot starts in the front Attack Zone; the other two start in the Support Zones (Cambrian formation).</p>
        </div>

        {(superFossils.length > 0 || storedParts.length > 0) && (
          <div className="panel">
            <h3>Cleaned fossils waiting</h3>
            {storedParts.length > 0 && (
              <p className="small muted">Stored parts (integrated automatically once the head is revived): {storedParts.map((f) => `${findVivosaur(f.speciesId ?? '')?.name ?? '?'} ${f.part} (${f.score})`).join(', ')}</p>
            )}
            {superFossils.map((f) => (
              <div key={f.id} className="row" style={{ marginBottom: 6 }}>
                <span className="badge" style={{ color: f.kind === 'miraculous' ? 'var(--gold-dark)' : 'var(--muted)' }}>{f.kind === 'miraculous' ? 'Gold fossil' : `Silver ${f.part}`} · {f.score} pts</span>
                <span className="small muted">Select a vivosaur, then</span>
                <button disabled={!sel} onClick={async () => { if (!sel) return; const out = await run(() => api.integrate(f.id, sel.id)); if (out) { notify(`Integrated into ${findVivosaur(out.vivosaur.displaySpeciesId)?.name}!`); setSel(out.vivosaur); } }}>Integrate into {sel ? sel.nickname ?? findVivosaur(sel.displaySpeciesId)?.name : '…'}</button>
                <button onClick={async () => { const out = await run(() => api.sell(f.id)); if (out) notify(`Sold for ${out.value} G`); }}>Sell</button>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <h3>Your vivosaurs ({snap.vivosaurs.length})</h3>
          <div className="grid cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {sorted.map((v) => (
              <VivoCard
                key={v.id}
                v={v}
                selected={team.includes(v.id)}
                onClick={() => { toggle(v.id); setSel(v); setNick(v.nickname ?? ''); }}
                extra={<div className="small muted">{team.includes(v.id) ? `In team (slot ${team.indexOf(v.id) + 1})` : 'Click to add to team'}</div>}
              />
            ))}
          </div>
        </div>
      </div>

      {sel && (() => {
        const species = findVivosaur(sel.displaySpeciesId)!;
        const base = findVivosaur(sel.speciesId)!;
        return (
          <div className="panel themed bg-plate" style={{ alignSelf: 'start', position: 'sticky', top: 70 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{sel.nickname ?? species.name}</h3>
              <button onClick={() => setSel(null)}>✕</button>
            </div>
            <div className="row">
              <img className="sprite" src={spriteSrc(species.id)} alt="" style={{ width: 110, height: 110 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              <div className="small">
                <div><ElementBadge element={species.element} /> <span className="badge">{species.range}-range</span> <span className="badge">Crit {species.crit}%</span></div>
                <div style={{ marginTop: 6 }}>Rank <b>{sel.rank}</b>{sel.rank < MAX_RANK ? <span className="muted"> · {pointsToNextRank(sel.rankPoints)} pts to next</span> : <span className="muted"> · MAX</span>}</div>
                <div className="muted">Skills unlocked: {unlockedSkillCount(sel.rank)}/4 + team skill</div>
                <div className="muted">Parts: {(['head', 'body', 'arms', 'legs'] as const).map((p) => `${p} ${sel.parts[p] || '—'}`).join(' · ')}</div>
                {species.id !== base.id && <div className="muted">Super-evolved from {base.name}</div>}
              </div>
            </div>
            <StatBars stats={sel.stats} />
            <div className="row" style={{ marginTop: 8 }}>
              <input placeholder="Nickname" value={nick} maxLength={12} onChange={(e) => setNick(e.target.value)} style={{ width: 150 }} />
              <button onClick={async () => { const out = await run(() => api.nickname(sel.id, nick || null)); if (out) { notify('Renamed'); setSel(out.vivosaurs.find((v) => v.id === sel.id) ?? null); } }}>Rename</button>
            </div>
            <h4 style={{ margin: '12px 0 6px' }}>Skills</h4>
            <SkillTable v={species} />
            <h4 style={{ margin: '12px 0 6px' }}>Support effects</h4>
            <div className="small"><SupportLine v={species} /></div>
            {species.abilities.length > 0 && <div className="small" style={{ marginTop: 8 }}>Abilities: {species.abilities.map((a) => a.type).join(', ')}</div>}
          </div>
        );
      })()}
    </div>
  );
}
