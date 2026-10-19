import { findVivosaur, type Element } from '@ffo/shared';
import type { VivosaurView } from '../api.js';

export function medalSrc(speciesId: string) {
  return `/img/medals/${speciesId}.png`;
}
export function spriteSrc(speciesId: string) {
  return `/img/sprites/${speciesId}.png`;
}

export function ElementBadge({ element }: { element: Element }) {
  return <span className={`badge ${element}`}>{element[0].toUpperCase() + element.slice(1)}</span>;
}

export function Medal({ speciesId, big, title }: { speciesId: string; big?: boolean; title?: string }) {
  return (
    <img
      className={`medal ${big ? 'big' : ''}`}
      src={medalSrc(speciesId)}
      alt={title ?? speciesId}
      title={title}
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

export function StatBars({ stats, max }: { stats: { lp: number; attack: number; defense: number; accuracy: number; speed: number }; max?: typeof stats }) {
  const rows: [string, number, number][] = [
    ['LP', stats.lp, max?.lp ?? 800],
    ['Attack', stats.attack, max?.attack ?? 110],
    ['Defense', stats.defense, max?.defense ?? 60],
    ['Accuracy', stats.accuracy, max?.accuracy ?? 60],
    ['Speed', stats.speed, max?.speed ?? 50],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map(([label, v, m]) => (
        <div className="statbar" key={label}>
          <span className="muted">{label}</span>
          <div className="bar">
            <div style={{ width: `${Math.min(100, (v / m) * 100)}%` }} />
          </div>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

export function VivoCard({ v, selected, onClick, extra }: { v: VivosaurView; selected?: boolean; onClick?: () => void; extra?: React.ReactNode }) {
  const species = findVivosaur(v.displaySpeciesId) ?? findVivosaur(v.speciesId)!;
  const parts = (['head', 'body', 'arms', 'legs'] as const).filter((p) => v.parts[p] > 0).length;
  return (
    <div className={`card ${onClick ? 'selectable' : ''} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="row">
        <Medal speciesId={species.id} title={species.name} />
        <div>
          <div style={{ fontWeight: 900 }}>{v.nickname ?? species.name}</div>
          <div className="small muted">
            {v.nickname ? `${species.name} · ` : ''}Rank {v.rank}
          </div>
        </div>
      </div>
      <div className="row small">
        <ElementBadge element={species.element} />
        <span className="badge">{species.range === 'close' ? 'Close' : species.range === 'mid' ? 'Mid' : 'Long'}-Range</span>
        <span className="badge" title="Integrated fossil parts">{parts}/4 parts</span>
        {v.silver && <span className="badge" title={`Silver ${v.silver.part} (${v.silver.score})`}>Silver</span>}
        {v.gold !== null && <span className="badge" style={{ color: 'var(--gold-dark)' }}>Gold</span>}
      </div>
      <StatBars stats={v.stats} />
      {extra}
    </div>
  );
}
