import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { SHOP, STARTER_CHOICES, VIVOSAURS } from '@ffo/shared';
import { openDatabase, type UserRow } from './db.js';
import { createSession, hashPassword, userForToken, validUsername, verifyPassword } from './auth.js';
import {
  buyRock, cleanFossil, createStarterAccount, GameError, integrateSuperFossil, listFossils, listVivosaurs, publicFossil, publicUser,
  renameVivosaur, sellFossil, setTeam, viewVivosaur,
} from './game.js';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DB_FILE = process.env.DB_FILE ?? path.join(__dirname, '..', 'data', 'ffo.sqlite');
const CLIENT_DIST = process.env.CLIENT_DIST ?? path.join(__dirname, '..', '..', 'client', 'dist');

const db = openDatabase(DB_FILE);
const app = express();
app.use(express.json({ limit: '64kb' }));

interface AuthedRequest extends express.Request {
  user: UserRow;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const user = userForToken(db, token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  (req as AuthedRequest).user = user;
  next();
}

function handle(fn: (req: AuthedRequest, res: express.Response) => unknown) {
  return (req: express.Request, res: express.Response) => {
    try {
      const out = fn(req as AuthedRequest, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  };
}

function snapshot(user: UserRow) {
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
  return {
    user: publicUser(fresh),
    vivosaurs: listVivosaurs(db, user.id).map(viewVivosaur),
    fossils: listFossils(db, user.id).map(publicFossil),
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, vivosaurs: VIVOSAURS.length }));
app.get('/api/shop', (_req, res) => res.json({ offers: SHOP, starters: STARTER_CHOICES }));

app.post('/api/register', handle((req, res) => {
  const { username, password, starter } = req.body ?? {};
  if (typeof username !== 'string' || !validUsername(username)) throw new GameError('Usernames are 3 to 16 letters, numbers or underscores');
  if (typeof password !== 'string' || password.length < 6) throw new GameError('Passwords need at least 6 characters');
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) throw new GameError('That username is taken', 409);
  const user = createStarterAccount(db, username, hashPassword(password), String(starter));
  const token = createSession(db, user.id);
  res.json({ token, ...snapshot(user) });
}));

app.post('/api/login', handle((req, res) => {
  const { username, password } = req.body ?? {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '')) as unknown as UserRow | undefined;
  if (!user || !verifyPassword(String(password ?? ''), user.pass_hash)) throw new GameError('Wrong username or password', 401);
  const token = createSession(db, user.id);
  res.json({ token, ...snapshot(user) });
}));

app.post('/api/logout', requireAuth, handle((req) => {
  const header = req.header('authorization') ?? '';
  db.prepare('DELETE FROM sessions WHERE token = ?').run(header.slice(7));
  return { ok: true };
}));

app.get('/api/me', requireAuth, handle((req) => snapshot(req.user)));

app.post('/api/shop/buy', requireAuth, handle((req) => {
  const { kind, element } = req.body ?? {};
  const { fossil } = buyRock(db, req.user, String(kind), element ? String(element) : null);
  return { fossil: publicFossil(fossil), ...snapshot(req.user) };
}));

app.post('/api/fossils/:id/clean', requireAuth, handle((req) => {
  const { score, durationMs } = req.body ?? {};
  const result = cleanFossil(db, req.user, Number(req.params.id), Number(score), Number(durationMs ?? 0));
  return { result, ...snapshot(req.user) };
}));

app.post('/api/fossils/:id/integrate', requireAuth, handle((req) => {
  const vivosaur = integrateSuperFossil(db, req.user, Number(req.params.id), Number(req.body?.vivosaurId));
  return { vivosaur, ...snapshot(req.user) };
}));

app.post('/api/fossils/:id/sell', requireAuth, handle((req) => {
  const value = sellFossil(db, req.user, Number(req.params.id));
  return { value, ...snapshot(req.user) };
}));

app.post('/api/team', requireAuth, handle((req) => {
  const ids = (req.body?.ids ?? []).map(Number);
  setTeam(db, req.user, ids);
  return snapshot(req.user);
}));

app.post('/api/vivosaurs/:id/nickname', requireAuth, handle((req) => {
  const nickname = req.body?.nickname ? String(req.body.nickname).trim() : null;
  renameVivosaur(db, req.user, Number(req.params.id), nickname || null);
  return snapshot(req.user);
}));

app.get('/api/leaderboard', (_req, res) => {
  const rows = db.prepare('SELECT username, wins, losses, gold FROM users ORDER BY wins DESC, losses ASC LIMIT 20').all();
  res.json({ players: rows });
});

app.get('/api/matches', requireAuth, handle((req) => {
  const rows = db.prepare('SELECT * FROM matches WHERE p1_user = ? OR p2_user = ? ORDER BY id DESC LIMIT 20').all(req.user.id, req.user.id);
  return { matches: rows };
}));

// Static client (production build)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, serveClient: false });
const rooms = new RoomManager(io, db);

io.use((socket, next) => {
  const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
  const user = userForToken(db, token);
  if (!user) return next(new Error('Not signed in'));
  socket.data = { user };
  next();
});
io.on('connection', (socket) => rooms.attach(socket));

server.listen(PORT, () => {
  console.log(`Fossil Fighters Online server listening on http://localhost:${PORT} (${VIVOSAURS.length} vivosaurs loaded)`);
});
