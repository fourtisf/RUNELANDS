// Plotlands — land ownership tests.
// Verifies the "land is useful" feature: claiming requires a deed, owned land is protected
// from other players, owned plots pay passive rent, and claims persist across restarts.
//   run:  node test/land.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TILE, findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2609, URL = 'ws://localhost:' + PORT;
const FAST = { TREE_REGROW_MS:'300', FARM_GROW_MS:'400', SPAWN_PROTECT_MS:'200', LAND_INCOME_MS:'700' };

const hasClaim = (bot,x,y,owner) => bot.events.some(m => m.t==='claim' && m.x===x && m.y===y && (!owner||m.owner===owner));

// earn 50 coins (chop 25 wood -> sell) then buy a Land Deed
async function buyDeed(bot, T){
  await bot.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(bot, 25, T.tree);
  bot.send({ t:'shop', item:'sellwood' });
  await bot.waitUntil(b => b.self.coin>=50, 6000, 'coin>=50');
  bot.send({ t:'shop', item:'deed' });
  await bot.waitUntil(b => b.self.deeds>=1, 3000, 'deed bought');
}

async function main(){
  const T = findTiles();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-land-'));
  const guestA = 'land-owner-A', plot = T.grassBuild.x + ',' + T.grassBuild.y;
  let srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  // ===== claiming needs a (held, unused) deed =====
  console.log('\n[1] cannot claim land without a deed');
  const a = new Bot('Owner', URL); await a.connect({ guest: guestA });
  await a.moveTo(T.grassStand.x, T.grassStand.y);
  a.send({ t:'claim', x:T.grassBuild.x, y:T.grassBuild.y });
  await sleep(400);
  ok(!hasClaim(a, T.grassBuild.x, T.grassBuild.y), 'claim rejected with 0 deeds');

  // ===== buy a deed, then claim a plot =====
  console.log('\n[2] buy a Land Deed, then claim a plot');
  await buyDeed(a, T);
  ok(a.self.deeds >= 1, 'owns a Land Deed');
  await a.moveTo(T.grassStand.x, T.grassStand.y);
  a.send({ t:'claim', x:T.grassBuild.x, y:T.grassBuild.y });
  await a.waitFor(m => m.t==='claim' && m.x===T.grassBuild.x && m.y===T.grassBuild.y, 3000, 'claim broadcast');
  ok(hasClaim(a, T.grassBuild.x, T.grassBuild.y, guestA), 'plot is now owned by me');

  console.log('\n[3] cannot claim a 2nd plot with only 1 deed');
  a.send({ t:'claim', x:T.grassStand.x, y:T.grassStand.y });
  await sleep(400);
  ok(!hasClaim(a, T.grassStand.x, T.grassStand.y), '2nd claim rejected (no spare deed)');

  // ===== another player cannot build on my land =====
  console.log('\n[4] another player cannot build on my claimed land');
  const b = new Bot('Intruder', URL); await b.connect({ guest: 'intruder-B' });
  await b.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(b, 3, T.tree);                        // enough wood to afford a fence
  await b.moveTo(T.grassStand.x, T.grassStand.y);
  const woodBefore = b.self.wood;
  b.send({ t:'edit', kind:'build', bt:'fence', x:T.grassBuild.x, y:T.grassBuild.y });
  await sleep(400);
  ok(b.self.wood === woodBefore, 'intruder build on my land was rejected (wood unspent)');
  b.close(); await sleep(120);

  // ===== owned land pays passive rent =====
  console.log('\n[5] owned plots pay passive rent');
  const coin0 = a.self.coin;
  await a.waitUntil(b => b.self.coin > coin0, 4000, 'rent paid');
  const gained = a.self.coin - coin0;
  ok(gained > 0 && gained % 2 === 0, 'received rent (+'+gained+', multiple of 2/plot)');

  // ===== claims persist across a restart =====
  console.log('\n[6] claims persist across a restart');
  await sleep(300); a.close(); await sleep(250);
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);
  const c = new Bot('Owner', URL); const init2 = await c.connect({ guest: guestA });
  ok(init2.claims && init2.claims[plot] && init2.claims[plot].owner === guestA, 'my claim persisted across restart');
  c.close(); await sleep(120);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' LAND-OWNERSHIP CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
