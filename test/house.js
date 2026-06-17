// RUNELANDS — house tier / upgrade-gate tests.
// Verifies: the server sends a house-tier table, upgrading a claimed plot's house requires BOTH a
// minimum player level (blocked below it, even with coins) AND the tier's coin cost, and that a
// house upgrades through the named tiers when both are satisfied.
//   run:  node test/house.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, startServer, killServers, waitHealthy } = require('./harness');

const FAST = { TREE_REGROW_MS:'150', SPAWN_PROTECT_MS:'200', LAND_INCOME_MS:'999999' }; // slow rent → exact coin checks

// chop + sell until the bot has at least `target` coins (stays near the safe hub, so no combat noise)
async function earnCoin(bot, target, T){
  await bot.moveTo(T.treeStand.x, T.treeStand.y);
  for(let i=0;i<240 && bot.self.coin<target;i++){
    bot.send({ t:'edit', kind:'chop', x:T.tree.x, y:T.tree.y }); await sleep(105);
    if(bot.self.wood>=6){ bot.send({ t:'shop', item:'sellwood' }); await sleep(70); }
  }
  if(bot.self.coin<target) throw new Error('could not earn '+target+' coin (have '+bot.self.coin+')');
}
// earn 50, buy a deed, then claim the test plot (ends standing next to the plot)
async function claimPlot(bot, T){
  await earnCoin(bot, 50, T);
  bot.send({ t:'shop', item:'deed' });
  await bot.waitUntil(b => b.self.deeds>=1, 4000, 'deed bought');
  await bot.moveTo(T.grassStand.x, T.grassStand.y);
  bot.send({ t:'claim', x:T.grassBuild.x, y:T.grassBuild.y });
  await bot.waitFor(m => m.t==='claim' && m.x===T.grassBuild.x && m.y===T.grassBuild.y, 4000, 'claim broadcast');
}

async function main(){
  const T = findTiles();

  // ===== phase A: the player-level gate BLOCKS an upgrade even when coins suffice =====
  const PA = 2622, URLA = 'ws://localhost:' + PA;
  const dA = fs.mkdtempSync(path.join(os.tmpdir(),'isle-house-a-'));
  const tiersA = JSON.stringify([{name:'Camp',cost:0,reqLv:1},{name:'House',cost:10,reqLv:99}]);
  const srvA = startServer({ port: PA, dataDir: dA, env: { ...FAST, HOUSE_TIERS_JSON: tiersA } });
  await waitHealthy(URLA);

  console.log('\n[1] the server advertises a house-tier table');
  const a = new Bot('Bob', URLA); const initA = await a.connect({ guest:'g-house-a' });
  ok(Array.isArray(initA.houseTiers) && initA.houseTiers.length >= 2, 'init carries the house-tier table');
  ok(initA.houseTiers[1].name==='House' && initA.houseTiers[1].reqLv===99, 'tier table reflects the configured level gate');

  console.log('\n[2] upgrading is blocked below the required player level (even with coins)');
  await claimPlot(a, T);
  await earnCoin(a, 30, T);                                  // plenty for the 10🪙 upgrade
  await a.moveTo(T.grassStand.x, T.grassStand.y);
  const lvA = a.self.lv, coinA = a.self.coin;
  ok(lvA < 99 && coinA >= 10, 'Bob can afford the upgrade but is far below the required level (Lv'+lvA+')');
  a.send({ t:'upgradeland', x:T.grassBuild.x, y:T.grassBuild.y });
  await sleep(500);
  ok(!a.events.some(m => m.t==='claim' && m.x===T.grassBuild.x && m.y===T.grassBuild.y && m.level>=2), 'upgrade was rejected below the level gate');
  ok(a.self.coin === coinA, 'no coins were spent on the blocked upgrade');
  a.close(); await sleep(150); srvA.kill(); await sleep(200);

  // ===== phase B: with level + coins satisfied, the house upgrades through tiers =====
  const PB = 2623, URLB = 'ws://localhost:' + PB;
  const dB = fs.mkdtempSync(path.join(os.tmpdir(),'isle-house-b-'));
  const tiersB = JSON.stringify([{name:'Camp',cost:0,reqLv:1},{name:'House',cost:10,reqLv:1},{name:'Villa',cost:20,reqLv:1}]);
  const srvB = startServer({ port: PB, dataDir: dB, env: { ...FAST, HOUSE_TIERS_JSON: tiersB } });
  await waitHealthy(URLB);

  console.log('\n[3] a claimed house upgrades to the next tier when level + coins suffice');
  const b = new Bot('Ana', URLB); await b.connect({ guest:'g-house-b' });
  await claimPlot(b, T);
  await earnCoin(b, 40, T);
  await b.moveTo(T.grassStand.x, T.grassStand.y);
  const coin1 = b.self.coin;
  b.send({ t:'upgradeland', x:T.grassBuild.x, y:T.grassBuild.y });
  await b.waitFor(m => m.t==='claim' && m.x===T.grassBuild.x && m.y===T.grassBuild.y && m.level===2, 4000, 'house → tier 2');
  ok(true, 'house upgraded to House (tier 2)');
  await b.waitUntil(p => p.self.coin === coin1-10, 2500, 'tier-2 cost deducted');
  ok(b.self.coin === coin1-10, 'House cost (10🪙) was deducted');

  console.log('\n[4] houses upgrade through the named tiers (→ Villa)');
  const coin2 = b.self.coin;
  b.send({ t:'upgradeland', x:T.grassBuild.x, y:T.grassBuild.y });
  await b.waitFor(m => m.t==='claim' && m.x===T.grassBuild.x && m.y===T.grassBuild.y && m.level===3, 4000, 'house → tier 3');
  ok(true, 'house upgraded again to Villa (tier 3)');
  await b.waitUntil(p => p.self.coin === coin2-20, 2500, 'tier-3 cost deducted');
  ok(b.self.coin === coin2-20, 'Villa cost (20🪙) was deducted');

  b.close(); await sleep(150); srvB.kill();
  try { fs.rmSync(dA, { recursive:true, force:true }); fs.rmSync(dB, { recursive:true, force:true }); } catch(e){}
  killServers();
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' HOUSE-TIER CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
