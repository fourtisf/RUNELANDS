// Plotlands — "verify to compete" tests (VERIFY_REQUIRED).
// Proves: points still accrue while unverified but DON'T count toward the contest (excluded from the
// in-game board, the public board, and raffle eligibility); sharing on X (→ verify) makes them count.
//   run:  node test/verify.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { findTiles, Bot, ok, passCount, sleep, startServer, killServers, waitHealthy } = require('./harness');

function httpGet(port, p){ return new Promise((res, rej)=>{ http.get({ host:'localhost', port, path:p }, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({ status:r.statusCode, body:d })); }).on('error', rej); }); }
async function chopFor(bot, pts, T){ await bot.moveTo(T.treeStand.x, T.treeStand.y);
  for(let i=0;i<240 && bot.self.seasonPts<pts;i++){ bot.send({ t:'edit', kind:'chop', x:T.tree.x, y:T.tree.y }); await sleep(105); }
  await bot.waitUntil(p => p.self.seasonPts>=pts, 4000, 'reached '+pts+' pts'); }

async function main(){
  const T = findTiles();
  const PORT = 2627, URL = 'ws://localhost:' + PORT, KEY = 'verify-key';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-verify-'));
  startServer({ port: PORT, dataDir: dir, env: { VERIFY_REQUIRED:'1', SEASON_END:'2099-01-01T00:00:00Z', ADMIN_KEY: KEY,
    TREE_REGROW_MS:'150', SPAWN_PROTECT_MS:'200', RAFFLE_MIN_PTS:'10', RAFFLE_PTS_PER_TICKET:'10', RAFFLE_MAX_TICKETS:'5', LEADERBOARD_CACHE_MS:'50' } });
  await waitHealthy(URL);

  console.log('\n[1] verify is required; a new player starts unverified');
  const a = new Bot('Nia', URL); const init = await a.connect({ guest:'g-verify-a' });
  ok(init.verifyRequired === true, 'init says verify is required');
  ok(a.self.verified === 0, 'new player starts unverified');

  console.log('\n[2] points accrue but DO NOT count until verified');
  await chopFor(a, 30, T);
  ok(a.self.seasonPts >= 30, 'points still accrue while unverified (' + a.self.seasonPts + ')');
  a.send({ t:'leaderboard' });
  const lb1 = await a.waitFor(m => m.t==='leaderboard', 3000, 'leaderboard #1');
  ok(!lb1.season.rows.some(r => r.name==='Nia'), 'unverified player is NOT on the contest board');
  ok(lb1.season.you.verified === 0 && lb1.season.you.rank === 0, 'your own status shows unverified + no rank');
  const pub1 = JSON.parse((await httpGet(PORT, '/api/leaderboard')).body);
  ok(pub1.verifyRequired === true && !pub1.top.some(r => r.name==='Nia'), 'public board excludes unverified players');
  const snap1 = JSON.parse((await httpGet(PORT, '/admin/standings?key=' + KEY)).body);
  const u = snap1.standings.find(r => r.name==='Nia');
  ok(u && u.verified === false && u.eligible === false, 'admin snapshot lists them but NOT eligible');

  console.log('\n[3] sharing → verified → the same points now count');
  a.send({ t:'verify' });
  await a.waitUntil(p => p.self.verified === 1, 3000, 'verified');
  ok(a.self.verified === 1, 'player is verified after sharing');
  a.send({ t:'leaderboard' });
  const lb2 = await a.waitFor(m => m.t==='leaderboard', 3000, 'leaderboard #2');
  ok(lb2.season.rows.some(r => r.name==='Nia' && r.verified === true), 'verified player now appears on the board with ✓');
  ok(lb2.season.you.verified === 1, 'your own status shows verified');
  await sleep(90); // let the public cache (50ms) expire
  const pub2 = JSON.parse((await httpGet(PORT, '/api/leaderboard')).body);
  ok(pub2.top.some(r => r.name==='Nia' && r.verified === true), 'public board now includes the verified player');

  a.close(); await sleep(120); killServers();
  try { fs.rmSync(dir, { recursive:true, force:true }); } catch(e){}
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' VERIFY CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
