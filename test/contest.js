// RUNELANDS — contest tooling tests: admin standings export, raffle tickets + provably-fair draw,
// a pinned contest deadline (SEASON_END), and the shared-IP (Sybil) flag.
//   run:  node test/contest.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { findTiles, Bot, ok, passCount, sleep, startServer, killServers, waitHealthy } = require('./harness');

const PREFIX = 'Sign in to RUNELANDS\nWallet login — nonce: ';
function signWallet(kp, nonce){ const sig = nacl.sign.detached(new Uint8Array(Buffer.from(PREFIX + nonce, 'utf8')), kp.secretKey); return { pubkey: bs58.encode(kp.publicKey), sig: Array.from(sig) }; }
function httpGet(port, p){ return new Promise((res, rej)=>{ http.get({ host:'localhost', port, path:p }, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({ status:r.statusCode, body:d })); }).on('error', rej); }); }
const adminPath = (key, extra='') => '/admin/standings?key=' + encodeURIComponent(key) + extra;
// earn at least `pts` season points by chopping (chopXp = 8 season pts per chop)
async function chopFor(bot, pts, T){ await bot.moveTo(T.treeStand.x, T.treeStand.y);
  for(let i=0;i<240 && bot.self.seasonPts<pts;i++){ bot.send({ t:'edit', kind:'chop', x:T.tree.x, y:T.tree.y }); await sleep(105); }
  await bot.waitUntil(p => p.self.seasonPts>=pts, 4000, 'reached '+pts+' season pts'); }

async function main(){
  const T = findTiles();
  const PORT = 2624, URL = 'ws://localhost:' + PORT;
  const KEY = 's3cret-admin-key', SEASON_END = '2999-01-01T00:00:00.000Z';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-contest-'));
  startServer({ port: PORT, dataDir: dir, env: { TREE_REGROW_MS:'150', SPAWN_PROTECT_MS:'200',
    ADMIN_KEY: KEY, SEASON_END, RAFFLE_MIN_PTS:'10', RAFFLE_PTS_PER_TICKET:'10', RAFFLE_MAX_TICKETS:'5',
    CONTEST_TITLE:'$1000 Showdown', CONTEST_PRIZE:'$1000', LEADERBOARD_CACHE_MS:'50' } });
  await waitHealthy(URL);

  console.log('\n[1] the contest season is pinned to SEASON_END');
  const a = new Bot('Ace', URL); const initA = await a.connect({ guest:'g-contest-a' });
  ok(initA.season && initA.season.endsAt === Date.parse(SEASON_END), 'season end pinned to the contest deadline');

  console.log('\n[2] /admin/standings is gated by ADMIN_KEY (invisible without it)');
  ok((await httpGet(PORT,'/admin/standings')).status === 404, 'no key → 404');
  ok((await httpGet(PORT, adminPath('wrong'))).status === 404, 'wrong key → 404');
  ok((await httpGet(PORT, adminPath(KEY))).status === 200, 'correct key → 200');

  console.log('\n[3] standings export: ranked, wallet-tagged, with raffle tickets');
  const w = signWallet(nacl.sign.keyPair(), initA.nonce); a.send({ t:'wallet', pubkey:w.pubkey, sig:w.sig });
  await a.waitFor(m => m.t==='walletok', 4000, 'walletok');
  await chopFor(a, 30, T);                                   // ≥30 pts → 3 tickets (10 pts/ticket)
  const b = new Bot('Bee', URL); await b.connect({ guest:'g-contest-b' }); // 2nd acct, same IP, NO wallet
  await chopFor(b, 10, T);

  const snap = JSON.parse((await httpGet(PORT, adminPath(KEY))).body);
  ok(snap.season.end === Date.parse(SEASON_END), 'snapshot reports the pinned contest end');
  const rowA = snap.standings.find(r => r.name==='Ace');
  ok(rowA && rowA.seasonPts >= 30, 'Ace appears with their season points');
  ok(rowA.wallet === w.pubkey, 'Ace row carries the linked wallet (for payout)');
  ok(rowA.tickets >= 3 && rowA.eligible === true, 'Ace is raffle-eligible with the right ticket count');
  ok(snap.raffle.eligibleCount >= 1 && snap.raffle.totalTickets >= 3, 'raffle totals are reported');
  ok(snap.standings[0].seasonPts >= snap.standings[snap.standings.length-1].seasonPts, 'standings are ranked by points');

  console.log('\n[4] same-IP accounts are flagged for Sybil review');
  const flagged = snap.standings.filter(r => r.flags && r.flags.sharedIp >= 2);
  ok(flagged.length >= 2, 'two accounts from one IP are flagged (sharedIp)');

  console.log('\n[5] provably-fair raffle draw (deterministic, wallet-only winners)');
  const d1 = JSON.parse((await httpGet(PORT, adminPath(KEY,'&raffle=blockhash-123&raffleWinners=1'))).body);
  const d2 = JSON.parse((await httpGet(PORT, adminPath(KEY,'&raffle=blockhash-123&raffleWinners=1'))).body);
  ok(d1.raffle.winners && d1.raffle.winners.length === 1, 'a winner was drawn');
  ok(d1.raffle.winners[0].wallet === w.pubkey, 'only a wallet-linked entrant can win (Bee has no wallet)');
  ok(JSON.stringify(d1.raffle.winners) === JSON.stringify(d2.raffle.winners), 'same seed ⇒ identical winners');

  console.log('\n[6] CSV export');
  const csv = (await httpGet(PORT, adminPath(KEY,'&format=csv'))).body;
  ok(/^rank,name,wallet,/.test(csv) && /Ace/.test(csv), 'CSV has a header row + players');

  console.log('\n[PUBLIC] /api/leaderboard (wallet shown, no ip/flags) + page + share buttons');
  const apiRes = await httpGet(PORT, '/api/leaderboard');               // NO key required (public)
  ok(apiRes.status === 200, '/api/leaderboard is public (200, no key)');
  const pub = JSON.parse(apiRes.body);
  const pubAce = pub.top.find(r => r.name==='Ace');
  ok(pubAce && pubAce.seasonPts>=30 && pubAce.tickets>=3, 'public board shows ranked points + raffle tickets');
  ok(pubAce.wallet === w.pubkey, 'public board shows the wallet (owner opted in)');
  ok(pubAce.flags === undefined && pubAce.ipHash === undefined && !/ipHash|sharedIp/.test(apiRes.body), 'public board still hides IPs + anti-cheat flags');
  ok(pub.contest && pub.contest.active===true && pub.contest.prize==='$1000', 'contest framing (title/prize) is exposed');
  const st = Array.isArray(pub.contest.shareText) ? pub.contest.shareText.join(' ') : pub.contest.shareText;
  ok(Array.isArray(pub.contest.shareText) && pub.contest.shareText.length >= 2 && !/\$1000\s*\$1000/.test(st) && /@runelandsfun/.test(st), 'public share copy: multiple clean variants tagging @runelandsfun');
  ok(pub.contest.shareText.every(v => /#RUNELANDS/i.test(v)), 'every public share variant includes #RUNELANDS');
  ok(pub.season && pub.season.endsAt===Date.parse(SEASON_END), 'public board carries the season countdown');
  const page = await httpGet(PORT, '/leaderboard');
  ok(page.status === 200 && /RUNELANDS/i.test(page.body) && /api\/leaderboard/.test(page.body), '/leaderboard serves the hype page');
  ok(/id="shX"/.test(page.body) && /twitter\.com\/intent|t\.me\/share/.test(page.body), 'page has X / Telegram share buttons');
  ok(/solscan\.io\/account/.test(page.body), 'page links wallets to a chain explorer');
  a.close(); b.close(); await sleep(150);

  console.log('\n[7] without ADMIN_KEY the export is disabled');
  const PORT2 = 2625, URL2 = 'ws://localhost:' + PORT2;
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(),'isle-contest2-'));
  startServer({ port: PORT2, dataDir: dir2, env: { SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL2);
  ok((await httpGet(PORT2,'/admin/standings?key=anything')).status === 404, 'export disabled when ADMIN_KEY is unset');

  console.log('\n[8] points freeze at the deadline; final standings survive the reset');
  const PORT3 = 2626, URL3 = 'ws://localhost:' + PORT3;
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(),'isle-contest3-'));
  startServer({ port: PORT3, dataDir: dir3, env: { TREE_REGROW_MS:'150', SPAWN_PROTECT_MS:'200',
    ADMIN_KEY: KEY, SEASON_END: String(Date.now()+3500), SEASON_CHECK_MS:'200',
    RAFFLE_MIN_PTS:'10', RAFFLE_PTS_PER_TICKET:'10', RAFFLE_MAX_TICKETS:'5' } });
  await waitHealthy(URL3);
  const c = new Bot('Cid', URL3); await c.connect({ guest:'g-contest-c' });
  await chopFor(c, 16, T);                                  // earn before the deadline
  ok(c.self.seasonPts >= 16, 'Cid earned points before the deadline (' + c.self.seasonPts + ')');
  await c.waitUntil(p => p.self.seasonPts === 0, 6000, 'season rolled over (points reset)');
  ok(c.self.seasonPts === 0, 'live season points reset after the deadline');
  const liveC = (JSON.parse((await httpGet(PORT3, adminPath(KEY))).body).standings).find(r => r.name==='Cid');
  ok(!liveC || liveC.seasonPts === 0, 'live snapshot reflects the reset (new season)');
  const finalC = (JSON.parse((await httpGet(PORT3, adminPath(KEY,'&final=1'))).body).standings).find(r => r.name==='Cid');
  ok(finalC && finalC.seasonPts >= 16, 'frozen final standings preserved the points (' + (finalC && finalC.seasonPts) + ')');
  c.close(); await sleep(150);

  try { fs.rmSync(dir, { recursive:true, force:true }); fs.rmSync(dir2, { recursive:true, force:true }); fs.rmSync(dir3, { recursive:true, force:true }); } catch(e){}
  killServers();
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' CONTEST CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
