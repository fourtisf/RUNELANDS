// Plotlands — authoritative multiplayer server (prototype tier)
// Node + ws. Owns: players, shared world edits, slimes, AND the economy + combat.
// 15 Hz tick. Deploy anywhere that runs Node (Railway / Render / Fly.io / a VPS).
//
// Server-authoritative model (anti-cheat):
//   - Resources (wood, coin), progression (xp, lv), and HP/combat live ONLY here.
//   - The client sends INTENT (chop/build/farm/harvest/attack/shop); the server
//     validates cost + ownership + range + cooldown, mutates the truth, and pushes
//     each player their own balances/HP via a private `self` message.
//   - The client renders server-sent balances/HP; it never computes them online.
//   - Movement stays client-predicted (client sends position, lightly validated) —
//     full server-authoritative movement is the larger Fase 1 netcode task.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { createStore } = require('./store');

// Load a local .env (if present) so contest/admin config survives redeploys WITHOUT re-typing env
// vars each time. The real shell env always wins; .env only fills what's unset. Keep .env out of git.
try { const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2].trim(); if (v.length>=2 && ((v[0]==='"'&&v.slice(-1)==='"')||(v[0]==="'"&&v.slice(-1)==="'"))) v = v.slice(1,-1);
    process.env[m[1]] = v;
  }
} catch (e) { console.error('[.env]', e.message); }

const PORT = process.env.PORT || 2567;
const TILE = 40, W = 128, H = 96, TICK = 1000 / 15;
const MAX_PLAYERS = 60;          // soft cap per world (one process)
const MSG_PER_SEC = 40;          // basic per-connection rate limit
const SAVE_DIRTY_MS = 5000;      // flush changed accounts to storage
const SAVE_ALL_MS = 30000;       // periodic full save (also captures position)

// Persistence: file snapshot by default; PostgreSQL when DATABASE_URL is set.
const store = createStore();

// ---- economy + combat config (single source of truth) ----
const COST = { house: 8, fence: 2, farm: 3 };          // wood
const MAX_BUILDINGS = +process.env.MAX_BUILDINGS || 40;  // anti-grief: max structures one player may own
const AWARD = {
  chopWood: 3, chopXp: 8,
  buildXp: 5,
  harvestCoin: 4, harvestXp: 6,
  mineStone: 2, mineXp: 10,
  fishXp: 8,
}; // enemy-kill rewards live in ENEMY (per type)
const FARM_GROW_MS = +process.env.FARM_GROW_MS || 20000;   // matches client's visual growth (20s)
const TREE_REGROW_MS = +process.env.TREE_REGROW_MS || 28000;
const STONE_REGROW_MS = +process.env.STONE_REGROW_MS || 35000; // mined rock replenishes after this
const STONE_SELL = 3;            // coins per stone at the merchant (rarer than wood's 2)
const FISH_COOLDOWN_MS = +process.env.FISH_COOLDOWN_MS || 2500; // min time between catches (rod cadence)
const FISH_SELL = 4;             // coins per fish at the merchant
const FISH_HEAL = +process.env.FISH_HEAL || 12;  // HP restored per fish eaten
const FISH_EAT_XP = +process.env.FISH_EAT_XP || 4; // XP gained per fish eaten
// Crafting: a wood/stone sink. Refine wood→planks, then spend planks+stone on a Reinforced Pick
// (the only way to raise mining yield — distinct from the merchant's coin upgrades).
const PLANK_WOOD = 3;            // wood per plank
const PICK_MAX = 8;
const pickPlankCost = lv => 4*(lv+1);   // planks for the next pick level
const pickStoneCost = lv => 6*(lv+1);   // stone for the next pick level
const REACH = TILE * 2.2;        // max action distance (server, with latency slack)
const ATTACK_REACH = TILE * 2.4; // max melee distance to an enemy
const SWORD_HIT = 14;            // sword damage per swing
const HURT_CD_MS = 600;          // i-frames after taking a hit
const DEATH_COIN_PENALTY = 3;
const XP_BASE = 100, XP_GROWTH = 1.4, HP_PER_LEVEL = 20, HP_BASE = 100;
const BASE_SPD = 165;            // base player move speed px/s (must match client) — anti-cheat clamp
// New-player friendliness: a safe hub at spawn, brief protection, and out-of-combat regen.
const SPAWN_PROTECT_MS = +process.env.SPAWN_PROTECT_MS || 3000; // invulnerable after join/respawn
const REGEN_DELAY_MS = +process.env.REGEN_DELAY_MS || 4000;     // start HP regen this long after last hit
const REGEN_PER_SEC = 4;         // HP/sec regenerated out of combat
const SAFE_TILES = +process.env.SAFE_TILES || 6; // radius (tiles) of the safe hub around spawn
const TUTORIAL_REWARD = +process.env.TUTORIAL_REWARD || 25; // one-time coins for finishing onboarding (per account)
// Daily reward: claimable once per ~day; returning within the grace window grows a streak (bigger reward).
const DAILY_COOLDOWN_MS = +process.env.DAILY_COOLDOWN_MS || 20*3600*1000; // claimable again after this
const DAILY_GRACE_MS    = +process.env.DAILY_GRACE_MS    || 48*3600*1000; // claim within this of last → streak continues
const DAILY_BASE = 15, DAILY_STREAK_BONUS = 5, DAILY_STREAK_CAP = 7;       // reward = 15 + (min(streak,7)-1)*5  → 15..45
const dailyReward = streak => DAILY_BASE + (Math.min(Math.max(streak,1),DAILY_STREAK_CAP)-1)*DAILY_STREAK_BONUS;
// Land ownership: spend a Land Deed to claim a tile; owned land is protected and pays passive coins.
const LAND_INCOME_MS = +process.env.LAND_INCOME_MS || 60000; // pay land owners on this interval
const LAND_INCOME_PER_PLOT = 2;  // coins per owned plot per payout (× house level)
// House tiers: a claimed plot's house upgrades through named tiers (the claim's `level`, 1-based).
// Each step costs coins AND requires a minimum PLAYER level — a real progression sink, not just coins.
// Index i = house level i+1; `cost`/`reqLv` are what it takes to upgrade INTO that tier.
// Override the whole table with HOUSE_TIERS_JSON (JSON array of {name,cost,reqLv}).
const HOUSE_TIERS = (() => {
  const def = [
    { name:'House',   cost:0,     reqLv:1  },   // Lv1 — the home you get on claim
    { name:'Cottage', cost:200,   reqLv:8  },   // Lv2
    { name:'Villa',   cost:600,   reqLv:16 },   // Lv3
    { name:'Manor',   cost:1800,  reqLv:26 },   // Lv4
    { name:'Mansion', cost:5000,  reqLv:38 },   // Lv5
    { name:'Hotel',   cost:15000, reqLv:55 },   // Lv6 — endgame status symbol
  ];
  if(process.env.HOUSE_TIERS_JSON){ try{ const j=JSON.parse(process.env.HOUSE_TIERS_JSON);
    if(Array.isArray(j)&&j.length) return j.map(t=>({name:String(t.name||'House'),cost:Math.max(0,+t.cost||0),reqLv:Math.max(1,+t.reqLv||1)})); }
    catch(e){ console.error('[HOUSE_TIERS_JSON]',e.message); } }
  return def;
})();
const MAX_HOUSE_LV = HOUSE_TIERS.length;
const houseTier = lv => HOUSE_TIERS[Math.min(Math.max(lv|0,1),MAX_HOUSE_LV)-1]; // tier info for a house at level `lv`

// ---- seasonal leaderboard + wallet-bound airdrop ----
// Everyone races on "season points" (= activity this season, mirroring XP earned). When a season
// ends, the top finishers earn AIRDROP points: permanent, wallet-bound reward points that NEVER
// reset (the on-chain payout hook). Player progress (coin/level/plots) is never touched.
const SEASON_MS = +process.env.SEASON_MS || 7*24*3600*1000;        // season length (default: weekly)
const SEASON_CHECK_MS = +process.env.SEASON_CHECK_MS || 15000;     // how often the rollover timer checks
const AIRDROP_REWARDS = (process.env.SEASON_REWARDS || '100,60,30')// airdrop points for season ranks 1/2/3…
  .split(',').map(n=>Math.max(0,parseInt(n,10)||0)).filter(n=>n>0);
let season = null;                                                 // {no,start,end,last} — set at boot
let _racers = 0;                                                   // cached count of players competing (recomputed every ~30s)
const seasonMeta = () => season ? { no:season.no, endsAt:season.end, rewards:AIRDROP_REWARDS, last:season.last||null, title:CONTEST.title, prize:CONTEST.prize, active:CONTEST.active, racers:_racers, shareMe:CONTEST.shareMe } : null;
// A real-money CONTEST is just a season with a fixed end time + a prize/raffle layer on top.
// SEASON_END (ISO date or epoch ms) pins the current season to close exactly at the contest deadline.
function parseSeasonEnd(){ const s=process.env.SEASON_END; if(!s) return null;
  const t = /^\d+$/.test(s) ? +s : Date.parse(s); return Number.isFinite(t) ? t : null; }
// Raffle: a share of the prize is drawn among everyone who reached a participation threshold —
// 1 ticket per RAFFLE_PTS_PER_TICKET season points (min RAFFLE_MIN_PTS to enter, capped at MAX).
const RAFFLE_MIN_PTS = +process.env.RAFFLE_MIN_PTS || 1000;
const RAFFLE_PTS_PER_TICKET = +process.env.RAFFLE_PTS_PER_TICKET || 500;
const RAFFLE_MAX_TICKETS = +process.env.RAFFLE_MAX_TICKETS || 10;
function raffleTickets(pts){ return pts>=RAFFLE_MIN_PTS ? Math.min(RAFFLE_MAX_TICKETS, Math.floor(pts/RAFFLE_PTS_PER_TICKET)) : 0; }
// Admin export (final standings → payout). Disabled unless ADMIN_KEY is set; the /admin/* routes
// require ?key=ADMIN_KEY (any other request 404s, so the endpoint is invisible without the key).
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IP_SALT = process.env.IP_SALT || ADMIN_KEY || 'plotlands';   // salts the stored IP hash (privacy)
function hashIp(ip){ return ip ? crypto.createHash('sha256').update(ip+'|'+IP_SALT).digest('hex').slice(0,16) : null; }
function clientIp(req){ if(!req) return '';
  return (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || (req.headers['x-forwarded-for']||'').split(',')[0].trim() || (req.socket&&req.socket.remoteAddress) || ''); }
// Public leaderboard (no auth, NO wallets) — a shareable hype page at /leaderboard backed by /api/leaderboard.
// Contest framing (title + prize badges) shows when SEASON_END is set; all text is env-configurable.
const CONTEST = {
  active: !!process.env.SEASON_END,
  title: process.env.CONTEST_TITLE || 'Season Showdown',
  prize: process.env.CONTEST_PRIZE || '',                                  // big headline, e.g. "$1000"
  prizes: (process.env.CONTEST_PRIZES || '🥇 $300|🥈 $175|🥉 $100|#4 $75|#5 $50|🎟️ Raffle $300').split('|').map(s=>s.trim()).filter(Boolean),
};
// Pre-written share copy variants for the public X/Telegram/WhatsApp buttons (the URL is added by the
// share intent). The page picks one at random per click so the copy isn't identical every time.
// Title already carries the prize ("$1000 Season Showdown") so we don't prepend it. Override via
// CONTEST_SHARE (variants separated by "|||").
const SHARE_DEFAULT = [
  '🏆 ' + CONTEST.title + ' is LIVE on @plotlandsfun!\n\nA free Solana island MMO — build your island, hunt monsters, fish & farm your way up the leaderboard. Top players win real cash 💰\n\n🎮 Free to play — just connect your Solana wallet & climb 👇\n\n#Plotlands #plotlandsfun #plotlandscontest',
  '💰 Win real cash in the ' + CONTEST.title + ' on @plotlandsfun! Climb the leaderboard in a free Solana island MMO — build, fight, fish & trade. Connect your wallet & start earning 👇\n\n#Plotlands #plotlandsfun #plotlandscontest',
  '⚔️ The ' + CONTEST.title + ' is ON @plotlandsfun! Free to play on Solana — grind monsters, claim land & race to the top for the prize pool 💰 Connect your wallet & play 👇\n\n#Plotlands #plotlandsfun #plotlandscontest',
];
CONTEST.shareText = (process.env.CONTEST_SHARE ? process.env.CONTEST_SHARE.split('|||') : SHARE_DEFAULT).map(s=>s.trim()).filter(Boolean);
// Personalised "share my rank" copy for the in-game button — a list of variants the client picks
// from at random (so repeat shares vary). Tokens {name} {pts} {rank} {title} are filled client-side
// (only the game knows who you are). Override via CONTEST_SHARE_ME (templates separated by "|||").
const SHARE_ME_DEFAULT = [
  '🏆 {name} is climbing the {title} on @plotlandsfun — {pts} pts{rank}! Think you can beat me? 👇 Free to play. #Plotlands #plotlandsfun #plotlandscontest',
  '⚔️ Just hit {pts} pts{rank} in the {title} on @plotlandsfun! Build, fight & climb on Solana — catch me if you can 👇 #Plotlands #plotlandsfun #plotlandscontest',
  '💰 {name} is grinding the {title} prize pool on @plotlandsfun ({pts} pts{rank}). Connect your wallet & race me 👇 #Plotlands #plotlandsfun #plotlandscontest',
  "🏝️ {name} here — {pts} pts{rank} on the @plotlandsfun leaderboard! Free Solana MMO, real cash up top. Bet you can't beat me 👇 #Plotlands #plotlandsfun #plotlandscontest",
];
CONTEST.shareMe = (process.env.CONTEST_SHARE_ME ? process.env.CONTEST_SHARE_ME.split('|||') : SHARE_ME_DEFAULT).map(s=>s.trim()).filter(Boolean);
const LEADERBOARD_CACHE_MS = +process.env.LEADERBOARD_CACHE_MS || 10000;   // serve a cached public board under viral load
let _lbCache=null, _lbCacheAt=0;
// "Verify to compete": when on, only players who shared on X (verified) have their points counted in
// the contest standings / public board / raffle. They still play & accrue points — those points just
// "activate" once they verify. Drives shares. Toggle with VERIFY_REQUIRED=1.
const VERIFY_REQUIRED = process.env.VERIFY_REQUIRED === '1';
const contestEligible = r => !VERIFY_REQUIRED || !!r.verified;

// ---- Solana wallet login (Phantom) ----
// Players may enter and watch as a spectator, but must connect + sign with a Solana wallet
// before they can move or act. The wallet is verified server-side (ed25519 over a per-connection
// nonce) and linked to the account so progress is saved and recoverable across devices.
// Set WALLET_REQUIRED=0 to disable the gate (e.g. local dev).
const WALLET_REQUIRED = process.env.WALLET_REQUIRED !== '0';
const LOGIN_PREFIX = 'Sign in to Plotlands\nWallet login — nonce: ';
// Login nonces are normally tied to the live socket. The Phantom mobile deeplink flow, however, reloads
// the page (new socket → new nonce) between signing and submitting the signature, so we also accept any
// nonce we issued in the last few minutes. Nonces are one-time (deleted on use) → no replay window.
const NONCE_TTL_MS = 10*60*1000;
const recentNonces = new Map();   // nonce -> expiry ms
function issueNonce(){ const n = crypto.randomBytes(16).toString('hex'); recentNonces.set(n, Date.now()+NONCE_TTL_MS); return n; }
function nonceFresh(n){ const exp = recentNonces.get(n); if(!exp) return false; if(exp < Date.now()){ recentNonces.delete(n); return false; } return true; }
{ const _np = setInterval(()=>{ const now=Date.now(); for(const [n,exp] of recentNonces) if(exp<now) recentNonces.delete(n); }, 5*60*1000); if(_np.unref) _np.unref(); }
// gameplay messages a spectator (no verified wallet) may NOT send until they connect.
// NOTE: 'unstuck' is intentionally NOT gated — it's a safety/recovery action that must always work.
const GATED = new Set(['input','edit','attack','shop','claim','upgradeland','fish','eat','craft','tutdone','claimdaily','setname','verify']);

// Merchant upgrades — a coin sink + power progression. Cost escalates: base*(level+1).
const UPGRADES = {
  sword: { base:30, field:'swordLv', label:'Sharper Sword', fx:'+6 sword damage' },
  axe:   { base:25, field:'axeLv',   label:'Sturdy Axe',    fx:'+2 wood per chop' },
  vit:   { base:40, field:'vitLv',   label:'Vitality',      fx:'+25 max HP' },
  boots: { base:35, field:'bootsLv', label:'Swift Boots',   fx:'+ move speed' },
};
const UPG_MAX = 8;
const upgCost = (stat, lv) => UPGRADES[stat].base * (lv + 1);

// Enemy roster (gameplay numbers MUST match the client's ENEMY table in isle_online.html).
//   hp/accel/fric drive movement+toughness, dmg=contact damage, coin/xp=kill reward,
//   r=body radius (collision/contact), aggro=chase radius in tiles, weight=spawn chance.
const ENEMY = {
  slime:  { hp:30,  accel:60, fric:0.86, dmg:11, coin:5,  xp:20,  wood:2,  stone:0,  r:10, aggro:4.2, weight:60 },
  sprite: { hp:18,  accel:98, fric:0.82, dmg:8,  coin:7,  xp:16,  wood:1,  stone:0,  r:8,  aggro:6.0, weight:25 },
  wisp:   { hp:12,  accel:140,fric:0.80, dmg:6,  coin:9,  xp:18,  wood:0,  stone:0,  r:7,  aggro:7.0, weight:18 }, // fast, fragile, darty
  brute:  { hp:60,  accel:38, fric:0.90, dmg:20, coin:12, xp:40,  wood:5,  stone:2,  r:14, aggro:3.4, weight:15 },
  golem:  { hp:120, accel:26, fric:0.93, dmg:24, coin:20, xp:60,  wood:8,  stone:6,  r:16, aggro:3.0, weight:8  }, // slow tank, big loot
  boss:   { hp:360, accel:34, fric:0.91, dmg:18, coin:90, xp:160, wood:40, stone:20, r:22, aggro:5.0, weight:0  }, // event boss (never random)
};
// weighted pick over normal enemies only (boss spawns on its own timer)
const ENEMY_WEIGHT_TOTAL = Object.values(ENEMY).reduce((s,e)=>s+e.weight,0);
function pickEnemyType(){ let r=Math.random()*ENEMY_WEIGHT_TOTAL;
  for(const k in ENEMY){ r-=ENEMY[k].weight; if(r<=0) return k; } return 'slime'; }
const BOSS_INTERVAL_MS = +process.env.BOSS_INTERVAL_MS || 120000; // try to keep a boss alive ~every 2 min

// ---- map (must match client exactly) ----
const T = { WATER:0, SHALLOW:1, SAND:2, GRASS:3, FOREST:4, STONE:5, FLOWER:6 };
function seed(x,y){let n=x*374761393+y*668265263;n=(n^(n>>>13))>>>0;n=Math.imul(n,1274126177)>>>0;n=(n^(n>>>16))>>>0;return n/4294967296;}
function noise(x,y,s){return seed(Math.floor(x*s),Math.floor(y*s));}
const map=[];
(function gen(){const cx=W/2,cy=H/2;
  function pondAt(x,y){const P=[[50,38,5],[80,40,5],[80,58,5],[48,60,5],[64,68,4],[64,30,4]]; // several big inland fishing ponds
    for(let i=0;i<P.length;i++){const d=Math.hypot(x-P[i][0],y-P[i][1]);if(d<P[i][2]-0.7)return 2;if(d<P[i][2]+0.5)return 1;if(d<P[i][2]+5)return 3;}return 0;}
  for(let y=0;y<H;y++){map[y]=[];for(let x=0;x<W;x++){
    const dx=(x-cx)/(W*0.44),dy=(y-cy)/(H*0.44),d=Math.sqrt(dx*dx+dy*dy);
    const n=noise(x,y,0.18)*0.30+noise(x,y,0.5)*0.16+noise(x,y,0.9)*0.07;
    const land=d-n-0.10;let t;
    if(land>0.62)t=T.WATER;else if(land>0.50)t=T.SHALLOW;else if(land>0.40)t=T.SAND;
    else{t=T.GRASS;const ff=seed(x,y)*0.45+noise(x,y,0.30)*0.55,sf=noise(x,y,0.16);
      if(sf>0.86)t=T.STONE;else if(ff>0.62)t=T.FOREST;else if(seed(x+31,y+11)>0.90)t=T.FLOWER;}
    const pv=pondAt(x,y);if(pv===2)t=T.WATER;else if(pv===1&&t!==T.WATER)t=T.SHALLOW;else if(pv===3&&(t===T.FOREST||t===T.STONE||t===T.FLOWER))t=T.GRASS; // clear the pond shore (no trees/rocks)
    map[y][x]=t;}}
  for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++)if(map[y][x]===T.FOREST||map[y][x]===T.STONE)map[y][x]=T.GRASS;
})();
function tileAt(x,y){if(x<0||y<0||x>=W||y>=H)return T.WATER;return map[y][x];}
// Effective tile: a chopped forest tile behaves like grass (stump → buildable/plantable),
// mirroring the client so build/plant validation agrees on both ends.
function effTile(x,y){const t=tileAt(x,y);if(t===T.FOREST&&world.chopped[x+','+y])return T.GRASS;return t;}
function walkable(px,py){const tx=Math.floor(px/TILE),ty=Math.floor(py/TILE),t=tileAt(tx,ty);
  if(t===T.WATER||t===T.SHALLOW||t===T.STONE)return false;
  const k=tx+','+ty; if(world.buildings[k])return false; return true;}

// ---- shared world state ----
const world = {
  buildings:{},   // "x,y" -> {type}
  chopped:{},     // "x,y" -> respawnAtMs   (tree currently chopped)
  mined:{},       // "x,y" -> respawnAtMs   (rock currently mined out)
  farms:{},       // "x,y" -> {plantedAt}
  claims:{},      // "x,y" -> {owner:guestId, name}   (owned land)
};
function claimCount(guestId){ if(!guestId) return 0; let n=0; for(const k in world.claims) if(world.claims[k].owner===guestId) n++; return n; }
function buildingCount(owner){ let n=0; for(const k in world.buildings) if(world.buildings[k].owner===owner) n++; return n; }
function ownerRent(guestId){ if(!guestId) return 0; let r=0; for(const k in world.claims) if(world.claims[k].owner===guestId) r+=(world.claims[k].level||1)*LAND_INCOME_PER_PLOT; return r; }
function spawnPoint(){const cx=Math.floor(W/2),cy=Math.floor(H/2);
  for(let r=0;r<12;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    const tx=cx+dx,ty=cy+dy;if(tileAt(tx,ty)===T.GRASS && !world.buildings[tx+','+ty]){return{x:(tx+0.5)*TILE,y:(ty+0.5)*TILE};}}
  return{x:cx*TILE,y:cy*TILE};}
// nearest walkable (land, no build) tile to a point — backs the client's "Unstuck" button
function nearestWalkable(px,py){const ptx=Math.floor(px/TILE),pty=Math.floor(py/TILE),ok=(tx,ty)=>walkable((tx+0.5)*TILE,(ty+0.5)*TILE);
  // require the tile AND its 4 neighbours to be walkable → a genuinely open spot you can move from
  for(let r=0;r<=30;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const tx=ptx+dx,ty=pty+dy;
    if(ok(tx,ty)&&ok(tx+1,ty)&&ok(tx-1,ty)&&ok(tx,ty+1)&&ok(tx,ty-1))return{x:(tx+0.5)*TILE,y:(ty+0.5)*TILE};}
  return spawnPoint();}
// Safe hub around spawn: enemies don't spawn here, won't chase players standing here,
// and deal no contact damage here. Gives new players a calm place to learn + sell.
const HUB_X=(Math.floor(W/2)+0.5)*TILE, HUB_Y=(Math.floor(H/2)+0.5)*TILE, SAFE_R=SAFE_TILES*TILE;
function inSafeZone(x,y){return Math.hypot(x-HUB_X,y-HUB_Y)<SAFE_R;}
// Anti-grief: a protected no-construction ring around spawn (defaults to the safe hub) so the
// merchant/spawn can't be walled off or land-grabbed. Set NOBUILD_TILES=0 to disable.
const NOBUILD_TILES = process.env.NOBUILD_TILES!==undefined ? +process.env.NOBUILD_TILES : SAFE_TILES;
function inNoBuild(x,y){ return NOBUILD_TILES>0 && Math.hypot(x-HUB_X,y-HUB_Y) < NOBUILD_TILES*TILE; }
// fishing ponds stay open: no building/claiming within a ring around each pond (keep the shore clear)
const POND_LIST=[[50,38,5],[80,40,5],[80,58,5],[48,60,5],[64,68,4],[64,30,4]]; // MUST match map-gen pondAt
function nearPond(tx,ty){ for(const p of POND_LIST) if(Math.hypot(tx-p[0],ty-p[1]) < p[2]+5) return true; return false; }

// ---- players (server owns all stats) ----
let nextId=1;
const players=new Map(); // id -> player
let totalUsers=0; // all-time accounts (distinct guest ids); set after store.init() at startup
function makePlayer(name,ws){const sp=spawnPoint();
  return {id:nextId++, guestId:null, name:String(name||'Player').slice(0,14), lv:1, xp:0, xpMax:XP_BASE,
    x:sp.x, y:sp.y, dir:0, hp:HP_BASE, hpMax:HP_BASE, wood:0, stone:0, fish:0, plank:0, coin:0, deeds:0, tut:0, lastDaily:0, dailyStreak:0,
    seasonPts:0, seasonId:0, airdrop:0, ipHash:null, verified:0,
    swordLv:0, axeLv:0, vitLv:0, bootsLv:0, pickLv:0, hurtUntil:0, lastHitAt:0, lastInputAt:0, lastFish:0,
    wallet:null, linkedWallet:null, walletOk:!WALLET_REQUIRED, nonce:issueNonce(), fresh:false, ws};}
// What every other client may see about a player (no private economy).
function publicPlayer(p){return {id:p.id,name:p.name,lv:p.lv,x:Math.round(p.x),y:Math.round(p.y),dir:p.dir,hp:p.hp,hpMax:p.hpMax};}
// a name is "taken" if any OTHER online player is using it (case-insensitive)
function nameInUse(name,exceptId){const n=(name||'').toLowerCase(); for(const p of players.values()){ if(p.id===exceptId) continue; if((p.name||'').toLowerCase()===n) return true; } return false;}
// validate + apply a name change: unique among ONLINE players AND all stored accounts (online or offline)
async function handleSetName(me, raw){
  const nm=String(raw||'').replace(/[^\w \-]/g,'').trim().slice(0,14);
  if(!nm){ send(me.ws,{t:'nametaken',name:''}); return; }
  if(nameInUse(nm,me.id)){ send(me.ws,{t:'nametaken',name:nm}); return; }
  let taken=false; try{ taken=await store.nameTaken(nm, me.guestId); }catch(e){ console.error('[nameTaken]',e.message); }
  if(taken){ send(me.ws,{t:'nametaken',name:nm}); return; }
  if(!players.has(me.id) || me.ws.readyState!==1) return;            // left during the await
  if(nameInUse(nm,me.id)){ send(me.ws,{t:'nametaken',name:nm}); return; } // re-check (a racer may have taken it)
  me.name=nm; markDirty(me); broadcast({t:'rename',id:me.id,name:nm});
}
function playerList(){return [...players.values()].map(publicPlayer);}
// Private snapshot of a player's own balances/HP. `fx` = optional floating feedback,
// `tp` = optional forced teleport (used on respawn) the client should snap to.
// a player's season points only count for the CURRENT season (old-season points show as 0)
function effSeasonPts(p){ return (season && p.seasonId===season.no) ? (p.seasonPts||0) : 0; }
function selfMsg(p,fx,tp){const m={t:'self',wood:p.wood,stone:p.stone,fish:p.fish,plank:p.plank,coin:p.coin,xp:p.xp,xpMax:p.xpMax,lv:p.lv,hp:p.hp,hpMax:p.hpMax,deeds:p.deeds,
    seasonPts:effSeasonPts(p),airdrop:p.airdrop||0,verified:p.verified||0,
    up:{sword:p.swordLv,axe:p.axeLv,vit:p.vitLv,boots:p.bootsLv,pick:p.pickLv}};
  if(fx)m.fx=fx; if(tp)m.tp=tp; return m;}
function pushSelf(p,fx,tp){send(p.ws,selfMsg(p,fx,tp));markDirty(p);}
// season points track activity this season (mirrors XP gained); lazy-resets when the season rolls over
function addSeasonPts(p,n){ if(!p.guestId||!(n>0)||!season) return;
  if(Date.now()>=season.end) return;                                // season's clock is up → points frozen (stable final standings)
  if(p.seasonId!==season.no){ p.seasonId=season.no; p.seasonPts=0; } // first action of a new season → start fresh
  p.seasonPts=(p.seasonPts||0)+n; }
function gainXP(p,n){addSeasonPts(p,n);p.xp+=n;let leveled=false;
  while(p.xp>=p.xpMax){p.xp-=p.xpMax;p.lv++;p.xpMax=Math.floor(p.xpMax*XP_GROWTH);p.hpMax+=HP_PER_LEVEL;p.hp=p.hpMax;leveled=true;}
  return leveled;}
function inReach(p,tx,ty,max){const cx=(tx+0.5)*TILE,cy=(ty+0.5)*TILE;return Math.hypot(cx-p.x,cy-p.y)<=(max||REACH);}

// ---- account persistence (tie progress to a client-held guest id) ----
const dirty=new Set();              // players with unsaved stat changes
function markDirty(p){ if(p&&p.guestId) dirty.add(p); }
function accountOf(p){return {guestId:p.guestId, name:p.name, lv:p.lv, xp:p.xp, xpMax:p.xpMax,
  wood:p.wood, stone:p.stone, fish:p.fish, plank:p.plank, coin:p.coin, deeds:p.deeds, hp:p.hp, hpMax:p.hpMax, x:Math.round(p.x), y:Math.round(p.y),
  swordLv:p.swordLv, axeLv:p.axeLv, vitLv:p.vitLv, bootsLv:p.bootsLv, pickLv:p.pickLv||0, tut:p.tut||0,
  lastDaily:p.lastDaily||0, dailyStreak:p.dailyStreak||0, wallet:p.wallet||p.linkedWallet||null,
  seasonPts:p.seasonPts||0, seasonId:p.seasonId||0, airdrop:p.airdrop||0, ipHash:p.ipHash||null, verified:p.verified||0};}
function applyAccount(p,acc){
  // name is taken from what the client sent on join (source of truth); progress comes from the account
  if(Number.isFinite(acc.lv)) p.lv=acc.lv;
  if(Number.isFinite(acc.xp)) p.xp=acc.xp;
  if(Number.isFinite(acc.xpMax)) p.xpMax=acc.xpMax;
  if(Number.isFinite(acc.wood)) p.wood=acc.wood;
  if(Number.isFinite(acc.stone)) p.stone=acc.stone;
  if(Number.isFinite(acc.fish)) p.fish=acc.fish;
  if(Number.isFinite(acc.coin)) p.coin=acc.coin;
  if(Number.isFinite(acc.deeds)) p.deeds=acc.deeds;
  if(Number.isFinite(acc.hpMax)) p.hpMax=acc.hpMax;
  if(Number.isFinite(acc.swordLv)) p.swordLv=acc.swordLv;
  if(Number.isFinite(acc.axeLv)) p.axeLv=acc.axeLv;
  if(Number.isFinite(acc.vitLv)) p.vitLv=acc.vitLv;
  if(Number.isFinite(acc.bootsLv)) p.bootsLv=acc.bootsLv;
  if(Number.isFinite(acc.plank)) p.plank=acc.plank;
  if(Number.isFinite(acc.pickLv)) p.pickLv=acc.pickLv;
  if(Number.isFinite(acc.tut)) p.tut=acc.tut;    // onboarding reward already claimed?
  if(Number.isFinite(acc.lastDaily)) p.lastDaily=acc.lastDaily;
  if(Number.isFinite(acc.dailyStreak)) p.dailyStreak=acc.dailyStreak;
  if(Number.isFinite(acc.airdrop)) p.airdrop=acc.airdrop;             // permanent airdrop points (never reset)
  if(Number.isFinite(acc.verified)) p.verified=acc.verified;          // shared on X → points count toward the contest
  if(Number.isFinite(acc.seasonId)) p.seasonId=acc.seasonId;
  if(Number.isFinite(acc.seasonPts)) p.seasonPts=acc.seasonPts;
  if(season && p.seasonId!==season.no){ p.seasonId=season.no; p.seasonPts=0; } // points from an old season don't carry over
  if(typeof acc.wallet==='string'&&acc.wallet) p.linkedWallet=acc.wallet; // remember the linked wallet (does NOT auto-verify the session)
  p.hp=p.hpMax;                                  // return at full health
  if(Number.isFinite(acc.x)&&Number.isFinite(acc.y)&&walkable(acc.x,acc.y)){ p.x=acc.x; p.y=acc.y; }
}

// ---- enemies (server-simulated, shared) — array name stays `slimes` for protocol parity ----
let slimeId=1; const slimes=[];
function spawnEnemy(type){for(let i=0;i<80;i++){const tx=2+Math.floor(Math.random()*(W-4)),ty=2+Math.floor(Math.random()*(H-4));
  if((tileAt(tx,ty)===T.GRASS||tileAt(tx,ty)===T.FLOWER) && !inSafeZone((tx+0.5)*TILE,(ty+0.5)*TILE)){
    const s={id:slimeId++,type,x:(tx+0.5)*TILE,y:(ty+0.5)*TILE,hp:ENEMY[type].hp,vx:0,vy:0,t:Math.random()*6};
    slimes.push(s);return s;}}return null;}
function spawnSlime(){ spawnEnemy(pickEnemyType()); }
function spawnBoss(){ const s=spawnEnemy('boss');
  if(s) broadcast({t:'chat',name:'⚔️ EVENT',id:0,msg:'A Warlord has risen! Hunt it down for 90 🪙 + big XP.'}); }
for(let i=0;i<10;i++)spawnSlime();
const SLIME_CAP=14;
const bossAlive=()=>slimes.some(s=>s.type==='boss');
function enemyState(s){return {id:s.id,type:s.type,x:Math.round(s.x),y:Math.round(s.y),hp:s.hp,hpMax:ENEMY[s.type].hp};}

// ---- networking ----
// Serve the game client (isle_online.html) over HTTP on the same port as the WebSocket,
// so the whole game is one URL. /health stays as a plain-text liveness check.
const CLIENT_HTML = path.join(__dirname, 'isle_online.html');
const LEADERBOARD_HTML = path.join(__dirname, 'leaderboard.html');   // public, shareable hype page
// brand assets (favicon + social-preview image) served from the marketing kit
const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.js':'text/javascript; charset=utf-8' };
const STATIC = { '/favicon.png':'marketing/favicon.png', '/apple-touch-icon.png':'marketing/apple-touch-icon.png',
  '/og.png':'marketing/keyart.png', '/logo.png':'marketing/logo.png', '/banner.png':'marketing/contest-og.png',
  '/howit.png':'marketing/howit.png',  // clean "how it works" banner for the X thread
  '/s1-connect.png':'marketing/s1-connect.png', '/s2-earn.png':'marketing/s2-earn.png', '/s3-win.png':'marketing/s3-win.png',
  '/prizes.png':'marketing/prizes.png', '/cta.png':'marketing/cta.png',   // X-thread banner set
  '/nacl.min.js':'vendor/nacl.min.js' };  // tweetnacl (box) for the Phantom mobile deeplink flow
const server=http.createServer((req,res)=>{
  const url=(req.url||'/').split('?')[0];
  if(url==='/health'){ res.writeHead(200,{'content-type':'text/plain'}); res.end('Plotlands server OK — players: '+players.size); return; }
  if(url==='/admin/standings'){
    const params=new URL(req.url,'http://x').searchParams;
    if(!ADMIN_KEY || params.get('key')!==ADMIN_KEY){ res.writeHead(404,{'content-type':'text/plain'}); res.end('Not found'); return; } // invisible without the key
    buildSnapshot(params).then(snap=>{
      if(params.get('format')==='csv'){ res.writeHead(200,{'content-type':'text/csv; charset=utf-8','cache-control':'no-store'}); res.end(snapshotCsv(snap)); }
      else { res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(snap,null,2)); }
    }).catch(e=>{ console.error('[standings]',e.message); res.writeHead(500,{'content-type':'text/plain'}); res.end('error'); });
    return;
  }
  if(url==='/'||url==='/index.html'||url==='/isle_online.html'){
    fs.readFile(CLIENT_HTML,(err,buf)=>{
      if(err){ res.writeHead(500,{'content-type':'text/plain'}); res.end('client not found'); return; }
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}); res.end(buf);
    });
    return;
  }
  if(url==='/leaderboard'||url==='/lb'||url==='/win'||url==='/contest'){
    fs.readFile(LEADERBOARD_HTML,(err,buf)=>{
      if(err){ res.writeHead(500,{'content-type':'text/plain'}); res.end('leaderboard not found'); return; }
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}); res.end(buf);
    });
    return;
  }
  if(url==='/api/leaderboard'){
    publicLeaderboard().then(data=>{ res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=10','access-control-allow-origin':'*'}); res.end(JSON.stringify(data)); })
      .catch(e=>{ console.error('[api/leaderboard]',e.message); res.writeHead(500,{'content-type':'text/plain'}); res.end('error'); });
    return;
  }
  if(STATIC[url]){
    fs.readFile(path.join(__dirname, STATIC[url]),(err,buf)=>{
      if(err){ res.writeHead(404,{'content-type':'text/plain'}); res.end('Not found'); return; }
      res.writeHead(200,{'content-type':MIME[path.extname(url)]||'application/octet-stream','cache-control':'public, max-age=86400'}); res.end(buf);
    });
    return;
  }
  res.writeHead(404,{'content-type':'text/plain'}); res.end('Not found');
});
const wss=new WebSocketServer({server});

function send(ws,obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(obj,except){ const s=JSON.stringify(obj); for(const p of players.values()){ if(p.ws!==except && p.ws.readyState===1) p.ws.send(s); } }
function sendInit(p){
  // `tp` makes the client snap to the server's authoritative spawn / restored position
  send(p.ws,{t:'init', id:p.id, self:selfMsg(p,null,{x:Math.round(p.x),y:Math.round(p.y)}),
    walletRequired:WALLET_REQUIRED, walletOk:p.walletOk, wallet:p.wallet, nonce:p.nonce,
    players:playerList(), total:totalUsers, daily:p.guestId?dailyStatus(p):null, nobuild:NOBUILD_TILES, season:seasonMeta(), houseTiers:HOUSE_TIERS, verifyRequired:VERIFY_REQUIRED,
    buildings:world.buildings, chopped:Object.keys(world.chopped), mined:Object.keys(world.mined),
    farms:Object.fromEntries(Object.entries(world.farms).map(([k,f])=>[k,{plantedAt:f.plantedAt}])),
    claims:world.claims,
    slimes:slimes.map(enemyState)});
}

wss.on('connection',(ws,req)=>{
  let me=null, msgs=0, winStart=Date.now(); const ipHash=hashIp(clientIp(req)); // salted; for Sybil review only
  ws.on('message',(buf)=>{
    const now=Date.now(); if(now-winStart>1000){winStart=now;msgs=0;} if(++msgs>MSG_PER_SEC) return; // rate limit
    let m; try{ m=JSON.parse(buf); }catch{ return; }
    if(m.t==='join'){
      if(me) return;
      if(players.size>=MAX_PLAYERS){ send(ws,{t:'full'}); try{ws.close();}catch(e){} return; }
      me=makePlayer(m.name,ws);
      me.guestId = typeof m.guest==='string' ? m.guest.slice(0,64) : null;
      me.ipHash = ipHash;                          // record this session's IP hash (anti-Sybil signal)
      players.set(me.id,me);
      const self=me;
      // load persisted progress (if this guest returned), then send the world snapshot
      (async()=>{
        if(self.guestId){
          try{ const acc=await store.loadAccount(self.guestId);
            if(acc){ applyAccount(self,acc); if(self.linkedWallet){ self.wallet=self.linkedWallet; self.walletOk=true; } } // remembered wallet → auto-unlock (no re-sign on refresh)
            else if(!WALLET_REQUIRED){ store.saveAccount(accountOf(self)); totalUsers++; broadcast({t:'total',n:totalUsers}); } // gate off → old behavior
            else { self.fresh=true; } }                                                 // gate on → count/create only after wallet verify
          catch(e){ console.error('[load account]',e.message); }
        }
        if(self.ws.readyState!==1){ players.delete(self.id); return; } // disconnected mid-load
        self.hurtUntil=Date.now()+SPAWN_PROTECT_MS;   // brief spawn protection
        sendInit(self);
        broadcast({t:'joined', player:publicPlayer(self)}, self.ws);
        console.log('join',self.id,self.name, self.guestId?('guest '+self.guestId.slice(0,8)):'(guest off)', self.walletOk?'(ready)':'(spectator)','players:',players.size);
      })();
    }
    else if(!me){ return; }
    else if(m.t==='wallet'){ handleWallet(me,m); }
    else if(GATED.has(m.t) && !me.walletOk){ return; } // spectator: must connect a wallet to move/act
    else if(m.t==='input'){
      // bounds + walkable + SPEED CLAMP: reject teleports/speedhacks by limiting how far a
      // player may move per input to ~1.4x their legitimate top speed (movement is still
      // client-predicted, but the server now bounds it — closes the obvious cheats).
      if(typeof m.x==='number'&&typeof m.y==='number'){
        const t=Date.now(), dt=Math.min(0.5,Math.max(0.001,(t-(me.lastInputAt||t))/1000)); me.lastInputAt=t;
        let nx=Math.max(0,Math.min(W*TILE,m.x)), ny=Math.max(0,Math.min(H*TILE,m.y));
        const dx=nx-me.x, dy=ny-me.y, dist=Math.hypot(dx,dy), allowed=(BASE_SPD+me.bootsLv*18)*1.4*dt;
        if(dist>allowed && dist>0){ nx=me.x+dx/dist*allowed; ny=me.y+dy/dist*allowed; } // clamp to max speed
        if(walkable(nx,ny)){ me.x=nx; me.y=ny; }
        if(typeof m.dir==='number') me.dir=m.dir|0;
      }
    }
    else if(m.t==='edit'){ handleEdit(me,m); }
    else if(m.t==='attack'){
      const s=slimes.find(s=>s.id===m.id); if(!s) return;
      if(Math.hypot(s.x-me.x,s.y-me.y)>ATTACK_REACH) return;   // must be in melee range
      s.hp-=SWORD_HIT + me.swordLv*6;                          // sword upgrade adds damage
      const a=Math.atan2(s.y-me.y,s.x-me.x); s.vx=Math.cos(a)*180; s.vy=Math.sin(a)*180;
      if(s.hp<=0){ const E=ENEMY[s.type]; slimes.splice(slimes.indexOf(s),1); broadcast({t:'slimeDead',id:s.id,by:me.id});
        me.coin+=E.coin; me.wood+=E.wood||0; me.stone+=E.stone||0; gainXP(me,E.xp);
        pushSelf(me,{txt:'+'+E.coin+' 🪙'+(E.wood?'  +'+E.wood+' 🪵':'')+(E.stone?'  +'+E.stone+' 🪨':''),col:'#f0c64a',x:Math.round(s.x),y:Math.round(s.y)});
        if(s.type==='boss') broadcast({t:'chat',name:'⚔️ EVENT',id:0,msg:me.name+' defeated the Warlord! (+'+E.coin+' 🪙)'}); }
    }
    else if(m.t==='shop'){ handleShop(me,m); }
    else if(m.t==='claim'){ handleClaim(me,m); }
    else if(m.t==='upgradeland'){ handleUpgradeLand(me,m); }
    else if(m.t==='unstuck'){ const p=nearestWalkable(me.x,me.y); me.x=p.x; me.y=p.y;
      pushSelf(me,{txt:'Unstuck!',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-20)},{x:Math.round(me.x),y:Math.round(me.y)}); }
    else if(m.t==='leaderboard'){ sendLeaderboard(me); }
    else if(m.t==='chat'){ const msg=String(m.msg||'').slice(0,120);
      const pay=msg.match(/^\/pay\s+(\d+)/i); if(pay){ handlePay(me,+pay[1]); return; }   // simple peer-to-peer transfer
      const sell=msg.match(/^\/sell\s+(\d+)/i); if(sell){ handleSellLand(me,+sell[1]); return; }  // list the plot you're on
      if(/^\/unsell\b/i.test(msg)){ handleSellLand(me,0); return; }                       // delist
      if(/^\/buy\b/i.test(msg)){ handleBuyLand(me); return; }                             // buy the for-sale plot you're on
      if(msg) broadcast({t:'chat',name:me.name,id:me.id,msg}); }
    else if(m.t==='setname'){ handleSetName(me, m.name); }
    else if(m.t==='tutdone'){ handleTutDone(me); }
    else if(m.t==='claimdaily'){ handleClaimDaily(me); }
    else if(m.t==='fish'){ handleFish(me,m); }
    else if(m.t==='eat'){ handleEat(me); }
    else if(m.t==='verify'){ handleVerify(me); }
    else if(m.t==='craft'){ handleCraft(me,m); }
  });
  ws.on('close',()=>{ if(me){ if(me.guestId){ store.saveAccount(accountOf(me)); dirty.delete(me); } players.delete(me.id); broadcast({t:'left',id:me.id}); console.log('leave',me.id,'players:',players.size); } });
  ws.on('error',()=>{});
});

// ---- Solana wallet login: verify a signed nonce, then link or adopt the account ----
async function handleWallet(me,m){
  const pubkey=String(m.pubkey||'').trim();
  // already linked this session? (use me.wallet, NOT me.walletOk — walletOk is true when the gate is off)
  if(me.wallet){ if(me.wallet===pubkey) send(me.ws,{t:'walletok',pubkey,guest:me.guestId}); return; }
  if(me.walletPending) return;                               // a verify is already in flight
  if(!pubkey || pubkey.length>64 || !Array.isArray(m.sig) || m.sig.length!==64){ send(me.ws,{t:'walletfail',reason:'bad request'}); return; }
  // verify the ed25519 signature over the login nonce (proves they hold the private key). Normally this
  // socket's own nonce; for the Phantom mobile deeplink round-trip we also accept a recently-issued one
  // (the page reloaded mid-flow, so the nonce that was signed belongs to an earlier socket).
  const provided = (typeof m.nonce==='string' && nonceFresh(m.nonce)) ? m.nonce : null;
  const sigNonce = provided || me.nonce;
  let okSig=false;
  try{ const msg=Buffer.from(LOGIN_PREFIX+sigNonce,'utf8'), pk=bs58.decode(pubkey);
    if(pk.length===32) okSig=nacl.sign.detached.verify(new Uint8Array(msg), Uint8Array.from(m.sig), pk);
  }catch(e){ okSig=false; }
  if(!okSig){ send(me.ws,{t:'walletfail',reason:'signature'}); return; }
  if(provided) recentNonces.delete(provided);                // one-time use
  recentNonces.delete(me.nonce);                             // and burn this socket's nonce too
  me.walletPending=true;

  // adopt an account already linked to this wallet (cross-device login); otherwise link the
  // wallet to this player's current guest account (this is how the 600 existing users keep progress).
  let adopted=false;
  try{ const acc = store.loadAccountByWallet ? await store.loadAccountByWallet(pubkey) : null;
    if(acc && acc.guestId){
      if(acc.guestId!==me.guestId){ applyAccount(me,acc); me.guestId=acc.guestId; if(acc.name) me.name=acc.name; broadcast({t:'rename',id:me.id,name:me.name}); }
      adopted=true; }
  }catch(e){ console.error('[wallet lookup]',e.message); }
  me.walletPending=false;                                    // (walletPending already blocks re-entrancy; adopt sets me.wallet)
  if(me.ws.readyState!==1) return;                           // disconnected during the lookup

  if(!me.guestId) me.guestId='w_'+pubkey;                    // safety net if guest mode was off
  me.wallet=pubkey; me.linkedWallet=pubkey; me.walletOk=true;
  if(!adopted && me.fresh){ totalUsers++; broadcast({t:'total',n:totalUsers}); me.fresh=false; } // a brand-new account becomes real now

  store.saveAccount(accountOf(me));
  send(me.ws,{t:'walletok', pubkey, guest:me.guestId});      // hand back the canonical guest id (wallet = source of truth)
  pushSelf(me,{txt:'Wallet linked ✓',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-22)},{x:Math.round(me.x),y:Math.round(me.y)});
  console.log('wallet',me.id,me.name,'→',pubkey.slice(0,8)+'…',adopted?'(adopted)':'(linked)');
}

// ---- authoritative world edits (validate cost / ownership / range, then award) ----
function handleEdit(me,m){
  const x=m.x|0, y=m.y|0, k=x+','+y;
  if(m.kind==='build'){
    const bt=m.bt; if(!['house','fence'].includes(bt)) return;
    if(world.buildings[k]||world.farms[k]) return;                 // tile occupied
    if(world.claims[k]&&world.claims[k].owner!==me.guestId) return; // someone else's land
    const gt=effTile(x,y); if(gt!==T.GRASS&&gt!==T.SAND&&gt!==T.FLOWER) return; // can't build here
    if(inNoBuild((x+0.5)*TILE,(y+0.5)*TILE)) return;               // protected spawn ring
    if(nearPond(x,y)) return;                                      // keep the pond shore clear for fishing
    if(!inReach(me,x,y)) return;
    if(buildingCount(me.guestId)>=MAX_BUILDINGS){                  // anti-grief: per-player cap
      pushSelf(me,{txt:'Build limit ('+MAX_BUILDINGS+')',col:'#ff8080',x:(x+0.5)*TILE,y:(y+0.5)*TILE}); return; }
    if(me.wood<COST[bt]) return;                                   // can't afford
    me.wood-=COST[bt]; world.buildings[k]={type:bt,owner:me.guestId}; store.saveBuilding(k,bt,me.guestId);
    broadcast({t:'edit',kind:'build',x,y,bt});
    gainXP(me,AWARD.buildXp);
    pushSelf(me,{txt:(bt==='house'?'House':'Fence')+' built',col:'#6fd08a',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
  }
  else if(m.kind==='chop'){
    if(effTile(x,y)!==T.FOREST||world.chopped[k]) return;          // must be a standing tree
    if(!inReach(me,x,y)) return;
    world.chopped[k]=Date.now()+TREE_REGROW_MS;
    broadcast({t:'edit',kind:'chop',x,y});
    const gain=AWARD.chopWood + me.axeLv*2;                        // axe upgrade adds wood
    me.wood+=gain; gainXP(me,AWARD.chopXp);
    pushSelf(me,{txt:'+'+gain+' 🪵',col:'#c08a4f',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
  }
  else if(m.kind==='mine'){
    if(effTile(x,y)!==T.STONE||world.mined[k]) return;            // must be un-mined rock
    if(!inReach(me,x,y)) return;
    world.mined[k]=Date.now()+STONE_REGROW_MS;
    broadcast({t:'edit',kind:'mine',x,y});
    const gain=AWARD.mineStone + (me.pickLv||0);                   // a Reinforced Pick mines more
    me.stone+=gain; gainXP(me,AWARD.mineXp);
    pushSelf(me,{txt:'+'+gain+' 🪨',col:'#c3ccd4',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
  }
  else if(m.kind==='farm'){
    if(world.farms[k]||world.buildings[k]) return;
    if(world.claims[k]&&world.claims[k].owner!==me.guestId) return; // someone else's land
    if(effTile(x,y)!==T.GRASS) return;
    if(nearPond(x,y)) return;                                      // keep the pond shore clear
    if(!inReach(me,x,y)) return;
    if(me.wood<COST.farm) return;
    me.wood-=COST.farm; const plantedAt=Date.now(); world.farms[k]={plantedAt}; store.saveFarm(k,plantedAt);
    broadcast({t:'edit',kind:'farm',x,y});
    pushSelf(me,{txt:'Planted',col:'#6fd08a',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
  }
  else if(m.kind==='harvest'){
    const f=world.farms[k]; if(!f) return;
    if(Date.now()-f.plantedAt<FARM_GROW_MS) return;                // not grown yet
    if(!inReach(me,x,y)) return;
    delete world.farms[k]; store.deleteFarm(k);
    broadcast({t:'edit',kind:'harvest',x,y});
    me.coin+=AWARD.harvestCoin; gainXP(me,AWARD.harvestXp);
    pushSelf(me,{txt:'+'+AWARD.harvestCoin+' 🪙',col:'#f0c64a',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
  }
}

// ---- crafting: refine wood→planks, spend planks+stone on a Reinforced Pick (server-authoritative) ----
function handleCraft(me,m){
  if(m.item==='plank'){
    if(me.wood<PLANK_WOOD) return;
    me.wood-=PLANK_WOOD; me.plank=(me.plank||0)+1;
    pushSelf(me,{txt:'+1 📦 plank',col:'#caa46a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='pick'){
    const lv=me.pickLv||0; if(lv>=PICK_MAX) return;
    const pc=pickPlankCost(lv), sc=pickStoneCost(lv);
    if((me.plank||0)<pc || me.stone<sc) return;
    me.plank-=pc; me.stone-=sc; me.pickLv=lv+1;
    pushSelf(me,{txt:'⛏️ Pick Lv'+me.pickLv+'!',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-22)});
  }
}

// ---- fishing: cast at adjacent water for fish, gated by a per-player rod cooldown ----
function handleFish(me,m){
  const x=m.x|0, y=m.y|0, t=tileAt(x,y);
  if(t!==T.WATER && t!==T.SHALLOW) return;                  // must target water
  if(!inReach(me,x,y)) return;                              // stand next to it
  const now=Date.now(); if(now-(me.lastFish||0) < FISH_COOLDOWN_MS) return;  // rod still casting
  me.lastFish=now; me.fish+=1; gainXP(me,AWARD.fishXp);
  pushSelf(me,{txt:'+1 🐟',col:'#7fd0e8',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
}

// ---- eat a fish: restore HP + gain a little XP (a food sink + a survival option) ----
function handleEat(me){
  if(me.fish<=0) return;
  me.fish-=1; me.hp=Math.min(me.hpMax, me.hp+FISH_HEAL); gainXP(me,FISH_EAT_XP);
  pushSelf(me,{txt:'+'+FISH_HEAL+' HP 🍖',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-20)});
}
// ---- verify: the player shared on X → their points now count toward the contest (honor system,
// since X gives no callback). Idempotent; only meaningful while VERIFY_REQUIRED is on. ----
function handleVerify(me){
  if(!me.guestId || me.verified) return;
  me.verified=1; markDirty(me);
  pushSelf(me,{txt:'✓ Verified — your points now count!',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-26)});
}

// ---- claim land: spend a (held, unused) Land Deed to own a tile ----
function handleClaim(me,m){
  if(!me.guestId) return;                                  // need an account to own land
  const x=m.x|0, y=m.y|0, k=x+','+y;
  if(world.claims[k]) return;                              // already owned
  const t=effTile(x,y); if(t===T.WATER||t===T.SHALLOW||t===T.STONE) return; // claim land only
  if(inNoBuild((x+0.5)*TILE,(y+0.5)*TILE)) return;         // can't claim the protected spawn ring
  if(nearPond(x,y)) return;                                // can't claim the pond shore (keep it open)
  if(!inReach(me,x,y)) return;
  if(claimCount(me.guestId) >= me.deeds) return;           // need a spare deed (own ≤ deeds bought)
  world.claims[k]={owner:me.guestId, name:me.name, level:1, price:0};
  store.saveClaim(k, me.guestId, me.name, 1, 0);
  broadcast({t:'claim', x, y, owner:me.guestId, name:me.name, level:1, price:0});
  pushSelf(me,{txt:'Land claimed 📜',col:'#f0c64a',x:(x+0.5)*TILE,y:(y+0.5)*TILE});
}
// upgrade the house on a tile you own → costs coins + a minimum player level, raises its rent
function handleUpgradeLand(me,m){
  if(!me.guestId) return;
  const x=m.x|0, y=m.y|0, k=x+','+y, c=world.claims[k];
  if(!c || c.owner!==me.guestId) return;                   // must own this tile
  if(!inReach(me,x,y)) return;
  const lv=c.level||1; const at=(x+0.5)*TILE, ay=(y+0.5)*TILE;
  if(lv>=MAX_HOUSE_LV){ pushSelf(me,{txt:'🏨 '+houseTier(lv).name+' — max tier!',col:'#f0c64a',x:at,y:ay}); return; }
  const next=HOUSE_TIERS[lv];                              // the tier we'd upgrade INTO (house level lv+1)
  if(me.lv<next.reqLv){ pushSelf(me,{txt:'🔒 '+next.name+' needs Lv'+next.reqLv,col:'#ff8080',x:at,y:ay}); return; }
  if(me.coin<next.cost){ pushSelf(me,{txt:'Need '+next.cost+' 🪙 for '+next.name,col:'#ff8080',x:at,y:ay}); return; }
  me.coin-=next.cost; c.level=lv+1;
  store.saveClaim(k, c.owner, c.name, c.level, c.price||0);
  broadcast({t:'claim', x, y, owner:c.owner, name:c.name, level:c.level, price:c.price||0});
  pushSelf(me,{txt:'🏠 '+next.name+'! (+rent)',col:'#6fd08a',x:at,y:ay});
}

// ---- authoritative merchant (economy must be server-side) ----
function handleShop(me,m){
  if(m.item==='sellwood'){
    if(me.wood<=0) return;
    const c=me.wood*2; me.coin+=c; me.wood=0;
    pushSelf(me,{txt:'+'+c+' 🪙',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='sellstone'){
    if(me.stone<=0) return;
    const c=me.stone*STONE_SELL; me.coin+=c; me.stone=0;
    pushSelf(me,{txt:'+'+c+' 🪙',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='sellfish'){
    if(me.fish<=0) return;
    const c=me.fish*FISH_SELL; me.coin+=c; me.fish=0;
    pushSelf(me,{txt:'+'+c+' 🪙',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='potion'){
    if(me.coin<15||me.hp>=me.hpMax) return;
    me.coin-=15; me.hp=me.hpMax;
    pushSelf(me,{txt:'Healed',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='deed'){
    if(me.coin<50) return;
    me.coin-=50; me.deeds++;
    pushSelf(me,{txt:'🏠 House bought',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-20)});
  }
  else if(m.item==='upg'){
    const u=UPGRADES[m.stat]; if(!u) return;
    const cur=me[u.field]||0; if(cur>=UPG_MAX) return;
    const cost=upgCost(m.stat,cur); if(me.coin<cost) return;
    me.coin-=cost; me[u.field]=cur+1;
    if(m.stat==='vit'){ me.hpMax+=25; me.hp=Math.min(me.hpMax, me.hp+25); } // vitality also heals a bit
    pushSelf(me,{txt:u.label+' Lv'+(cur+1)+'!',col:'#6fd08a',x:Math.round(me.x),y:Math.round(me.y-22)});
  }
}

// ---- onboarding: grant the completion reward ONCE per account (un-farmable; survives a localStorage wipe) ----
function handleTutDone(me){
  if(!me.guestId) return;            // guest progress off → no account to flag, no reward
  if(me.tut) return;                 // already claimed (server is the source of truth)
  me.tut=1; me.coin+=TUTORIAL_REWARD; // pushSelf marks the account dirty → flag + coins persist
  pushSelf(me,{txt:'+'+TUTORIAL_REWARD+' 🪙 Welcome!',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-22)});
}

// ---- daily reward: claimable once per cooldown; a return-streak grows the payout ----
// `nextStreak` = the streak you'd be on if you claimed right now (drives the reward shown/paid).
function dailyStatus(p){
  const now=Date.now(), last=p.lastDaily||0, since=now-last;
  const ready = !last || since>=DAILY_COOLDOWN_MS;
  const nextStreak = !last ? 1 : (since<DAILY_GRACE_MS ? (p.dailyStreak||0)+1 : 1);
  return { ready, streak:p.dailyStreak||0, nextStreak, reward:dailyReward(nextStreak),
    nextInMs: ready?0:Math.max(0,last+DAILY_COOLDOWN_MS-now) };
}
function handleClaimDaily(me){
  if(!me.guestId) return;                          // need an account to track the cooldown
  const st=dailyStatus(me); if(!st.ready) return;  // server enforces the cooldown (no client trust)
  me.dailyStreak=st.nextStreak; me.lastDaily=Date.now(); me.coin+=st.reward;
  pushSelf(me,{txt:'+'+st.reward+' 🪙 Daily'+(st.nextStreak>1?(' · Day '+st.nextStreak):'')+'!',col:'#9fe0b0',x:Math.round(me.x),y:Math.round(me.y-26)});
  send(me.ws,{t:'daily',...dailyStatus(me)});      // push refreshed (now not-ready) status
}

// ---- leaderboard: rank everyone (online live stats override their saved snapshot) ----
function leaderScore(r){ return r.coin + r.plots*150 + (r.lv-1)*100; }
async function computeLeaderboard(limit){
  const map=new Map();
  for(const a of await store.allAccounts()) map.set(a.guestId,{name:a.name||'Player',lv:a.lv||1,coin:a.coin||0});
  for(const p of players.values()) if(p.guestId) map.set(p.guestId,{name:p.name,lv:p.lv,coin:p.coin}); // live wins
  const plots={}; for(const k in world.claims){ const o=world.claims[k].owner; plots[o]=(plots[o]||0)+1; }
  const rows=[]; for(const [gid,r] of map) rows.push({name:r.name, lv:r.lv, coin:r.coin, plots:plots[gid]||0});
  for(const r of rows) r.score=leaderScore(r);
  rows.sort((a,b)=>b.score-a.score);
  return rows.slice(0, limit||10);
}
// ---- seasonal standings: rank everyone by season points (live stats override the saved snapshot) ----
async function computeSeasonStandings(limit){
  const map=new Map();
  for(const a of await store.allAccounts()){
    const pts=(season && a.seasonId===season.no)?(a.seasonPts||0):0;
    map.set(a.guestId,{name:a.name||'Player',lv:a.lv||1,pts,wallet:a.wallet||null,verified:a.verified||0});
  }
  for(const p of players.values()) if(p.guestId) map.set(p.guestId,{name:p.name,lv:p.lv,pts:effSeasonPts(p),wallet:p.wallet||p.linkedWallet||null,verified:p.verified||0}); // live wins
  const rows=[]; for(const [gid,r] of map){ if(!contestEligible(r)) continue; rows.push({guestId:gid,name:r.name,lv:r.lv,pts:r.pts,wallet:r.wallet,verified:r.verified}); } // only verified count when on
  rows.sort((a,b)=>b.pts-a.pts);
  return rows.slice(0, limit||10);
}
function sendLeaderboard(me){
  Promise.all([computeLeaderboard(10), computeSeasonStandings(10)]).then(([rows,srows])=>{
    let rank=0; for(let i=0;i<srows.length;i++) if(srows[i].guestId===me.guestId){ rank=i+1; break; }
    send(me.ws,{t:'leaderboard', rows, season:{ ...seasonMeta(),
      you:{ pts:effSeasonPts(me), airdrop:me.airdrop||0, rank, verified:me.verified||0 },
      rows:srows.map(r=>({name:r.name, pts:r.pts, lv:r.lv, verified:!!r.verified})) }});
  }).catch(e=>console.error('[leaderboard]',e.message));
}

// ---- contest snapshot: the full, ranked standings for a real-money payout (admin-only export) ----
// Includes wallet, season points, raffle tickets, and soft anti-cheat flags (shared IP, outlier).
async function standingsRows(){
  const map=new Map();
  for(const a of await store.allAccounts()){
    const pts=(season && a.seasonId===season.no)?(a.seasonPts||0):0;
    map.set(a.guestId,{name:a.name||'Player',lv:a.lv||1,pts,airdrop:a.airdrop||0,wallet:a.wallet||null,ipHash:a.ipHash||null,verified:a.verified||0});
  }
  for(const p of players.values()) if(p.guestId) map.set(p.guestId,{name:p.name,lv:p.lv,pts:effSeasonPts(p),airdrop:p.airdrop||0,wallet:p.wallet||p.linkedWallet||null,ipHash:p.ipHash||null,verified:p.verified||0}); // live wins
  return [...map.values()].sort((a,b)=>b.pts-a.pts);
}
// turn raw rows into a ranked snapshot with raffle tickets + soft anti-cheat flags
function decorate(all){
  const ipCount={}; for(const r of all) if(r.ipHash) ipCount[r.ipHash]=(ipCount[r.ipHash]||0)+1; // Sybil cluster sizes
  const ref = all.length ? all[Math.min(all.length-1,9)].pts : 0;                                // ~10th-place score (outlier yardstick)
  let eligibleCount=0, totalTickets=0;
  const standings=all.map((r,i)=>{ const tickets=raffleTickets(r.pts); const elig=tickets>0 && contestEligible(r); if(elig){ eligibleCount++; totalTickets+=tickets; }
    const flags={}; if(r.ipHash && ipCount[r.ipHash]>1) flags.sharedIp=ipCount[r.ipHash]; if(ref>0 && r.pts>ref*4) flags.outlier=true; if(VERIFY_REQUIRED && !r.verified) flags.unverified=true;
    const row={ rank:i+1, name:r.name, wallet:r.wallet, lv:r.lv, seasonPts:r.pts, airdrop:r.airdrop, tickets, eligible:elig, verified:!!r.verified };
    if(Object.keys(flags).length) row.flags=flags; return row; });
  return { standings, eligibleCount, totalTickets };
}
async function buildSnapshot(params){
  let snap;
  if(params && params.get('final')){                              // ?final=1 → the FROZEN standings saved at the contest deadline (survives reset + restarts)
    snap = await store.loadMeta('finalStandings');
    if(!snap) snap = { error:'no frozen final standings yet — the contest season has not ended' };
  }
  if(!snap){
    const d = decorate(await standingsRows());
    snap = { generatedAt:new Date().toISOString(),
      season: season?{ no:season.no, start:season.start, end:season.end, endsInMs:Math.max(0,season.end-Date.now()), ended:Date.now()>=season.end }:null,
      raffle:{ minPts:RAFFLE_MIN_PTS, ptsPerTicket:RAFFLE_PTS_PER_TICKET, maxTickets:RAFFLE_MAX_TICKETS, eligibleCount:d.eligibleCount, totalTickets:d.totalTickets },
      totalPlayers: d.standings.length, standings: d.standings };
  }
  // optional provably-fair draw: ?raffle=SEED&raffleWinners=N → deterministic, ticket-weighted, no repeats
  const seed=params&&params.get('raffle'), n=params?+(params.get('raffleWinners')||0):0;
  if(seed && n>0 && Array.isArray(snap.standings)){ snap.raffle=snap.raffle||{}; snap.raffle.seed=seed; snap.raffle.winners=drawRaffle(snap.standings, seed, n); }
  return snap;
}
// deterministic, ticket-weighted raffle (winners need a wallet to be paid). Same seed ⇒ same winners.
function drawRaffle(standings, seed, n){
  const pool=standings.filter(r=>r.eligible && r.wallet); const used=new Set(); const winners=[];
  for(let k=0; winners.length<n && used.size<pool.length; k++){
    let total=0; for(const r of pool) if(!used.has(r.wallet)) total+=r.tickets; if(total<=0) break;
    const h=crypto.createHash('sha256').update(seed+'|'+k).digest('hex');
    let roll=parseInt(h.slice(0,12),16)%total;
    for(const r of pool){ if(used.has(r.wallet)) continue; roll-=r.tickets; if(roll<0){ winners.push({draw:winners.length+1,name:r.name,wallet:r.wallet,seasonPts:r.seasonPts,tickets:r.tickets}); used.add(r.wallet); break; } }
  }
  return winners;
}
function snapshotCsv(snap){
  const esc=v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const head=['rank','name','wallet','lv','seasonPts','airdrop','tickets','verified','eligible','flags'];
  const lines=[head.join(',')];
  for(const r of snap.standings) lines.push([r.rank,esc(r.name),r.wallet||'',r.lv,r.seasonPts,r.airdrop,r.tickets,r.verified?1:0,r.eligible,esc(r.flags?JSON.stringify(r.flags):'')].join(','));
  return lines.join('\n')+'\n';
}
// ---- public leaderboard payload (cached, NO wallets / IPs / flags — safe to expose to anyone) ----
async function publicLeaderboard(){
  const now=Date.now();
  if(_lbCache && now-_lbCacheAt<LEADERBOARD_CACHE_MS) return _lbCache;
  const all=await standingsRows();
  let eligibleCount=0, totalTickets=0; for(const r of all){ const t=raffleTickets(r.pts); if(t>0 && contestEligible(r)){ eligibleCount++; totalTickets+=t; } }
  // when "verify to compete" is on, the public board only shows verified racers (their points count)
  const top=all.filter(r=>r.pts>0 && contestEligible(r)).slice(0,100).map((r,i)=>{ const t=raffleTickets(r.pts);
    return { rank:i+1, name:r.name, lv:r.lv, seasonPts:r.pts, tickets:t, eligible:t>0, wallet:r.wallet||null, verified:!!r.verified }; }); // public: wallet shown (on-chain anyway); NO ip/flags
  _lbCache={ updatedAt:new Date(now).toISOString(),
    season: season?{ no:season.no, endsAt:season.end, ended:now>=season.end }:null,
    contest: CONTEST, verifyRequired: VERIFY_REQUIRED,
    raffle:{ minPts:RAFFLE_MIN_PTS, ptsPerTicket:RAFFLE_PTS_PER_TICKET, maxTickets:RAFFLE_MAX_TICKETS, eligibleCount, totalTickets },
    totalRacers: top.length, top };
  _lbCacheAt=now; return _lbCache;
}
// ---- season rollover: award airdrop points to the top finishers, then start a fresh season ----
// Player progress is NEVER reset — only the season points (the race) reset; airdrop points accumulate forever.
async function creditAirdrop(guestId, pts){
  if(!guestId||!(pts>0)) return;
  const online=[...players.values()].find(p=>p.guestId===guestId);
  if(online){ online.airdrop=(online.airdrop||0)+pts; markDirty(online);
    pushSelf(online,{txt:'🎖 +'+pts+' airdrop!',col:'#ffd75e',x:Math.round(online.x),y:Math.round(online.y-26)}); return; }
  try{ const acc=await store.loadAccount(guestId); if(!acc) return;
    acc.airdrop=(acc.airdrop||0)+pts; store.saveAccount(acc);                 // offline winner: persist straight to the account
  }catch(e){ console.error('[creditAirdrop]',e.message); }
}
let seasonRolling=false;
async function endSeason(){
  if(!season||seasonRolling) return; seasonRolling=true;
  try{
    // freeze the full final standings BEFORE points reset, so a contest payout survives the rollover + restarts
    try{ const fin=await buildSnapshot(new URLSearchParams()); fin.seasonNo=season.no;
      if(fin.standings && fin.standings.some(r=>r.seasonPts>0)) store.saveMeta('finalStandings', fin); // skip empty rollovers
    }catch(e){ console.error('[finalStandings]',e.message); }
    const standings=await computeSeasonStandings(AIRDROP_REWARDS.length);
    const winners=[];                                                          // top finishers with any activity
    for(let i=0;i<standings.length;i++){ const w=standings[i], reward=AIRDROP_REWARDS[i]||0;
      if(reward>0 && w.pts>0) winners.push({guestId:w.guestId, name:w.name, pts:w.pts, airdrop:reward}); }
    const ended=season.no, nextStart=season.end;
    season={ no:ended+1, start:nextStart, end:nextStart+SEASON_MS,
      last:{ no:ended, winners:winners.map(w=>({name:w.name, pts:w.pts, airdrop:w.airdrop})) } };
    for(const p of players.values()){ p.seasonId=season.no; p.seasonPts=0; }   // online players start the new season at 0
    store.saveMeta('season', season);
    for(const w of winners) await creditAirdrop(w.guestId, w.airdrop);         // pay out (online → single self push w/ reset pts + airdrop)
    if(winners.length){ const tops=winners.map((w,i)=>(['🥇','🥈','🥉'][i]||(i+1)+'.')+' '+w.name+' (+'+w.airdrop+'🎖)').join('   ');
      broadcast({t:'chat',name:'🏆 SEASON',id:0,msg:'Season '+ended+' ended! Champions: '+tops}); }
    else broadcast({t:'chat',name:'🏆 SEASON',id:0,msg:'Season '+season.no+' has begun — race for the airdrop 🎖!'});
    broadcast({t:'season', ...seasonMeta()});
    for(const p of players.values()) pushSelf(p);                              // reflect the reset season points to everyone
    console.log('[season]',ended,'→',season.no,'winners:',winners.map(w=>w.name+':'+w.airdrop).join(',')||'(none)');
  }catch(e){ console.error('[endSeason]',e.message); }
  finally{ seasonRolling=false; }
}

// ---- simple peer transfer: /pay <amount> gives coins to the nearest player ----
function handlePay(me,amount){
  amount=Math.floor(amount); if(!(amount>0)||me.coin<amount) return;
  let near=null,nd=1e9; for(const p of players.values()){ if(p===me)continue; const d=Math.hypot(p.x-me.x,p.y-me.y); if(d<nd){nd=d;near=p;} }
  if(!near||nd>TILE*4){ send(me.ws,{t:'chat',name:'💸',id:0,msg:'Stand next to someone to /pay them.'}); return; }
  me.coin-=amount; near.coin+=amount;
  pushSelf(me,{txt:'-'+amount+' 🪙',col:'#ff8080',x:Math.round(me.x),y:Math.round(me.y-20)});
  pushSelf(near,{txt:'+'+amount+' 🪙',col:'#9fe0b0',x:Math.round(near.x),y:Math.round(near.y-20)});
  broadcast({t:'chat',name:'💸',id:0,msg:me.name+' paid '+amount+' 🪙 to '+near.name});
}

// ---- player land market: list a plot you own (/sell), buy a listed plot you're on/next to (/buy) ----
// Operates on the nearest matching plot under OR adjacent to the player — forgiving of exact
// footing (you don't have to be pixel-perfectly centred on the tile).
function plotNear(me, match){
  const ptx=Math.floor(me.x/TILE), pty=Math.floor(me.y/TILE);
  let best=null, bd=1e9;
  for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){ const tx=ptx+dx, ty=pty+dy, c=world.claims[tx+','+ty];
    if(c && match(c)){ const d=Math.hypot((tx+0.5)*TILE-me.x,(ty+0.5)*TILE-me.y); if(d<bd){ bd=d; best={tx,ty,k:tx+','+ty,c}; } } }
  return best;
}
function sysTo(me,msg){ send(me.ws,{t:'chat',name:'🏷️',id:0,msg}); }
function handleSellLand(me, price){
  if(!me.guestId) return;
  const p = plotNear(me, c=>c.owner===me.guestId);
  if(!p){ sysTo(me,'Stand on a plot you own to /sell it.'); return; }
  const { tx, ty, k, c } = p;
  price=Math.max(0,Math.min(1000000,Math.floor(price||0)));
  c.price=price; store.saveClaim(k, c.owner, c.name, c.level||1, price);
  broadcast({t:'claim', x:tx, y:ty, owner:c.owner, name:c.name, level:c.level||1, price});
  sysTo(me, price>0 ? ('Listed your plot for '+price+' 🪙 — anyone can stand on it and /buy.') : 'Your plot is no longer for sale.');
}
function handleBuyLand(me){
  if(!me.guestId){ sysTo(me,'Guest progress is off — can\'t buy land.'); return; }
  const p = plotNear(me, c=>c.price>0 && c.owner!==me.guestId);
  if(!p){ sysTo(me,'Stand on a plot that is for sale to /buy it.'); return; }
  const { tx, ty, k, c } = p;
  const price=c.price; if(me.coin<price){ sysTo(me,'Need '+price+' 🪙 to buy this plot.'); return; }
  const sellerGuest=c.owner, level=c.level||1;
  // transfer synchronously so a second /buy sees no listing (no double-sell); the deed moves with the plot
  me.coin-=price; me.deeds++; c.owner=me.guestId; c.name=me.name; c.price=0;
  store.saveClaim(k, c.owner, c.name, level, 0);
  broadcast({t:'claim', x:tx, y:ty, owner:c.owner, name:c.name, level, price:0});
  pushSelf(me,{txt:'-'+price+' 🪙 — plot bought 📜',col:'#f0c64a',x:Math.round(me.x),y:Math.round(me.y-22)});
  broadcast({t:'chat',name:'🏷️ LAND',id:0,msg:me.name+' bought a plot for '+price+' 🪙.'});
  creditSeller(sellerGuest, price);
}
// pay the seller their coins and remove the deed that moved with the plot — works whether they're online or not
function creditSeller(guestId, coins){
  const online=[...players.values()].find(p=>p.guestId===guestId);
  if(online){ online.coin+=coins; online.deeds=Math.max(0,online.deeds-1); markDirty(online);
    pushSelf(online,{txt:'+'+coins+' 🪙 — plot sold',col:'#9fe0b0',x:Math.round(online.x),y:Math.round(online.y-22)}); return; }
  store.loadAccount(guestId).then(acc=>{ if(!acc) return;
    acc.coin=(acc.coin||0)+coins; acc.deeds=Math.max(0,(acc.deeds||0)-1); store.saveAccount(acc);
  }).catch(e=>console.error('[creditSeller]',e.message));
}

// ---- tick: regrow trees, move slimes, resolve combat damage, broadcast ----
let lastTick=Date.now();
setInterval(()=>{
  const now=Date.now(), dt=Math.min(0.1,(now-lastTick)/1000); lastTick=now;
  // tree regrow
  for(const k in world.chopped){ if(now>=world.chopped[k]){ delete world.chopped[k]; broadcast({t:'edit',kind:'regrow',x:+k.split(',')[0],y:+k.split(',')[1]}); } }
  for(const k in world.mined){ if(now>=world.mined[k]){ delete world.mined[k]; broadcast({t:'edit',kind:'mineregrow',x:+k.split(',')[0],y:+k.split(',')[1]}); } }
  // enemies: seek nearest player within their aggro radius, else wander (per-type speed)
  const plist=[...players.values()];
  for(const s of slimes){ const E=ENEMY[s.type]; s.t+=dt; let ax,ay;
    let near=null,nd=1e9; for(const p of plist){const d=Math.hypot(p.x-s.x,p.y-s.y);if(d<nd){nd=d;near=p;}}
    // chase only players outside the safe hub; otherwise wander
    if(near&&nd<TILE*E.aggro&&nd>0.1&&!inSafeZone(near.x,near.y)){ ax=(near.x-s.x)/nd; ay=(near.y-s.y)/nd; }
    else{ ax=Math.cos(s.t*0.8); ay=Math.sin(s.t*0.6); }
    s.vx+=ax*E.accel*dt; s.vy+=ay*E.accel*dt; s.vx*=E.fric; s.vy*=E.fric;
    const nx=s.x+s.vx*dt, ny=s.y+s.vy*dt; if(walkable(nx,s.y))s.x=nx; if(walkable(s.x,ny))s.y=ny;
  }
  if(slimes.filter(s=>s.type!=='boss').length<SLIME_CAP && Math.random()<0.04) spawnSlime();
  // contact damage: an enemy touching a player (past i-frames, outside the safe hub) deals damage
  for(const p of plist){
    if(now<p.hurtUntil || inSafeZone(p.x,p.y)) continue;
    for(const s of slimes){ const E=ENEMY[s.type];
      if(Math.hypot(p.x-s.x,p.y-s.y)<E.r+13){
        p.hp-=E.dmg; p.hurtUntil=now+HURT_CD_MS; p.lastHitAt=now;
        if(p.hp<=0){ // faint → respawn at the safe hub with protection + small coin penalty
          p.hp=p.hpMax; p.coin=Math.max(0,p.coin-DEATH_COIN_PENALTY);
          const sp=spawnPoint(); p.x=sp.x; p.y=sp.y; p.hurtUntil=now+SPAWN_PROTECT_MS;
          pushSelf(p,{txt:'You fainted',col:'#ff8080',x:Math.round(p.x),y:Math.round(p.y-22)},{x:Math.round(p.x),y:Math.round(p.y)});
        } else {
          pushSelf(p,{txt:'-'+E.dmg,col:'#ff8080',x:Math.round(p.x),y:Math.round(p.y-20)});
        }
        break; // one hit per player per tick
      }
    }
  }
  // out-of-combat HP regen
  for(const p of plist){
    if(p.hp<p.hpMax && now-p.lastHitAt>REGEN_DELAY_MS){
      p._regen=(p._regen||0)+REGEN_PER_SEC*dt;
      if(p._regen>=1){ const add=Math.floor(p._regen); p._regen-=add; p.hp=Math.min(p.hpMax,p.hp+add); pushSelf(p); }
    }
  }
  // state broadcast (public fields only)
  broadcast({t:'state', players:playerList(), slimes:slimes.map(enemyState)});
},TICK);

// ---- passive land income: owned plots pay their owner over time ----
const t0=setInterval(()=>{
  for(const p of players.values()){ if(!p.guestId) continue; const pay=ownerRent(p.guestId);
    if(pay>0){ p.coin+=pay;
      pushSelf(p,{txt:'+'+pay+' 🪙 rent',col:'#9fe0b0',x:Math.round(p.x),y:Math.round(p.y-26)}); } }
},LAND_INCOME_MS); if(t0.unref)t0.unref();

// ---- world events: keep a boss roaming while people are playing ----
const tb=setInterval(()=>{ if(players.size>0 && !bossAlive()) spawnBoss(); },BOSS_INTERVAL_MS); if(tb.unref)tb.unref();
// a periodic HORDE: a coordinated surge of tougher monsters to fight off together (shared moment + loot)
const HORDE_INTERVAL_MS = +process.env.HORDE_INTERVAL_MS || 210000;
function spawnHorde(){ const mix=['wisp','brute','golem','brute','wisp','golem']; let n=0;
  for(const t of mix){ if(spawnEnemy(t)) n++; }
  if(n>0) broadcast({t:'chat',name:'👹 EVENT',id:0,msg:'A horde of '+n+' monsters is rising! Hunt them down for loot 🪨🪙.'}); }
const thd=setInterval(()=>{ if(players.size>0) spawnHorde(); },HORDE_INTERVAL_MS); if(thd.unref)thd.unref();
// season rollover: end the season once its clock runs out (runs even with nobody online)
const tsn=setInterval(()=>{ if(season && Date.now()>=season.end) endSeason(); },SEASON_CHECK_MS); if(tsn.unref)tsn.unref();
// cache the number of players "in" the contest (verified+scoring) for the in-game contest banner
async function recomputeRacers(){ try{ const all=await standingsRows(); _racers=all.filter(r=>r.pts>0 && contestEligible(r)).length; }catch(e){} }
const trc=setInterval(recomputeRacers, 30000); if(trc.unref)trc.unref();

// ---- persistence: periodic saves + graceful shutdown ----
function saveDirty(){ for(const p of dirty) store.saveAccount(accountOf(p)); dirty.clear(); }
function saveAll(){ for(const p of players.values()) if(p.guestId) store.saveAccount(accountOf(p)); dirty.clear(); }
const t1=setInterval(saveDirty,SAVE_DIRTY_MS); if(t1.unref)t1.unref();
const t2=setInterval(()=>{ saveAll(); store.flush().catch(()=>{}); },SAVE_ALL_MS); if(t2.unref)t2.unref();
let shuttingDown=false;
async function shutdown(){ if(shuttingDown)return; shuttingDown=true;
  try{ saveAll(); await store.close(); }catch(e){ console.error('[shutdown]',e.message); }
  process.exit(0); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);

// ---- boot: load persisted world, then start listening ----
(async()=>{
  try{ await store.init(); const w=await store.loadWorld();
    Object.assign(world.buildings,w.buildings); Object.assign(world.farms,w.farms); Object.assign(world.claims,w.claims||{});
    // drop builds/claims/farms stranded on non-land tiles (e.g. after a map resize) OR on a pond
    // shore, so the world stays tidy and fishing spots are actually open
    const onWater=k=>{const [x,y]=k.split(',').map(Number),t=tileAt(x,y);return t===T.WATER||t===T.SHALLOW||t===T.STONE||nearPond(x,y);};
    let pruned=0;
    for(const k in world.buildings) if(onWater(k)){ delete world.buildings[k]; store.deleteBuilding(k); pruned++; }
    for(const k in world.farms)     if(onWater(k)){ delete world.farms[k];     store.deleteFarm(k); }
    for(const k in world.claims)    if(onWater(k)){ delete world.claims[k];    store.deleteClaim(k); }
    if(pruned) console.log('pruned',pruned,'off-land buildings after map change');
    totalUsers=(await store.allAccounts()).length;
    console.log('store:',store.constructor.name,'— loaded',Object.keys(world.buildings).length,'buildings,',Object.keys(world.farms).length,'farms,',Object.keys(world.claims).length,'claims,',totalUsers,'accounts');
    // season: load or start, then settle any season(s) that ended while the server was down
    season = await store.loadMeta('season');
    if(!season || !Number.isFinite(season.no) || !Number.isFinite(season.end)){
      const now=Date.now(); season={ no:1, start:now, end:now+SEASON_MS, last:null }; store.saveMeta('season',season); }
    const pin=parseSeasonEnd();                                   // SEASON_END set → pin the contest deadline
    if(pin && pin>Date.now() && season.end!==pin){ season.end=pin; store.saveMeta('season',season); console.log('[season] contest end pinned to',new Date(pin).toISOString()); }
    for(let g=0; season && Date.now()>=season.end && g<10000; g++) await endSeason();
    console.log('[season] active:',season.no,'ends',new Date(season.end).toISOString());
    recomputeRacers();
  }catch(e){ console.error('[store init]',e.message); }
  server.listen(PORT,()=>console.log('Plotlands server listening on :'+PORT));
})();
