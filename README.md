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

Deploying is a single Node process (Render, Fly.io, Railway, a VPS, etc.): run `npm install && npm run build`
as the build step and `npm start` as the start command. Give `DB_FILE` a path on a persistent disk.

Tests: `npm test` runs the engine unit tests (vitest).

## Game loop

1. **Shop** – buy fossil rocks. Tan rocks can hold any part of any of the 150 regular vivosaurs; coloured rocks
   fix the element; dark rocks are always red-boned heads (+25 points); wondrous and miraculous rocks hold
   silver and gold fossils.
2. **Cleaning Room** – hammer and drill the rock away within 90 seconds. Rocks use the 18 official rock
   shapes; the skull, ribcage, arm or leg bones inside are drawn procedurally per rock. Uncovered bone fills
   the meter, damaged bone drains it. 50 points are needed to integrate the fossil.
3. **Revival and ranks** – a head fossil revives the vivosaur; body, arms and legs add their cleaning score as
   rank points (50 points per rank, max rank 20, skills unlock at ranks 1/3/5/7). Battles also grant rank points.
4. **Super revival** – silver fossils add LP and one or two stats and change the vivosaur's colours; gold
   fossils boost everything and super-evolve the 30 eligible vivosaurs.
5. **Battle** – solo matches against a bot, ranked matchmaking, or private rooms with a code. Winner
   takes 2,500 G, loser 600 G; every vivosaur that fought gains rank points.

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

### Documented assumptions

Numbers the wiki does not give are set in `packages/shared/src/constants.ts` and marked as assumptions:
Super Excite's spin chance, the chance a confused vivosaur skips its action, Resurrect's LP, the team-skill power penalty per KO, and the rank-based stat curve
(the wiki lists max-rank stats only). Transformations restore the new form's full LP.

## Data

`packages/shared/src/data/vivosaurs.json` was generated from the Fossil Fighters wiki (fossilfighters.fandom.com)
vivosaur pages and the competitive Fossil Fighters wiki's battle-calculation pages. Medal, battle sprite and rock-shape images
in `packages/client/public/img` come from the same wiki. Fossil Fighters is © Nintendo / Red Entertainment; this is
an unofficial fan project.
