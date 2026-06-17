// Plotlands — persistence layer.
//
// Two interchangeable backends behind one interface so server.js stays storage-agnostic:
//   • FileStore  (default, zero-config): atomic JSON snapshot under DATA_DIR. Runs anywhere,
//     great for local dev / a single VPS / this prototype. Writes are debounced + atomic
//     (temp file + rename) so a crash mid-write can't corrupt the save.
//   • PostgresStore (when DATABASE_URL is set): durable, concurrent-safe storage via `pg`.
//     `pg` is lazy-required so the file backend never needs it installed.
//
// Persisted state:
//   world    — buildings { "x,y": {type} } and farms { "x,y": {plantedAt} }
//   accounts — keyed by a client-held guest id: name, progression, balances, position
//
// (Transient things — chopped-tree timers, slimes, live HP-in-combat — are intentionally
//  not persisted; trees simply stand again after a restart.)

const fs = require('fs');
const path = require('path');

// `tut` (0/1) = onboarding completion-reward claimed. `lastDaily` (ms) + `dailyStreak` = daily-reward state.
// `seasonPts`/`seasonId` = ranking points for the CURRENT season (reset each season via seasonId). `airdrop` = permanent, wallet-bound reward points (never reset).
const ACCOUNT_FIELDS = ['name','lv','xp','xpMax','wood','stone','fish','plank','coin','deeds','hp','hpMax','x','y','swordLv','axeLv','vitLv','bootsLv','pickLv','tut','lastDaily','dailyStreak','wallet','seasonPts','seasonId','airdrop','ipHash','verified'];

function createStore(opts = {}) {
  if (opts.databaseUrl || process.env.DATABASE_URL) return new PostgresStore(opts);
  return new FileStore(opts);
}

// ---------------------------------------------------------------------------
// FileStore — in-memory mirror flushed atomically to DATA_DIR/world.json
// ---------------------------------------------------------------------------
class FileStore {
  constructor(opts = {}) {
    this.dir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
    this.file = path.join(this.dir, 'world.json');
    this.flushMs = opts.flushMs != null ? opts.flushMs : 800;
    this.data = { buildings: {}, farms: {}, accounts: {}, claims: {}, meta: {} };
    this._timer = null;
    this._flushing = null;
  }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { buildings: raw.buildings || {}, farms: raw.farms || {}, accounts: raw.accounts || {}, claims: raw.claims || {}, meta: raw.meta || {} };
    } catch (e) { /* no save yet — start empty */ }
    return this;
  }
  async loadWorld() {
    // deep-ish copy so callers can mutate their own working state freely
    const buildings = {}, farms = {}, claims = {};
    for (const k in this.data.buildings) buildings[k] = { type: this.data.buildings[k].type, owner: this.data.buildings[k].owner };
    for (const k in this.data.farms) farms[k] = { plantedAt: this.data.farms[k].plantedAt };
    for (const k in this.data.claims) claims[k] = { owner: this.data.claims[k].owner, name: this.data.claims[k].name, level: this.data.claims[k].level || 1, price: this.data.claims[k].price || 0 };
    return { buildings, farms, claims };
  }
  saveBuilding(k, type, owner) { this.data.buildings[k] = { type, owner }; this._schedule(); }
  deleteBuilding(k) { delete this.data.buildings[k]; this._schedule(); }
  saveFarm(k, plantedAt) { this.data.farms[k] = { plantedAt }; this._schedule(); }
  deleteFarm(k) { delete this.data.farms[k]; this._schedule(); }
  saveClaim(k, owner, name, level, price) { this.data.claims[k] = { owner, name, level: level || 1, price: price || 0 }; this._schedule(); }
  deleteClaim(k) { delete this.data.claims[k]; this._schedule(); }
  async loadAccount(guestId) {
    const a = this.data.accounts[guestId];
    return a ? { guestId, ...a } : null;
  }
  async loadAccountByWallet(pubkey) {
    if (!pubkey) return null;
    for (const [guestId, a] of Object.entries(this.data.accounts)) if (a.wallet === pubkey) return { guestId, ...a };
    return null;
  }
  async allAccounts() { return Object.entries(this.data.accounts).map(([guestId, a]) => ({ guestId, name: a.name, lv: a.lv, coin: a.coin, seasonPts: a.seasonPts || 0, seasonId: a.seasonId || 0, airdrop: a.airdrop || 0, wallet: a.wallet || null, ipHash: a.ipHash || null, verified: a.verified || 0 })); }
  async loadMeta(key) { return (this.data.meta && this.data.meta[key]) || null; }
  saveMeta(key, val) { if (!this.data.meta) this.data.meta = {}; this.data.meta[key] = val; this._schedule(); }
  async nameTaken(name, exceptGuest) { const n = (name || '').toLowerCase(); for (const [gid, a] of Object.entries(this.data.accounts)) { if (gid === exceptGuest) continue; if ((a.name || '').toLowerCase() === n) return true; } return false; }
  saveAccount(acc) {
    if (!acc || !acc.guestId) return;
    const row = {};
    for (const f of ACCOUNT_FIELDS) if (acc[f] !== undefined) row[f] = acc[f];
    this.data.accounts[acc.guestId] = row;
    this._schedule();
  }
  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.flushMs);
    if (this._timer.unref) this._timer.unref();
  }
  async flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const tmp = this.file + '.tmp';
    const json = JSON.stringify(this.data);
    await fs.promises.writeFile(tmp, json);
    await fs.promises.rename(tmp, this.file); // atomic replace
  }
  async close() { await this.flush(); }
}

// ---------------------------------------------------------------------------
// PostgresStore — durable backend (used when DATABASE_URL is set)
// ---------------------------------------------------------------------------
class PostgresStore {
  constructor(opts = {}) {
    const { Pool } = require('pg'); // lazy: only needed for this backend
    this.pool = new Pool({ connectionString: opts.databaseUrl || process.env.DATABASE_URL });
  }
  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        guest_id TEXT PRIMARY KEY,
        name TEXT, lv INT, xp INT, xp_max INT,
        wood INT, stone INT DEFAULT 0, fish INT DEFAULT 0, plank INT DEFAULT 0, coin INT, deeds INT,
        hp INT, hp_max INT, x REAL, y REAL,
        sword_lv INT DEFAULT 0, axe_lv INT DEFAULT 0, vit_lv INT DEFAULT 0, boots_lv INT DEFAULT 0, pick_lv INT DEFAULT 0,
        tut INT DEFAULT 0,                  -- onboarding completion-reward claimed (once per account)
        last_daily BIGINT DEFAULT 0,        -- ms timestamp of last daily-reward claim
        daily_streak INT DEFAULT 0,         -- consecutive-day daily-reward streak
        wallet_pubkey TEXT,                 -- reserved for the on-chain step (guest stays NULL)
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sword_lv INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS axe_lv INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS vit_lv INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS boots_lv INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tut INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_daily BIGINT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS daily_streak INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stone INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fish INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plank INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pick_lv INT DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wallet_pubkey TEXT;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS season_pts INT DEFAULT 0;  -- ranking points for the current season
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS season_id INT DEFAULT 0;   -- which season those points belong to (stale → counts as 0)
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS airdrop INT DEFAULT 0;     -- permanent, wallet-bound reward points (never reset)
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ip_hash TEXT;              -- salted hash of last connection IP (Sybil/multi-account signal)
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verified INT DEFAULT 0;     -- shared on X → points count toward the contest
      CREATE INDEX IF NOT EXISTS idx_accounts_wallet ON accounts(wallet_pubkey);
      CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT );          -- small global key/value store (season state)
      CREATE TABLE IF NOT EXISTS world_buildings ( k TEXT PRIMARY KEY, type TEXT NOT NULL, owner TEXT );
      CREATE TABLE IF NOT EXISTS world_farms ( k TEXT PRIMARY KEY, planted_at BIGINT NOT NULL );
      CREATE TABLE IF NOT EXISTS world_claims ( k TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT, level INT DEFAULT 1, price INT DEFAULT 0 );
      ALTER TABLE world_claims ADD COLUMN IF NOT EXISTS level INT DEFAULT 1;
      ALTER TABLE world_claims ADD COLUMN IF NOT EXISTS price INT DEFAULT 0;
      ALTER TABLE world_buildings ADD COLUMN IF NOT EXISTS owner TEXT;
    `);
    return this;
  }
  async loadWorld() {
    const b = await this.pool.query('SELECT k, type, owner FROM world_buildings');
    const f = await this.pool.query('SELECT k, planted_at FROM world_farms');
    const c = await this.pool.query('SELECT k, owner, name, level, price FROM world_claims');
    const buildings = {}, farms = {}, claims = {};
    for (const r of b.rows) buildings[r.k] = { type: r.type, owner: r.owner };
    for (const r of f.rows) farms[r.k] = { plantedAt: Number(r.planted_at) };
    for (const r of c.rows) claims[r.k] = { owner: r.owner, name: r.name, level: r.level || 1, price: r.price || 0 };
    return { buildings, farms, claims };
  }
  saveBuilding(k, type, owner) {
    this._fire('INSERT INTO world_buildings(k,type,owner) VALUES($1,$2,$3) ON CONFLICT(k) DO UPDATE SET type=excluded.type, owner=excluded.owner', [k, type, owner||null]);
  }
  deleteBuilding(k) { this._fire('DELETE FROM world_buildings WHERE k=$1', [k]); }
  saveFarm(k, plantedAt) {
    this._fire('INSERT INTO world_farms(k,planted_at) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET planted_at=excluded.planted_at', [k, plantedAt]);
  }
  deleteFarm(k) { this._fire('DELETE FROM world_farms WHERE k=$1', [k]); }
  saveClaim(k, owner, name, level, price) {
    this._fire('INSERT INTO world_claims(k,owner,name,level,price) VALUES($1,$2,$3,$4,$5) ON CONFLICT(k) DO UPDATE SET owner=excluded.owner, name=excluded.name, level=excluded.level, price=excluded.price', [k, owner, name, level || 1, price || 0]);
  }
  deleteClaim(k) { this._fire('DELETE FROM world_claims WHERE k=$1', [k]); }
  _acc(row) {
    return { guestId: row.guest_id, name: row.name, lv: row.lv, xp: row.xp, xpMax: row.xp_max,
      wood: row.wood, stone: row.stone, fish: row.fish, plank: row.plank, coin: row.coin, deeds: row.deeds, hp: row.hp, hpMax: row.hp_max, x: row.x, y: row.y,
      swordLv: row.sword_lv, axeLv: row.axe_lv, vitLv: row.vit_lv, bootsLv: row.boots_lv, pickLv: row.pick_lv, tut: row.tut,
      lastDaily: Number(row.last_daily), dailyStreak: row.daily_streak, wallet: row.wallet_pubkey,
      seasonPts: row.season_pts || 0, seasonId: row.season_id || 0, airdrop: row.airdrop || 0, ipHash: row.ip_hash || null, verified: row.verified || 0 };
  }
  async loadAccount(guestId) {
    const r = await this.pool.query('SELECT * FROM accounts WHERE guest_id=$1', [guestId]);
    return r.rows.length ? this._acc(r.rows[0]) : null;
  }
  async loadAccountByWallet(pubkey) {
    if (!pubkey) return null;
    const r = await this.pool.query('SELECT * FROM accounts WHERE wallet_pubkey=$1 LIMIT 1', [pubkey]);
    return r.rows.length ? this._acc(r.rows[0]) : null;
  }
  async allAccounts() {
    const r = await this.pool.query('SELECT guest_id, name, lv, coin, season_pts, season_id, airdrop, wallet_pubkey, ip_hash, verified FROM accounts ORDER BY coin DESC LIMIT 5000');
    return r.rows.map(x => ({ guestId: x.guest_id, name: x.name, lv: x.lv, coin: x.coin, seasonPts: x.season_pts || 0, seasonId: x.season_id || 0, airdrop: x.airdrop || 0, wallet: x.wallet_pubkey || null, ipHash: x.ip_hash || null, verified: x.verified || 0 }));
  }
  async loadMeta(key) {
    const r = await this.pool.query('SELECT v FROM meta WHERE k=$1', [key]);
    if (!r.rows.length) return null;
    try { return JSON.parse(r.rows[0].v); } catch (e) { return null; }
  }
  saveMeta(key, val) {
    this._fire('INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [key, JSON.stringify(val)]);
  }
  async nameTaken(name, exceptGuest) {
    const r = await this.pool.query('SELECT 1 FROM accounts WHERE lower(name)=lower($1) AND guest_id <> $2 LIMIT 1', [name, exceptGuest || '']);
    return r.rows.length > 0;
  }
  saveAccount(acc) {
    if (!acc || !acc.guestId) return;
    this._fire(`INSERT INTO accounts(guest_id,name,lv,xp,xp_max,wood,coin,deeds,hp,hp_max,x,y,sword_lv,axe_lv,vit_lv,boots_lv,tut,last_daily,daily_streak,stone,fish,plank,pick_lv,wallet_pubkey,season_pts,season_id,airdrop,ip_hash,verified,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,now())
       ON CONFLICT(guest_id) DO UPDATE SET
         name=excluded.name, lv=excluded.lv, xp=excluded.xp, xp_max=excluded.xp_max,
         wood=excluded.wood, coin=excluded.coin, deeds=excluded.deeds,
         hp=excluded.hp, hp_max=excluded.hp_max, x=excluded.x, y=excluded.y,
         sword_lv=excluded.sword_lv, axe_lv=excluded.axe_lv, vit_lv=excluded.vit_lv, boots_lv=excluded.boots_lv,
         tut=excluded.tut, last_daily=excluded.last_daily, daily_streak=excluded.daily_streak, stone=excluded.stone, fish=excluded.fish,
         plank=excluded.plank, pick_lv=excluded.pick_lv,
         wallet_pubkey=COALESCE(excluded.wallet_pubkey, accounts.wallet_pubkey),
         season_pts=excluded.season_pts, season_id=excluded.season_id, airdrop=excluded.airdrop,
         ip_hash=COALESCE(excluded.ip_hash, accounts.ip_hash), verified=excluded.verified, updated_at=now()`,
      [acc.guestId, acc.name, acc.lv, acc.xp, acc.xpMax, acc.wood, acc.coin, acc.deeds, acc.hp, acc.hpMax, acc.x, acc.y,
       acc.swordLv||0, acc.axeLv||0, acc.vitLv||0, acc.bootsLv||0, acc.tut||0, acc.lastDaily||0, acc.dailyStreak||0, acc.stone||0, acc.fish||0, acc.plank||0, acc.pickLv||0, acc.wallet||null,
       acc.seasonPts||0, acc.seasonId||0, acc.airdrop||0, acc.ipHash||null, acc.verified||0]);
  }
  // Fire-and-forget write with error logging; the game loop never awaits a DB write.
  _fire(sql, params) { this.pool.query(sql, params).catch(e => console.error('[pg]', e.message)); }
  async flush() { /* writes are issued immediately; nothing buffered */ }
  async close() { await this.pool.end(); }
}

module.exports = { createStore, FileStore, PostgresStore, ACCOUNT_FIELDS };
