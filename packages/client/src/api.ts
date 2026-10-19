import type { Stats, OwnedVivosaur } from '@ffo/shared';

export interface User {
  id: number;
  username: string;
  gold: number;
  heroLevel: number;
  wins: number;
  losses: number;
  team: number[];
  isAdmin: boolean;
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
  /** true when the player knows what the rock holds (featured shop, admin grants). */
  known: boolean;
  rockSeed: number;
}

export interface FeaturedRock {
  slot: number;
  speciesId: string;
  name: string;
  element: string;
  part: string;
  price: number;
  bought: boolean;
}

export interface Featured {
  bucket: number;
  resetsAt: number;
  rocks: FeaturedRock[];
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
  featured: () => request<Featured>('GET', '/api/shop/featured'),
  buyFeatured: (slot: number) => request<Snapshot & { fossil: FossilView; featured: Featured }>('POST', `/api/shop/featured/${slot}`),
  admin: {
    users: (q: string) => request<{ users: AdminUserRow[] }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}`),
    user: (id: number) => request<AdminUserDetail>('GET', `/api/admin/users/${id}`),
    grantGold: (id: number, amount: number) => request<{ gold: number; detail: AdminUserDetail }>('POST', `/api/admin/users/${id}/gold`, { amount }),
    grantRock: (id: number, body: { kind: string; element?: string | null; speciesId?: string | null; part?: string | null }) => request<{ fossilId: number; detail: AdminUserDetail }>('POST', `/api/admin/users/${id}/rock`, body),
    stats: (includeSolo: boolean) => request<AdminStats>('GET', `/api/admin/stats${includeSolo ? '?solo=1' : ''}`),
  },
};

export interface AdminUserRow {
  id: number;
  username: string;
  gold: number;
  wins: number;
  losses: number;
  created_at: string;
  is_admin: number;
  vivosaurs: number;
  rocks: number;
}

export interface AdminUserDetail {
  user: User & { createdAt: string };
  vivosaurs: VivosaurView[];
  fossils: { id: number; kind: string; element: string | null; speciesId: string | null; speciesName: string | null; part: string | null; redBoned: boolean; state: string; score: number | null; known: boolean; createdAt: string }[];
  matches: { id: number; kind: string; p1_name: string; p2_name: string; winner: number | null; turns: number; created_at: string; p1_user: number | null; p2_user: number | null }[];
}

export interface AdminStats {
  teamsRecorded: number;
  totals: { users: number; matches: number; pvpMatches: number };
  vivosaurs: { speciesId: string; name: string; num: string; element: string; picks: number; wins: number; losses: number; usageRate: number; winRate: number | null }[];
}
