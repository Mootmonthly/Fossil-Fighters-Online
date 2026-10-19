import { useEffect, useState } from 'react';
import { music } from '../audio.js';

/** Mute button and volume slider for the background music; the choice is remembered in the browser. */
export function SoundControl() {
  const [, force] = useState(0);
  useEffect(() => {
    const off = music.subscribe(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  return (
    <div className="sound" title={music.unlocked ? 'Music volume' : 'Click anywhere to start the music'}>
      <button className="ghost" onClick={() => music.setMuted(!music.muted)} aria-label={music.muted ? 'Unmute music' : 'Mute music'}>
        {music.muted ? '🔇' : '🔊'}
      </button>
      <input type="range" min={0} max={1} step={0.05} value={music.muted ? 0 : music.volume} onChange={(e) => { music.setVolume(Number(e.target.value)); if (music.muted && Number(e.target.value) > 0) music.setMuted(false); }} aria-label="Music volume" />
    </div>
  );
}
