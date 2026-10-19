# Fossil Fighters Online

A browser-based **Fossil Fighters: Champions** battle simulator. Buy fossil rocks, clean them in a
touch-screen-style minigame, revive vivosaurs, build a team of three, and battle other players online
for prize money. Fan project, non-commercial.

The battle engine reproduces the Champions rule set as documented by the community: the six-zone field
with Cambrian/Jurassic formations and FP-costed rotation, range classes with per-tile multipliers,
support effects, the damage and accuracy formulas, status effects, abilities, team skills, and all 204
vivosaurs (150 regular, 30 super evolvers, and the bonus/event vivosaurs) with their wiki stats, skills,
support effects and abilities.

## Layout

```
packages/
  shared/   @ffo/shared  – vivosaur data, battle engine, AI, progression math (TypeScript, no runtime deps)
  server/   @ffo/server  – Express + Socket.IO + SQLite (node:sqlite). Accounts, shop, cleaning, matchmaking, battles
  client/   @ffo/client  – React + Vite single-page app: shop, cleaning minigame, collection, battle arena, Fossilary
```

The server is authoritative: every battle action is validated and resolved by the shared engine on the
server, and clients only receive the resulting state. The same engine runs in the client purely for
previews (damage ranges, legal targets).

## Running it

Requires Node.js 22.5 or newer (for the built-in `node:sqlite` module).

```bash
npm install
npm run build          # builds shared, client and server
npm start              # serves the game on http://localhost:3000
```

For development with hot reload:

```bash
npm run build -w packages/shared   # once, and again after changing shared/
npm run dev                        # server on :3000 (tsx watch) + Vite dev server on :5173 with proxy
```

Environment variables for the server:

| Variable      | Default                         | Purpose                               |
| ------------- | ------------------------------- | ------------------------------------- |
| `PORT`        | `3000`                          | HTTP/WebSocket port                   |
| `DB_FILE`     | `packages/server/data/ffo.sqlite` | SQLite database path                |
| `CLIENT_DIST` | `packages/client/dist`          | Built client to serve statically      |
| `ADMIN_USERS` | *(unset: account #1 is admin)*  | Comma-separated usernames allowed into the admin panel |

Deploying is a single Node process (Render, Fly.io, Railway, a VPS, etc.): run `npm install && npm run build`
as the build step and `npm start` as the start command. Give `DB_FILE` a path on a persistent disk.

### Render

`render.yaml` is a Render Blueprint. In the Render dashboard choose **New → Blueprint**, connect this repository
and click **Apply**: it creates one web service (Node 22, `npm ci && npm run build`, `npm start`) with a 1 GB disk
mounted at `/var/data` for the database. The disk needs the Starter instance; to try it on the free instance,
remove the `disk` block and the `DB_FILE` variable from `render.yaml` (accounts and vivosaurs are then lost on
each deploy or restart, and the free instance sleeps after 15 minutes of inactivity).

Tests: `npm test` runs the engine unit tests (vitest).

## Game loop

1. **Shop** – buy fossil rocks. Tan rocks can hold any part of any of the 150 regular vivosaurs; coloured rocks
   fix the element; dark rocks are always red-boned heads (+25 points); wondrous and miraculous rocks hold
   silver and gold fossils. The **featured shelf** shows eight identified rocks (species and part), the same for
   every player, rotating every three hours; each can be bought once per rotation at half the game's own rock
   price (2,000 / 4,000 / 6,000 / 12,500 G tiers). New accounts start with 10,000 G, a starter vivosaur and ten
   rocks, at least four of them heads.
2. **Cleaning Room** – hammer and drill the rock away within 90 seconds on the game's cleaning tray. Rocks use the
   18 official rock shapes and hide the game's own fossil picture for that species and part (normal, red-boned and
   damaged variants). Only Tonzilla has no picture in the game and falls back to procedural bones. Uncovered bone fills
   the meter, damaged bone drains it. 50 points are needed to integrate the fossil.
3. **Revival and ranks** – a head fossil revives the vivosaur; body, arms and legs add their cleaning score as
   rank points (50 points per rank, max rank 20, skills unlock at ranks 1/3/5/7). Battles also grant rank points.
4. **Super revival** – silver fossils add LP and one or two stats and change the vivosaur's colours; gold
   fossils boost everything and super-evolve the 30 eligible vivosaurs.
5. **Battle** – solo matches against a bot, ranked matchmaking, or private rooms with a code. Teams hold up to
   five vivosaurs; once matched, both players see each other's team and have 30 seconds to pick three, assign
   their slots and choose Cambrian or Jurassic formation (the bot picks at random, and anyone who runs out of
   time gets their first three in Cambrian). Winner takes 2,500 G, loser 600 G; the three that fought gain rank
   points.
6. **Admin panel** – accounts named in `ADMIN_USERS` (or the first account when it is unset) get an Admin tab:
   look up any player's gold, record, vivosaurs and fossil case, grant gold or a specific rock, and see every
   vivosaur's usage and win rate across recorded battles.

## Battle rules implemented

- Six zones per side: AZ+ / AZ / AZ in front, SZ / SZ / SZ+ behind. Teams start in the Cambrian formation
  (one AZ, two SZ). Rotating one step costs 5 FP, cumulative up to 15 FP until the next skill is used.
- Turn order by total team Speed. FP recharges at the start of each turn per hero level (both sides use
  level 20: +230 FP, max 900). FP Plus adds 10/20/30 %.
- Damage = `{[(Attack + BasePower + status) × atkSupport] − (Defense × defSupport ± status)} × rand(0.75–0.85) ×
  element × range × crit(1.5) × Parting Blow × Charge(2.5)`, truncated. Base power is the listed skill power
  minus the species' max-rank Attack.
- Accuracy: `Accuracy × mods − Speed × mods × rand(0.5–1) > 0` hits.
- Elements: Water > Fire > Earth > Air > Water at ×1.5; Elemental Boost raises that to ×2 (×3 with two) and
  makes disadvantage ×0.5.
- Range multipliers by tile distance (1–7): Close 1.875/1.25/1/0.625/0.5/0.375/0.25, Mid 1/1.25/1.5/1.25/1/0.75/0.5,
  Long 0.25/0.5/0.75/1/1.5/1.75/2. Distance = depth(attacker) + depth(target) + 1.
- Support effects from SZ vivosaurs apply to AZ vivosaurs (own or enemy), halved when two vivosaurs share the AZ.
- Statuses: Poison 15/30/50 % max LP per turn, Sleep (wakes after 1/2 hits), Scare seals 2/3 skills, Excite
  blocks manual rotation (Super Excite may spin the team), Confuse makes the vivosaur attack at random (Super
  Confuse can hit allies), Enrage +10/+20 Attack −30/−35 Accuracy, Infection KOs at the start of the 4th turn,
  Enflame +20/+40 Attack −5/−10 Defense, Harden +30/+50 Defense, Quicken +30/70 % Speed, Counter reflects
  70/100 %, Charge ×2.5. Rallying Cry cures negative statuses; Infection cannot be cured.
- Abilities: FP Plus, FP Absorb, Auto Counter, Auto LP Recovery, Parting Blow (per-species multipliers), Link,
  Solo Power, Elemental Boost, Sleepy, Harden/Counter/Quicken Plus, Enflame Plus S, Position Lock, Resurrect,
  Berserker. Boneysaurs resist Poison and Scare; zombiesaurs resist Sleep, Scare and Infection.
- Team Skills need a compatible trio (the wiki's 31 compatibility groups), cannot crit, and lose power for
  each KO'd teammate.

### Data taken from the game itself

The owner's ROM was data-mined to fill the gaps the wiki leaves (tools live outside the repo; no game files are
committed). From the game's own tables:

- **LP at every rank** for every vivosaur (`lpByRank`), and for Attack, Defense, Accuracy and Speed the rank-1 value,
  max value and growth-pattern index (`statCurves`) together with the game's six 20-step growth patterns
  (`data/growth.json`). Rank-20 values match the wiki exactly.
- **Skill FP costs and base powers** for all 800 skills: 801 of 803 wiki entries agreed, and the two wiki typos
  (Onyx's Whiplash, Hibigon's Hibi Hustle) were corrected. The game also stores weaker lower-rank versions of
  many skills (`tiers`), kept in the data but not yet used, because the rank thresholds that switch them are not
  known.
- **Per-vivosaur range tables** (damage percentage at each tile distance), status chances and tiers, support
  effects and crit rates, all of which confirmed the wiki.
- **Hero-level FP table**, including FP at the start of a battle (460 at level 20, which the wiki did not list).
- **Super-revival bonuses** and the 50-point rank-up interval.
- **Rock prices**: the game's rock table prices 87 species at 4,000 / 8,000 / 12,000 / 25,000 G (`shopPrice`, source
  `rom`); the rest are never sold in the game and get the tier whose average stat total is nearest (`tier`). The
  featured shelf charges half.

Special vivosaurs (super evolvers, boneysaurs, zombiesaurs, legendaries) use their base stats; the wiki lists them
with a 100-point gold fossil included, and the game applies that bonus through the fossil system instead.

### Remaining assumptions

Set in `packages/shared/src/constants.ts` and marked as assumptions: Super Excite's spin chance, the chance a
confused vivosaur skips its action, Resurrect's LP, and the team-skill power penalty per KO. The stat growth
formula interpolates between the rank-1 and max values along the growth pattern; the game's exact rounding may
differ by a point. Transformations restore the new form's full LP.

## Data

`packages/shared/src/data/vivosaurs.json` was generated from the Fossil Fighters wiki (fossilfighters.fandom.com)
vivosaur pages and the competitive Fossil Fighters wiki's battle-calculation pages. Medal, battle sprite and rock-shape images
in `packages/client/public/img` come from the same wiki.

The backgrounds are the game's own 2D screens, rendered from the owner's ROM with `tools/rom/nds.py`:
`img/arena/` holds the 26 lower-screen battle arenas (the hex flowers the vivosaurs stand on are part of the art, and
the client places sprites on them using geometry measured from the pixels), `img/bg/` the cleaning tray, the FP
gauge, the menu pattern and the window plates used behind the panels. A battle picks its arena from the match seed.
`img/fossils/` holds the fossil pictures from the cleaning room (`tools/rom/export_images.py` and
`build_fossil_images.py`), and `data/fossilImages.json` maps each species and part to its picture set the way the
game's rock table does. Fish and other whole-body fossils use one picture for every part, as in the game.

Fossil Fighters is © Nintendo / Red Entertainment; this is an unofficial fan project.
