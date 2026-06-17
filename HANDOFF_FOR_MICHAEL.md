# Plotlands — Developer Handoff (for Michael)

A working **multiplayer browser MMO prototype** (top-down tile world, Build · Fight · Trade),
in the style of islands.games. **No blockchain yet** — that's a later layer by design.
The shared-world networking is real and tested; this runs today.

ALFA's note: build/iterate via Claude Code as usual. This doc has copy-paste prompts for the next steps.

---

## File map

| File | What it is |
|---|---|
| `isle_online.html` | The game client. Connects to the server; renders the world, remote players, slimes, chat, HUD. Falls back to **offline solo** if no server. Mobile joystick + desktop WASD. |
| `server.js` | Authoritative Node + `ws` game server. Owns players, shared world edits, slimes, chat, **economy + combat**. 15 Hz tick. |
| `store.js` | Persistence layer. File-snapshot backend by default (zero config); PostgreSQL when `DATABASE_URL` is set. |
| `test/` | Automated harness + suites (`npm test`): economy/combat anti-cheat, persistence; plus `loadtest.js` (`npm run loadtest`). |
| `solana/` | **Unaudited devnet scaffold** for on-chain land (Anchor program + tests). Not deployed, not wired in. See its README. |
| `package.json` | Server deps (`ws`; optional `pg`) + `npm start` / `npm test` / `npm run loadtest`. |
| `DEPLOY.md` | Step-by-step: run locally + deploy for global play, persistence, env vars, scaling. |
| `ISLANDS_MMO_ARCHITECTURE_HANDOFF.md` | The full architecture vision (the "where this is going" doc). Read for the big picture. |

---

## Run it locally (2 minutes)

```bash
npm install
npm start                         # ws://localhost:2567  (saves to ./data/world.json)
npm test                          # optional: run the automated suites
```
Open `isle_online.html?server=ws://localhost:2567` in **two** browser tabs.
You'll see both players move in real time, share buildings/trees, and chat.
Progress + the shared world persist across restarts (file backend by default).

## Go global
See `DEPLOY.md`. Short version: deploy `server.js` to Railway/Render/Fly → get a
`wss://...` URL → set `DEFAULT_SERVER` at the top of `isle_online.html` → host the
HTML statically → share the link. Players worldwide join the same island.

---

## How it works now

- **Client** is server-authoritative for the shared world: it sends inputs/edits, renders
  what the server broadcasts. Local player movement is predicted locally for responsiveness;
  remote players + slimes are interpolated from 15 Hz server snapshots.
- **Server** owns: player presence, world edits (build / chop / farm / harvest, with tree
  regrow), server-simulated slimes, chat. Has a soft cap (60 players) and basic rate limiting.
- **Message protocol** (JSON over WS): client→server `join, input, edit, attack, chat`;
  server→client `init, joined, left, state, edit, slimeDead, chat, full`, plus a private
  `self` message that pushes each player their own balances/HP/level.

### Authoritative vs client-trusted (important)
- **Authoritative (server):** presence, world edits, slimes, chat, **and the full economy
  + combat** — wood/coin/xp/level, build/chop/farm/harvest costs & awards, slime and player
  HP/damage, respawn, and merchant transactions. The client renders server-sent
  balances/HP; it never computes them online (see step #1, done).
- **Client-trusted (remaining prototype shortcut):** player **position** only. Movement is
  predicted locally and lightly validated server-side. Full server-authoritative movement is
  the larger Fase 1 netcode task — fine to defer for the prototype.

---

## Next steps (priority order, with Claude Code prompts)

### 1. Server-authoritative economy & combat (anti-cheat) — ✅ DONE
> CC: "In server.js, move the economy and combat server-side. Track each player's wood,
> coin, level, hp on the server. Validate chop/build/farm/harvest against server-side
> resource costs and ownership; award wood/coin server-side and broadcast balances.
> Resolve slime damage and player damage on the server tick. The client should display
> server-sent balances/HP, not compute them. Keep client-side prediction for movement only."

Implemented: the server owns wood/coin/xp/level/HP and validates every action (cost,
ownership, range, cooldown), awards resources, resolves slime & player damage on the tick,
handles respawn, and runs the merchant. Each player gets a private `self` snapshot; the
client displays it and no longer computes balances/HP online. Covered by `npm test`
(`test/integration.js` — 18 economy/combat anti-cheat assertions). Offline-solo mode keeps
its local simulation.

### 2. Persistence & accounts — ✅ DONE
> CC: "Add PostgreSQL persistence to server.js (use `pg`). Persist accounts (guest +
> optional name), player progress (level, xp, wood, coin), and the world (buildings, farms).
> Load world + player on connect, save on key events and every 30s. Add a simple guest
> account id stored client-side so a returning player keeps progress."

Implemented in `store.js` behind one interface with two backends:
- **File** (default, zero-config): atomic JSON snapshot under `DATA_DIR` (`./data/`).
  Great for local dev / a single VPS / this prototype — no database to run.
- **PostgreSQL** (when `DATABASE_URL` is set): durable, concurrent-safe via `pg`
  (lazy-loaded, listed as an optional dependency). Schema auto-created on boot.

The server loads the world on boot and a returning player's progress on join (matched by a
guest id the client stores in `localStorage`). Saves happen on key events (world edit,
disconnect), every 5s for changed accounts, every 30s for all, and once more on graceful
shutdown (SIGINT/SIGTERM). Returning players keep level/xp/wood/coin/deeds and respawn
where they left off. Covered by `npm test` (`test/persistence.js`).

### 3. Polish & content — ✅ DONE
> CC: "Add: a day/night tint cycle, 2-3 more enemy types with different speed/hp, an
> inventory/stats panel, sound effects via WebAudio, and a settings toggle for the server URL."

Implemented:
- **Day/night cycle** — an 8-minute wall-clock-synced tint (so all players share time of
  day) with a dawn/dusk warm glow and a ☀️/🌙 indicator in the top bar.
- **3 enemy types** — `slime` (baseline), `sprite` (fast, fragile, wider aggro), `brute`
  (slow, tanky, hits hard, worth more). Server-authoritative per-type hp/speed/damage/reward;
  the client renders each distinctly (size, colour, horns/sparkle). Numbers are mirrored in
  the client `ENEMY` table and server `ENEMY` map (kept in sync, like the map gen).
- **Inventory / character panel** — toggle **I**: name, level, HP/XP bars, wood/coin/deeds.
- **WebAudio SFX** — synthesized chop/build/plant/hit/kill/coin/hurt/level-up blips (no asset
  files); unlocked on first input; toggle in Settings.
- **Settings panel** — toggle **O** or the ⚙ button: edit the server URL (saved to
  `localStorage`, reconnects) and a sound on/off switch.

### 4. Scale — ⏳ load-tested; sharding intentionally deferred
> CC: "Refactor server.js into room-based sharding: multiple island rooms each capped at
> ~80 players, with Redis-backed presence so players can see a room list and join. Add
> reconnect-into-same-room handling." (See architecture doc §3.5.)

Done now (the responsible part — the doc says don't shard "until you have players"):
a **load test** (`npm run loadtest`, `test/loadtest.js`). Result: **one process holds 50
concurrent bots at a full ~15 Hz tick, p95 ~30 ms, ~70 MB RSS.** The bottleneck is the
O(players²) broadcast, comfortable to ~60. `DEPLOY.md` documents the exact trigger and the
shard + area-of-interest + Redis plan. **Deferred on purpose** — building it before there's
load is the premature optimization the doc warns against; the load test tells you *when*.

### 5. On-chain layer — 🧩 scaffold authored; gated on audit (ALFA's plan: last)
> CC step A: "Write an Anchor program with a buy_land instruction that verifies a USDC
> transfer to a treasury and records land ownership in a PDA registry, plus a transfer_land
> instruction. Include tests."

Authored under `solana/` (Anchor program + tests + integration README). It's an **unaudited
devnet scaffold — NOT deployed, NOT wired to the live game, NOT compiled here.** The Merchant's
off-chain **Land Deed** stays server-authoritative until the program is built, devnet-tested,
and **audited** (it custodies real USDC — the doc forbids skipping this). `solana/README.md`
has the build/test commands and the today→on-chain migration path (wallet-adapter, Helius
indexer, a `land` table in `store.js`).

**Off-chain land already works** (the precursor): a Land Deed can be spent to **claim a map
tile** (`claim` message), claimed land is **protected** (others can't build/farm on it) and
**pays passive rent** to its owner. Claims persist (`world.claims`, file + Postgres) and show
in-world with the owner's name. When the chain goes live, on-chain ownership just becomes the
source of truth for these claims. Covered by `npm test` (`test/land.js`).

---

## Content & systems (live)
Build · chop · farm · fight; **merchant upgrades** (sword/axe/HP/boots, escalating cost);
**land ownership** (claim plots, build-protected, passive rent); a roaming **Warlord boss**
event; **leaderboard** + **/pay** transfers; day/night, 3 enemy types, goals, auto-chop. All
server-authoritative and covered by `npm test` (7 suites).

## Known limitations (be aware)
- Player **position** is client-predicted but now **server speed-clamped** (teleport/speedhack
  are bounded to ~1.4× legit speed). Full server-simulated movement is still the larger Fase 1
  netcode task, but the obvious cheats are closed.
- One process / one region → distant players get latency, and the world is a single shared
  island capped at ~60 (→ step #4 sharding for true global scale).
- Load-tested with 50 synthetic bots (`npm run loadtest`); still worth a **real multi-device
  test** on actual networks before a public launch.
- On-chain land is a scaffold only (`solana/`) — unaudited, not deployed. Don't custody real
  USDC until it's built, devnet-tested, and audited.
