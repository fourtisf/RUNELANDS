// Plotlands — seasonal leaderboard + wallet-bound airdrop tests.
// Verifies: season points accrue from activity, the leaderboard exposes a season block + ranking,
// `self` carries seasonPts/airdrop, and a season rollover pays the airdrop to the top finisher,
// resets the race (NOT player progress), and announces the result.
//   run:  node test/season.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, killServers, waitHealthy } = require('./harness');

const FAST = { TREE_REGROW_MS:'200', SPAWN_PROTECT_MS:'200' };

async function main(){
  const T = findTiles();

  // ===== phase 1: a long season — accrual, ranking, self fields, leaderboard season block =====
  const PORT1 = 2620, URL1 = 'ws://localhost:' + PORT1;
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(),'isle-season1-'));
  const srv1 = startServer({ port: PORT1, dataDir: d1, env: { ...FAST, SEASON_MS:'60000' } });
  await waitHealthy(URL1);

  console.log('\n[1] new players start a season at 0 pts / 0 airdrop, and `self` exposes both');
  const a = new Bot('Ana', URL1); await a.connect({ guest:'g-a' });
  const b = new Bot('Bo',  URL1); await b.connect({ guest:'g-b' });
  ok(a.initMsg.season && a.initMsg.season.no >= 1, 'init carries season meta (no, endsAt, rewards)');
  ok(Array.isArray(a.initMsg.season.rewards) && a.initMsg.season.rewards.length >= 1, 'init advertises airdrop reward tiers');
  ok(typeof a.self.seasonPts === 'number' && typeof a.self.airdrop === 'number', 'self exposes seasonPts + airdrop');
  ok(a.self.seasonPts === 0 && a.self.airdrop === 0, 'starts at 0 season pts and 0 airdrop');

  console.log('\n[2] activity earns season points');
  await a.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(a, 16, T.tree);                                   // chopping awards XP → season pts
  await a.waitUntil(p => p.self.seasonPts > 0, 4000, 'Ana gained season pts');
  ok(a.self.seasonPts > 0, 'chopping awarded season points (' + a.self.seasonPts + ')');
  ok(a.self.airdrop === 0, 'airdrop stays 0 until a season actually ends');

  console.log('\n[3] the leaderboard carries a season block, ranked by points');
  a.send({ t:'leaderboard' });
  const lb = await a.waitFor(m => m.t==='leaderboard', 3000, 'leaderboard reply');
  ok(lb.season && Array.isArray(lb.season.rows), 'reply includes a season standings block');
  ok(Array.isArray(lb.rows), 'all-time wealth rows are still present (backward compatible)');
  const names = lb.season.rows.map(r => r.name);
  ok(names.includes('Ana') && names.includes('Bo'), 'both racers appear in the season standings');
  ok(names.indexOf('Ana') < names.indexOf('Bo'), 'Ana (more activity) ranks above idle Bo');
  ok(lb.season.rows[0].name === 'Ana' && lb.season.rows[0].pts > 0, 'Ana leads the season with >0 pts');
  ok(lb.season.you && lb.season.you.pts === a.self.seasonPts, 'season block reports your own pts + airdrop');
  ok(Array.isArray(lb.season.shareMe) && lb.season.shareMe.length >= 2 && /\{name\}/.test(lb.season.shareMe.join(' ')), 'season block carries multiple personalised share templates');
  ok(lb.season.shareMe.every(v => /#Plotlands/i.test(v)), 'every personalised share variant includes #Plotlands');
  ok('active' in lb.season && typeof lb.season.title === 'string' && typeof lb.season.racers === 'number', 'season block carries contest-banner fields (active/title/racers)');

  a.close(); b.close(); await sleep(150); srv1.kill(); await sleep(200);

  // ===== phase 2: a tiny season — rollover pays the airdrop, resets the race, announces winners =====
  const PORT2 = 2621, URL2 = 'ws://localhost:' + PORT2;
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(),'isle-season2-'));
  const srv2 = startServer({ port: PORT2, dataDir: d2, env: { ...FAST, SEASON_MS:'2500', SEASON_CHECK_MS:'200', SEASON_REWARDS:'50,30,10' } });
  await waitHealthy(URL2);

  console.log('\n[4] a season rollover pays the airdrop to the champion');
  const c = new Bot('Cy', URL2); await c.connect({ guest:'g-c' });
  await c.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(c, 9, T.tree);                                    // earn a few points, then idle
  await c.waitUntil(p => p.self.seasonPts > 0, 4000, 'Cy gained season pts');
  const ptsBefore = c.self.seasonPts, coinBefore = c.self.coin, lvBefore = c.self.lv;
  ok(ptsBefore > 0, 'Cy earned season pts before the rollover (' + ptsBefore + ')');

  await c.waitUntil(p => p.self.airdrop > 0, 7000, 'season rolled over + airdrop credited');
  ok(c.self.airdrop === 50, 'the champion received the 1st-place airdrop (50 🎖)');

  console.log('\n[5] the new season resets the race but NOT player progress');
  await c.waitUntil(p => p.self.seasonPts === 0, 3000, 'season points reset for the new season');
  ok(c.self.seasonPts === 0, 'season points reset to 0 (was ' + ptsBefore + ')');
  ok(c.self.coin === coinBefore && c.self.lv === lvBefore, 'coin + level are untouched by the rollover');

  console.log('\n[6] the rollover is announced and advances the season');
  ok(c.events.some(m => m.t==='chat' && /SEASON/i.test(m.name||'')), 'a chat event announced the season result');
  ok(c.events.some(m => m.t==='season' && m.no >= 2), 'a season message advanced to the next season');
  const seasonMsg = c.events.filter(m => m.t==='season').pop();
  ok(seasonMsg.last && seasonMsg.last.winners && seasonMsg.last.winners[0].name === 'Cy', 'last-season winners list names the champion');

  c.close(); await sleep(150); srv2.kill();
  try { fs.rmSync(d1, { recursive:true, force:true }); fs.rmSync(d2, { recursive:true, force:true }); } catch(e){}
  killServers();
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' SEASON CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
