import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export function useSocket(token: string | null): Socket | null {
  const ref = useRef<Socket | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (!token) {
      ref.current?.disconnect();
      ref.current = null;
      force((n) => n + 1);
      return;
    }
    const s = io({ auth: { token }, autoConnect: true });
    ref.current = s;
    force((n) => n + 1);
    return () => {
      s.disconnect();
      ref.current = null;
    };
  }, [token]);
  return ref.current;
}
