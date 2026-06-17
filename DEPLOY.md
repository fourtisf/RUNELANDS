# RUNELANDS — Multiplayer Deploy Guide

Two parts: the **server** (authoritative, owns the shared world) and the **client**
(`isle_online.html`, what players open).

**Simplest: one process serves both.** The server now also serves the game page over HTTP on
the same port, and the client auto-connects to whatever host it was served from. So you just
deploy `server.js`, open `http://your-host:2567/`, and play — no separate static hosting, no
URL to configure. (`http://your-host:2567/health` is the plain-text liveness check.) You can
still host the HTML separately and point it at a server with `?server=...` if you prefer.

## 1. Run the server locally (test)
```
npm install
npm start            # http + ws on :2567  →  open http://localhost:2567/
```
Open `http://localhost:2567/` in two browser tabs — you'll see each other move in real time
and share the same world. (Or open `isle_online.html?server=ws://localhost:2567` directly.)

## 2. Deploy the server so anyone on Earth can connect
Any Node host works. Easiest options:

- **Railway / Render / Fly.io**: push this folder (server.js + package.json),
  set start command `npm start`. They give you a public URL.
- The host gives you `https://yourapp.onrender.com` → your WebSocket URL is
  `wss://yourapp.onrender.com` (note: `wss://`, secure, required from an https page).
- A plain VPS: `npm install && PORT=2567 node server.js`, put Nginx/Caddy in front
  for TLS, expose `wss://yourdomain`.

## 3. Point the client at the server
Edit the top of `isle_online.html`:
```js
const DEFAULT_SERVER = "wss://yourapp.onrender.com";
```
Then host `isle_online.html` anywhere static (Vercel, Netlify, GitHub Pages, Cloudflare Pages).
Share the link — players worldwide load it and connect automatically.
You can also override per-link: `isle_online.html?server=wss://...&name=Alex`.

## 4. Persistence (saves)
The server persists the shared world and each player's progress automatically.

- **Default (no setup):** a JSON snapshot at `DATA_DIR/world.json` (defaults to `./data/`).
  Writes are atomic and flushed on changes, periodically, and on graceful shutdown. Perfect
  for local dev or a single always-on VPS. On managed hosts with **ephemeral disks**
  (Render/Railway/Fly default), attach a persistent volume and point `DATA_DIR` at it,
  or use Postgres ↓ (otherwise the file is wiped on redeploy).
- **PostgreSQL (recommended for production):** set `DATABASE_URL` and the server uses it
  instead of the file (tables auto-created on boot). `pg` is an optional dependency:
  ```
  DATABASE_URL=postgres://user:pass@host:5432/isle  npm start
  ```
- Players are matched to their saved progress by a **guest id** the client stores in
  `localStorage` (no login). Clearing browser storage starts a fresh guest.

### Server env vars
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `2567` | WebSocket/HTTP port |
| `DATA_DIR` | `./data` | File-backend save directory |
| `DATABASE_URL` | _(unset)_ | If set, use PostgreSQL instead of the file backend |
| `LAND_INCOME_MS` | `60000` | How often owned land pays its owner rent |
| `BOSS_INTERVAL_MS` | `120000` | How often a Warlord boss spawns (while players are online) |

## What's authoritative vs not (prototype honesty)
- **Server owns:** player presence, shared world edits (build/chop/farm), slimes, chat,
  **and the full economy + combat** — wood/coin/xp/level, action costs & awards, slime and
  player HP/damage, respawn, and merchant transactions. The client renders server-sent
  balances/HP and validates nothing of value itself.
- **Still client-side (remaining prototype shortcut):** player **position** is predicted
  locally and only lightly validated server-side. Full server-authoritative movement is the
  larger Fase 1 netcode task (architecture handoff doc, §3) — fine to defer for now.

## Scaling & load testing
Before any launch, load-test it (the architecture doc calls this out as non-negotiable):
```
npm run loadtest            # 50 bots, 8s   (or: node test/loadtest.js [bots] [seconds])
```
Measured on one process (this prototype): **50 concurrent bots held a full ~15 Hz tick,
p95 chat round-trip ~30 ms, ~73 KB/s downstream per client, ~70 MB RSS.** Comfortable for
tens of players in one shared world.

**The ceiling is the broadcast: state is O(players²)** — every player's snapshot includes
every other player, so per-client bandwidth grows with the player count. That's fine to ~60
(the `MAX_PLAYERS` soft cap) but melts in the hundreds.

**When to scale (not before — premature sharding is wasted work):** once a single world
regularly approaches the cap, or `loadtest` shows the tick rate sagging below ~12/s or
bandwidth/CPU climbing, move to:
- **Room sharding** — multiple island rooms each capped ~60–80, spawn a new room when full.
- **Area-of-interest** — a spatial-hash grid so a player only receives entities near them
  (kills the O(n²) term).
- **Redis presence** — cross-room player list + reconnect-into-same-room.

See `ISLANDS_MMO_ARCHITECTURE_HANDOFF.md` §3.3–3.5 for the full design.
