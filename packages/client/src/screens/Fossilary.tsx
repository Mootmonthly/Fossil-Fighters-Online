import { useMemo, useState } from 'react';
import { VIVOSAURS, type VivosaurData } from '@ffo/shared';
import type { Snapshot } from '../api.js';
import { ElementBadge, Medal, StatBars, spriteSrc } from '../components/Vivo.js';

export function SkillTable({ v }: { v: VivosaurData }) {
  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr className="muted"><th align="left">Skill</th><th>Power</th><th>FP</th><th align="left">Effect</th></tr>
      </thead>
      <tbody>
        {v.skills.map((s) => (
          <tr key={s.id} style={{ borderTop: '1px solid var(--line)', color: s.kind === 'team' ? '#ffb3b3' : s.kind === 'support' ? '#b6f3c0' : undefined }}>
            <td><b>{s.name}</b>{s.kind === 'team' ? ' (Team)' : ''}</td>
            <td align="center">{s.power ?? '—'}</td>
            <td align="center">{s.fp}</td>
            <td>{s.text || (s.target === 'allEnemies' ? 'Hits all enemies' : '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SupportLine({ v }: { v: VivosaurData }) {
  if (!v.support) return <span className="muted">No support effects</span>;
  const s = v.support;
  const parts = (['attack', 'defense', 'accuracy', 'speed'] as const).filter((k) => (s[k] ?? 0) !== 0).map((k) => `${k} ${(s[k] ?? 0) > 0 ? '+' : ''}${s[k]}%`);
  return <span>{s.target === 'own' ? 'Own AZ' : 'Enemy AZ'}: {parts.length ? parts.join(', ') : 'no change'}</span>;
}

export function FossilaryScreen({ snap }: { snap: Snapshot }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<VivosaurData | null>(null);
  const owned = new Set(snap.vivosaurs.map((v) => v.speciesId));
  const list = useMemo(() => VIVOSAURS.filter((v) => v.name.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <div className="grid" style={{ gridTemplateColumns: sel ? '1fr 1fr' : '1fr' }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Fossilary</h2>
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="muted small">{VIVOSAURS.length} vivosaurs. You have revived {owned.size}. Stats shown at max rank. Data from the Fossil Fighters wiki.</p>
        <div className="grid cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {list.map((v) => (
            <div key={v.id} className={`card selectable ${sel?.id === v.id ? 'selected' : ''}`} onClick={() => setSel(v)} style={{ opacity: owned.has(v.id) || owned.has(v.baseForm ?? '') ? 1 : 0.6 }}>
              <div className="row">
                <Medal speciesId={v.id} />
                <div>
                  <b>#{v.num} {v.name}</b>
                  <div className="small"><ElementBadge element={v.element} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {sel && (
        <div className="panel">
          <div className="row">
            <img className="sprite" src={spriteSrc(sel.id)} alt="" style={{ width: 120, height: 120 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            <div>
              <h2>#{sel.num} {sel.name}</h2>
              <div className="row small">
                <ElementBadge element={sel.element} />
                <span className="badge">{sel.range}-range</span>
                <span className="badge">Crit {sel.crit}%</span>
                {sel.size && <span className="badge">{sel.size}</span>}
              </div>
            </div>
          </div>
          <p className="muted small">{sel.description}</p>
          <StatBars stats={sel.stats} />
          <h3 style={{ marginTop: 12 }}>Skills</h3>
          <SkillTable v={sel} />
          <h3 style={{ marginTop: 12 }}>Support effects</h3>
          <SupportLine v={sel} />
          {sel.abilities.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Abilities</h3>
              <div className="row">{sel.abilities.map((a) => <span key={a.type} className="badge">{a.type}{a.value ? ` ${a.value}%` : ''}</span>)}</div>
            </>
          )}
          {sel.superEvolvesInto && <p className="small muted" style={{ marginTop: 12 }}>Super-evolves with a gold fossil.</p>}
          <p className="small muted">Team skill groups: {sel.groups.length ? sel.groups.join(', ') : 'none'}</p>
        </div>
      )}
    </div>
  );
}
