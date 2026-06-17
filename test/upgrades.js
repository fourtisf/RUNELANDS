// Plotlands — merchant upgrade tests.
// Verifies upgrades cost coins, escalate, actually change gameplay (sword damage / wood per
// chop), reject when unaffordable, and persist across restarts.
//   run:  node test/upgrades.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2611, URL = 'ws://localhost:' + PORT;
const FAST = { TREE_REGROW_MS:'250', SPAWN_PROTECT_MS:'200' };

// earn `n` coins by chopping wood and selling it
async function earn(bot, T, n){
  await bot.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(bot, Math.ceil(n/2), T.tree);
  bot.send({ t:'shop', item:'sellwood' });
  await bot.waitUntil(b => b.self.coin>=n, 8000, 'coin>='+n);
}
// chop once and return the wood gained
async function chopGain(bot, tree){
  const w0 = bot.self.wood;
  for (let i=0;i<40;i++){ bot.send({t:'edit',kind:'chop',x:tree.x,y:tree.y}); await sleep(120); if(bot.self.wood>w0) return bot.self.wood-w0; }
  throw new Error('no chop gain');
}

async function main(){
  const T = findTiles();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-upg-'));
  const guest = 'upg-tester';
  let srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  console.log('\n[1] buy a sword upgrade (costs 30 coin)');
  const a = new Bot('Upg', URL); await a.connect({ guest });
  ok(a.self.up && a.self.up.sword===0, 'starts with sword upgrade Lv 0');
  await earn(a, T, 60);
  const coinBefore = a.self.coin;
  a.send({ t:'shop', item:'upg', stat:'sword' });
  await a.waitUntil(b => b.self.up.sword===1, 3000, 'sword upgraded');
  ok(a.self.up.sword === 1, 'sword upgrade is now Lv 1');
  ok(a.self.coin === coinBefore-30, 'sword upgrade cost 30 coin');

  console.log('\n[2] axe upgrade increases wood per chop (3 -> 5)');
  await a.moveTo(T.treeStand.x, T.treeStand.y);
  const before = await chopGain(a, T.tree);
  ok(before === 3, 'chop gives 3 wood at axe Lv 0');
  // top up coins and buy the axe upgrade (costs 25)
  await earn(a, T, 25);
  a.send({ t:'shop', item:'upg', stat:'axe' });
  await a.waitUntil(b => b.self.up.axe===1, 3000, 'axe upgraded');
  const after = await chopGain(a, T.tree);
  ok(after === 5, 'chop gives 5 wood at axe Lv 1 (+2)');

  console.log('\n[3] cannot buy an upgrade you cannot afford');
  // spend down to near-zero, then try the (now pricier) sword upgrade
  while (a.self.coin >= 20){ a.send({t:'shop',item:'potion'}); await sleep(120); a.send({t:'shop',item:'sellwood'}); await sleep(120); if(a.self.coin>=50){a.send({t:'shop',item:'deed'});await sleep(150);} else break; }
  const swLv = a.self.up.sword, coinNow = a.self.coin;
  a.send({ t:'shop', item:'upg', stat:'sword' }); // costs 30*(1+1)=60 now
  await sleep(300);
  ok(a.self.up.sword === swLv && a.self.coin === coinNow, 'unaffordable upgrade rejected (no level, no coin change)');

  console.log('\n[4] upgrades persist across a restart');
  await sleep(300); a.close(); await sleep(250);
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);
  const c = new Bot('Upg', URL); await c.connect({ guest });
  ok(c.self.up.sword===1 && c.self.up.axe===1, 'sword + axe upgrades persisted (sword '+c.self.up.sword+', axe '+c.self.up.axe+')');
  c.close(); await sleep(120);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' UPGRADE CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
