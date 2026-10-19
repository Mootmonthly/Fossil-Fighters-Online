import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, type Snapshot } from './api.js';
import { AuthScreen } from './screens/Auth.js';
import { HomeScreen } from './screens/Home.js';
import { ShopScreen } from './screens/Shop.js';
import { CollectionScreen } from './screens/Collection.js';
import { CleaningScreen } from './screens/Cleaning.js';
import { BattleScreen } from './screens/Battle.js';
import { FossilaryScreen } from './screens/Fossilary.js';
import { AdminScreen } from './screens/Admin.js';
import { useSocket } from './socket.js';
import { music } from './audio.js';
import { SoundControl } from './components/SoundControl.js';

export type Screen = 'home' | 'shop' | 'collection' | 'cleaning' | 'battle' | 'fossilary' | 'admin';

export interface Toast {
  text: string;
  error?: boolean;
}

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [screen, setScreen] = useState<Screen>('home');
  const [toast, setToast] = useState<Toast | null>(null);
  const [cleaningFossil, setCleaningFossil] = useState<number | null>(null);
  const socket = useSocket(snap ? getToken() : null);
  // Menu music everywhere; the cleaning and battle screens switch tracks themselves while a dig or battle runs.
  useEffect(() => {
    if (snap) music.play('menu');
  }, [screen, snap]);
  // An ongoing battle (or pick phase) always brings the player back to the battle screen, e.g. after a reload.
  useEffect(() => {
    if (!socket) return;
    const toBattle = () => setScreen('battle');
    socket.on('battle:pick', toBattle);
    socket.on('battle:start', toBattle);
    return () => {
      socket.off('battle:pick', toBattle);
      socket.off('battle:start', toBattle);
    };
  }, [socket]);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSnap(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setSnap(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const run = useCallback(
    async <T extends Snapshot>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const out = await fn();
        setSnap({ user: out.user, vivosaurs: out.vivosaurs, fossils: out.fossils });
        return out;
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Something went wrong', true);
        return null;
      }
    },
    [notify],
  );

  if (loading) return <div className="content">Loading…</div>;
  if (!snap) {
    return (
      <div className="app">
        <AuthScreen
          onAuth={(s) => {
            setToken(s.token);
            setSnap(s);
            setScreen('home');
          }}
        />
        {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
      </div>
    );
  }

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    setSnap(null);
  };

  const nav = (s: Screen) => (
    <button className={screen === s ? 'active' : ''} onClick={() => setScreen(s)}>
      {s === 'home' ? 'Home' : s === 'shop' ? 'Fossil Shop' : s === 'collection' ? 'Vivosaurs & Team' : s === 'cleaning' ? 'Cleaning Room' : s === 'battle' ? 'Fossil Battle' : s === 'admin' ? 'Admin' : 'Fossilary'}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/img/medals/t_rex.png" alt="" width={26} height={26} style={{ imageRendering: 'pixelated' }} />
          Fossil Fighters Online
        </div>
        <nav>
          {nav('home')}
          {nav('shop')}
          {nav('cleaning')}
          {nav('collection')}
          {nav('battle')}
          {nav('fossilary')}
          {snap.user.isAdmin && nav('admin')}
        </nav>
        <div className="spacer" />
        <div className="row userbar">
          <span className="muted">{snap.user.username}</span>
          <span className="gold">{snap.user.gold.toLocaleString()} G</span>
          <SoundControl />
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="content">
        {screen === 'home' && <HomeScreen snap={snap} go={setScreen} />}
        {screen === 'shop' && <ShopScreen snap={snap} run={run} notify={notify} goClean={(id) => { setCleaningFossil(id); setScreen('cleaning'); }} />}
        {screen === 'cleaning' && <CleaningScreen snap={snap} run={run} notify={notify} initialFossil={cleaningFossil} onDone={() => setCleaningFossil(null)} />}
        {screen === 'collection' && <CollectionScreen snap={snap} run={run} notify={notify} />}
        {screen === 'battle' && <BattleScreen snap={snap} socket={socket} notify={notify} refresh={refresh} />}
        {screen === 'fossilary' && <FossilaryScreen snap={snap} />}
        {screen === 'admin' && snap.user.isAdmin && <AdminScreen notify={notify} />}
      </main>
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
    </div>
  );
}
