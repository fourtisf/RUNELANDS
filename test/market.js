// Plotlands — player land-market tests.
// Owners list a plot for coins (/sell); a buyer standing on it pays (/buy) and ownership +
// the deed transfer. Crucially the seller is credited even when OFFLINE. State persists.
//   run:  node test/market.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2631, URL = 'ws://localhost:' + PORT;
// no rent (so coin math is clean), fast trees
const ENV = { LAND_INCOME_MS:'999999', TREE_REGROW_MS:'300', SPAWN_PROTECT_MS:'200' };

const lastClaim = (bot,x,y) => [...bot.events].reverse().find(m => m.t==='claim' && m.x===x && m.y===y);

// earn 50 coins → buy a Land Deed (mirrors the land test)
async function buyDeed(bot, T){
  await bot.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(bot, 25, T.tree);
  bot.send({ t:'shop', item:'sellwood' });
  await bot.waitUntil(b => b.self.coin>=50, 6000, 'coin>=50');
  bot.send({ t:'shop', item:'deed' });
  await bot.waitUntil(b => b.self.deeds>=1, 3000, 'deed bought');
}

async function main(){
  const T = findTiles(), gb = T.grassBuild;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-market-'));
  const guestA = 'seller-A', guestB = 'buyer-B';
  let srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);

  // ===== seller claims a plot and lists it =====
  console.log('\n[1] seller claims a plot, then lists it for sale');
  const a = new Bot('Seller', URL); await a.connect({ guest: guestA });
  await buyDeed(a, T);
  await a.moveTo(T.grassStand.x, T.grassStand.y);
  a.send({ t:'claim', x:gb.x, y:gb.y });
  await a.waitFor(m => m.t==='claim' && m.x===gb.x && m.y===gb.y && m.owner===guestA, 3000, 'claimed');
  await a.moveTo(gb.x, gb.y);                              // stand on the plot to list it
  a.send({ t:'chat', msg:'/sell 30' });
  await a.waitFor(m => m.t==='claim' && m.x===gb.x && m.y===gb.y && m.price===30, 3000, 'listed');
  ok(lastClaim(a,gb.x,gb.y).price === 30, 'plot listed for 30 coin');
  const aCoinListed = a.self.coin, aDeeds = a.self.deeds;   // coin 0, deeds 1

  // ===== buyer earns coins; seller goes OFFLINE before the sale =====
  console.log('\n[2] buyer earns coins; seller disconnects');
  const b = new Bot('Buyer', URL); await b.connect({ guest: guestB });
  await b.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(b, 15, T.tree);
  b.send({ t:'shop', item:'sellwood' });
  await b.waitUntil(x => x.self.coin>=30, 6000, 'buyer has 30 coin');
  a.close(); await sleep(300);                             // seller offline (account saved)

  // ===== buyer stands on the plot and buys it =====
  console.log('\n[3] buyer purchases the listed plot');
  await b.moveTo(gb.x, gb.y);
  const bCoin0 = b.self.coin;
  b.send({ t:'chat', msg:'/buy' });
  await b.waitFor(m => m.t==='claim' && m.x===gb.x && m.y===gb.y && m.owner===guestB, 3000, 'ownership transferred');
  await b.waitUntil(x => x.self.deeds>=1, 2000, 'buyer got the deed');
  ok(b.self.coin === bCoin0 - 30, 'buyer paid 30 coin');
  ok(b.self.deeds === 1, 'the deed transferred to the buyer');
  ok(lastClaim(b,gb.x,gb.y).price === 0, 'plot is no longer listed after sale');

  // ===== the OFFLINE seller was credited =====
  console.log('\n[4] the offline seller was paid + lost the deed');
  const a2 = new Bot('Seller', URL); await a2.connect({ guest: guestA });
  ok(a2.self.coin === aCoinListed + 30, 'offline seller received 30 coin (' + aCoinListed + ' → ' + a2.self.coin + ')');
  ok(a2.self.deeds === aDeeds - 1, 'offline seller lost the deed that moved with the plot');
  a2.close(); b.close(); await sleep(300);

  // ===== ownership persists across a restart =====
  console.log('\n[5] new ownership persists across a restart');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);
  const c = new Bot('Buyer', URL); const init = await c.connect({ guest: guestB });
  const plot = gb.x + ',' + gb.y;
  ok(init.claims && init.claims[plot] && init.claims[plot].owner === guestB, 'buyer still owns the plot after restart');
  ok(init.claims[plot].price === 0, 'the plot is unlisted after restart');
  c.close(); await sleep(150);

  srv.kill(); await sleep(200);
  fs.rmSync(dataDir, { recursive:true, force:true, maxRetries:5, retryDelay:80 });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' LAND-MARKET CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
