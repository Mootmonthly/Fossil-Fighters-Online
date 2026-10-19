import { useState } from 'react';
import { getVivosaur, STARTER_CHOICES } from '@ffo/shared';
import { api, type Snapshot } from '../api.js';
import { ElementBadge, Medal } from '../components/Vivo.js';

export function AuthScreen({ onAuth }: { onAuth: (s: Snapshot & { token: string }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [starter, setStarter] = useState(STARTER_CHOICES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = mode === 'login' ? await api.login(username, password) : await api.register(username, password, starter);
      onAuth(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <div className="panel auth">
        <h1>Fossil Fighters Online</h1>
        <p className="muted">Dig, clean, revive, and battle. A Fossil Fighters: Champions battle simulator.</p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>New Fighter</button>
        </div>
        <form onSubmit={submit}>
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'register' && (
            <>
              <div className="muted small">Choose your first Dino Medal:</div>
              <div className="starters">
                {STARTER_CHOICES.map((id) => {
                  const v = getVivosaur(id);
                  return (
                    <div key={id} className={`card selectable ${starter === id ? 'selected' : ''}`} onClick={() => setStarter(id)}>
                      <div className="row">
                        <Medal speciesId={id} />
                        <div>
                          <b>{v.name}</b>
                          <div className="small">
                            <ElementBadge element={v.element} /> <span className="muted">{v.range}-range</span>
                          </div>
                        </div>
                      </div>
                      <div className="small muted">{v.description}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
          <button className="primary" disabled={busy}>{mode === 'login' ? 'Log in' : 'Start your journey'}</button>
        </form>
      </div>
    </div>
  );
}
