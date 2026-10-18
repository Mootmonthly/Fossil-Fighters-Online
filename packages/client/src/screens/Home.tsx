import { useEffect, useState } from 'react';
import { findVivosaur, PRIZE_LOSS, PRIZE_WIN, PRIZE_SOLO_WIN } from '@ffo/shared';
import { api, type Snapshot } from '../api.js';
import type { Screen } from '../App.js';
import { Medal } from '../components/Vivo.js';

export function HomeScreen({ snap, go }: { snap: Snapshot; go: (s: Screen) => void }) {
  const [board, setBoard] = useState<{ username: string; wins: number; losses: number; gold: number }[]>([]);
  useEffect(() => {
    api.leaderboard().then((b) => setBoard(b.players)).catch(() => {});
  }, [snap.user.wins]);
  const team = snap.user.team.map((id) => snap.vivosaurs.find((v) => v.id === id)).filter(Boolean);
  const rocks = snap.fossils.filter((f) => f.state === 'rock').length;
  return (
    <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
      <div className="grid">
        <div className="panel">
          <h2>Welcome back, {snap.user.username}!</h2>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="muted small">Record</div><b>{snap.user.wins} W / {snap.user.losses} L</b></div>
            <div><div className="muted small">Vivosaurs</div><b>{snap.vivosaurs.length}</b></div>
            <div><div className="muted small">Uncleaned rocks</div><b>{rocks}</b></div>
            <div><div className="muted small">Gold</div><b className="gold">{snap.user.gold.toLocaleString()} G</b></div>
          </div>
        </div>
        <div className="panel">
          <h3>Your team</h3>
          {team.length === 0 ? (
            <p className="muted">No team yet. Head to <a onClick={() => go('collection')} style={{ cursor: 'pointer' }}>Vivosaurs &amp; Team</a>.</p>
          ) : (
            <div className="row">
              {team.map((v) => (
                <div key={v!.id} className="row" style={{ gap: 6 }}>
                  <Medal speciesId={v!.displaySpeciesId} />
                  <div>
                    <b>{v!.nickname ?? findVivosaur(v!.displaySpeciesId)?.name}</b>
                    <div className="small muted">Rank {v!.rank}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => go('battle')}>Fossil Battle</button>
            <button onClick={() => go('shop')}>Buy fossil rocks</button>
            <button onClick={() => go('cleaning')} disabled={rocks === 0}>Clean fossils ({rocks})</button>
          </div>
        </div>
        <div className="panel">
          <h3>How it works</h3>
          <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Buy fossil rocks in the shop. Each holds a head, body, arms or legs fossil of a random vivosaur.</li>
            <li>Clean them in the Cleaning Room. A head fossil revives a new vivosaur; other parts raise its rank.</li>
            <li>Build a team of three. Teams that share a compatibility group unlock their Team Skills.</li>
            <li>Battle other players online. Wins pay {PRIZE_WIN.toLocaleString()} G, losses {PRIZE_LOSS} G, and every vivosaur that fought earns rank points. Solo battles against the bot pay {PRIZE_SOLO_WIN} G.</li>
            <li>Silver and gold fossils from Wondrous and Miraculous rocks boost stats, and gold fossils super-evolve certain vivosaurs.</li>
          </ol>
        </div>
      </div>
      <div className="panel">
        <h3>Leaderboard</h3>
        <table style={{ width: '100%', fontSize: 14 }}>
          <tbody>
            {board.map((p, i) => (
              <tr key={p.username}>
                <td className="muted">{i + 1}</td>
                <td><b>{p.username}</b></td>
                <td style={{ textAlign: 'right' }}>{p.wins}W {p.losses}L</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
