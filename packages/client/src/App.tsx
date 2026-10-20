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
import { ChatScreen } from './screens/Chat.js';
import { useChat } from './chatStore.js';

const DISCORD_URL = 'https://discord.gg/nQ6ERKzhrn';

function DiscordButton() {
  return (
    <a className="discord" href={DISCORD_URL} target="_blank" rel="noopener noreferrer" title="Join the Fossil Fighters Online Discord">
      <svg viewBox="0 0 127.14 96.36" width="20" height="15" aria-hidden><path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg>
      <span>Discord</span>
    </a>
  );
}
import { useSocket } from './socket.js';
import { music } from './audio.js';
import { SoundControl } from './components/SoundControl.js';

export type Screen = 'home' | 'shop' | 'collection' | 'cleaning' | 'battle' | 'fossilary' | 'chat' | 'admin';

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

  const chat = useChat(socket, screen === 'chat', notify);

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
      {s === 'home' ? 'Home' : s === 'shop' ? 'Fossil Shop' : s === 'collection' ? 'Vivosaurs & Team' : s === 'cleaning' ? 'Cleaning Room' : s === 'battle' ? 'Fossil Battle' : s === 'admin' ? 'Admin' : s === 'chat' ? 'Chat' : 'Fossilary'}{s === 'chat' && chat.unread > 0 && screen !== 'chat' ? <span className="nav-badge">{chat.unread > 99 ? '99+' : chat.unread}</span> : null}
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
          {nav('chat')}
          {snap.user.isAdmin && nav('admin')}
        </nav>
        <div className="spacer" />
        <div className="row userbar">
          <span className="muted">{snap.user.username}</span>
          <span className="gold">{snap.user.gold.toLocaleString()} G</span>
          <DiscordButton />
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
        {screen === 'chat' && <ChatScreen socket={socket} messages={chat.messages} online={chat.online} me={snap.user.username} isAdmin={snap.user.isAdmin} />}
        {screen === 'admin' && snap.user.isAdmin && <AdminScreen notify={notify} />}
      </main>
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
    </div>
  );
}
