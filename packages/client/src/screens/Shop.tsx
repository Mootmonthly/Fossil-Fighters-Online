import { SHOP, type Element } from '@ffo/shared';
import { api, type Snapshot } from '../api.js';
import { rockIconSrc } from './Cleaning.js';

const COLORS: Record<string, string> = { fire: '#c0392b', water: '#2a6fd6', earth: '#c9a227', air: '#3aa655', neutral: '#d8d8d8' };

export function RockIcon({ kind, element }: { kind: string; element: string | null }) {
  const fill = kind === 'wondrous' ? '#cfd8e6' : kind === 'miraculous' ? '#f2c14e' : kind === 'dark' ? '#2b2b33' : element ? COLORS[element] : '#a88b5a';
  return (
    <svg width="46" height="40" viewBox="0 0 46 40" aria-hidden>
      <path d="M8 30 L4 18 L12 8 L24 4 L36 8 L42 20 L38 32 L24 37 L12 35 Z" fill={fill} stroke="#1a1410" strokeWidth="2" />
      <path d="M14 14 L20 10 M28 11 L33 16 M16 26 L22 30" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
      {kind === 'miraculous' && <circle cx="23" cy="20" r="5" fill="#fff6c2" />}
      {kind === 'wondrous' && <circle cx="23" cy="20" r="5" fill="#ffffff" />}
    </svg>
  );
}

export function ShopScreen({ snap, run, notify, goClean }: { snap: Snapshot; run: <T extends Snapshot>(fn: () => Promise<T>) => Promise<T | null>; notify: (t: string, e?: boolean) => void; goClean: (fossilId: number) => void }) {
  const buy = async (kind: string, element: Element | null) => {
    const out = await run(() => api.buy(kind, element));
    if (out) notify(`Bought a ${kind} fossil rock! Clean it in the Cleaning Room.`);
  };
  return (
    <div className="grid">
      <div className="panel">
        <h2>Fossil Guild Shop</h2>
        <p className="muted">
          You have <b className="gold">{snap.user.gold.toLocaleString()} G</b>. Rocks hide a random fossil part until cleaned. Dark rocks are always red-boned heads (+25 cleaning points).
        </p>
        <div className="grid cards">
          {SHOP.map((o) => (
            <div key={o.kind + (o.element ?? '')} className="card">
              <div className="row">
                <RockIcon kind={o.kind} element={o.element} />
                <div>
                  <b style={{ textTransform: 'capitalize' }}>{o.element ? `${o.element} rock` : `${o.kind} rock`}</b>
                  <div className="gold">{o.price.toLocaleString()} G</div>
                </div>
              </div>
              <div className="small muted">{o.description}</div>
              <button className="primary" disabled={snap.user.gold < o.price} onClick={() => buy(o.kind, o.element)}>Buy</button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Your fossil case ({snap.fossils.filter((f) => f.state === 'rock').length} rocks)</h3>
        <div className="grid cards">
          {snap.fossils.filter((f) => f.state === 'rock').map((f) => (
            <div key={f.id} className="card">
              <div className="row">
                <img src={rockIconSrc(f.rockSeed)} alt="" width={48} height={48} style={{ imageRendering: 'pixelated', filter: f.kind === 'dark' ? 'brightness(.35) saturate(.3)' : f.kind === 'wondrous' ? 'saturate(.2) brightness(1.2)' : f.kind === 'miraculous' ? 'hue-rotate(-10deg) saturate(1.8)' : undefined }} />
                <div>
                  <b style={{ textTransform: 'capitalize' }}>{f.kind} rock</b>
                  <div className="small muted">{f.element ? `${f.element} type` : f.kind === 'wondrous' ? `silver ${f.part} fossil` : f.kind === 'miraculous' ? 'gold fossil' : 'unknown type'}</div>
                </div>
              </div>
              <button onClick={() => goClean(f.id)}>Clean</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
