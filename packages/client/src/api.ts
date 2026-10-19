import type { Stats, OwnedVivosaur } from '@ffo/shared';

export interface User {
  id: number;
  username: string;
  gold: number;
  heroLevel: number;
  wins: number;
  losses: number;
  team: number[];
}

export interface VivosaurView extends OwnedVivosaur {
  rank: number;
  displaySpeciesId: string;
  stats: Stats;
}

export interface FossilView {
  id: number;
  kind: 'normal' | 'dark' | 'wondrous' | 'miraculous';
  element: string | null;
  part: string | null;
  redBoned: boolean;
  state: 'rock' | 'cleaned';
  score: number | null;
  speciesId: string | null;
  fossilImage: string | null;
  rockSeed: number;
}

export interface Snapshot {
  user: User;
  vivosaurs: VivosaurView[];
  fossils: FossilView[];
}

export interface CleanResult {
  success: boolean;
  score: number;
  message: string;
  vivosaur?: VivosaurView;
  newSpecies?: boolean;
  pointsGained?: number;
}

let token: string | null = localStorage.getItem('ffo.token');

export function getToken() {
  return token;
}

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('ffo.token', t);
  else localStorage.removeItem('ffo.token');
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  register: (username: string, password: string, starter: string) => request<Snapshot & { token: string }>('POST', '/api/register', { username, password, starter }),
  login: (username: string, password: string) => request<Snapshot & { token: string }>('POST', '/api/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  me: () => request<Snapshot>('GET', '/api/me'),
  buy: (kind: string, element: string | null) => request<Snapshot & { fossil: FossilView }>('POST', '/api/shop/buy', { kind, element }),
  clean: (id: number, score: number, durationMs: number) => request<Snapshot & { result: CleanResult }>('POST', `/api/fossils/${id}/clean`, { score, durationMs }),
  integrate: (id: number, vivosaurId: number) => request<Snapshot & { vivosaur: VivosaurView }>('POST', `/api/fossils/${id}/integrate`, { vivosaurId }),
  sell: (id: number) => request<Snapshot & { value: number }>('POST', `/api/fossils/${id}/sell`),
  setTeam: (ids: number[]) => request<Snapshot>('POST', '/api/team', { ids }),
  nickname: (id: number, nickname: string | null) => request<Snapshot>('POST', `/api/vivosaurs/${id}/nickname`, { nickname }),
  leaderboard: () => request<{ players: { username: string; wins: number; losses: number; gold: number }[] }>('GET', '/api/leaderboard'),
};
