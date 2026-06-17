// RUNELANDS — crafting tests.
// The wood/stone sink: refine wood→planks, then spend planks+stone on a Reinforced Pick,
// which is the ONLY way to raise mining yield. Outputs persist across a restart.
//   run:  node test/crafting.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, findStone, pathTiles, walkPath, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2625, URL = 'ws://localhost:' + PORT;
const FAST = { TREE_REGROW_MS:'400', STONE_REGROW_MS:'500', SPAWN_PROTECT_MS:'200' };

async function mineN(bot, stone, n){
  for(let i=0;i<n;i++){
    if(i>0) await bot.waitFor(m => m.t==='edit' && m.kind==='mineregrow' && m.x===stone.x && m.y===stone.y, 4000, 'rock regrow');
    const got = bot.waitFor(m => m.t==='edit' && m.kind==='mine' && m.x===stone.x && m.y===stone.y, 3000, 'mine');
    bot.send({ t:'edit', kind:'mine', x:stone.x, y:stone.y }); await got;
  }
}

async function main(){
  const TT = findTiles(), S = findStone();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-crafting-'));
  const guest = 'crafter-guest-1';
  let srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  console.log('\n[1] a fresh guest has no planks or pick level');
  const a = new Bot('Crafter', URL); await a.connect({ guest });
  ok(a.self.plank === 0 && a.self.up.pick === 0, 'starts with 0 planks, pick Lv0');

  console.log('\n[2] cannot craft a plank without wood');
  a.send({ t:'craft', item:'plank' }); await sleep(250);
  ok(a.self.plank === 0, 'plank craft rejected with 0 wood');

  console.log('\n[3] chop wood, then refine it into planks');
  await a.moveTo(TT.treeStand.x, TT.treeStand.y);
  await chopUntilWood(a, 12, TT.tree);
  for(let i=0;i<4;i++) a.send({ t:'craft', item:'plank' });
  await a.waitUntil(b => b.self.plank >= 4, 3000, '4 planks crafted');
  ok(a.self.plank === 4 && a.self.wood === 0, 'refined 12 wood → 4 planks');

  console.log('\n[4] mine the stone needed for the pick');
  await walkPath(a, pathTiles(TT.treeStand, S.stand));
  await mineN(a, S.stone, 3);                          // +2 each (pick Lv0) → 6 stone
  await a.waitUntil(b => b.self.stone >= 6, 2000, '6 stone mined');
  ok(a.self.stone === 6, 'mined 6 stone at +2/mine (pick Lv0)');

  console.log('\n[5] craft a Reinforced Pick (spends 4 planks + 6 stone)');
  a.send({ t:'craft', item:'pick' });
  await a.waitUntil(b => b.self.up.pick >= 1, 3000, 'pick upgraded');
  ok(a.self.up.pick === 1 && a.self.plank === 0 && a.self.stone === 0, 'pick → Lv1, materials consumed');

  console.log('\n[6] the upgraded pick mines more');
  await a.waitFor(m => m.t==='edit' && m.kind==='mineregrow' && m.x===S.stone.x && m.y===S.stone.y, 4000, 'rock regrow');
  const got = a.waitFor(m => m.t==='edit' && m.kind==='mine' && m.x===S.stone.x && m.y===S.stone.y, 3000, 'mine');
  a.send({ t:'edit', kind:'mine', x:S.stone.x, y:S.stone.y }); await got;
  await a.waitUntil(b => b.self.stone >= 3, 2000, 'mined with upgraded pick');
  ok(a.self.stone === 3, 'pick Lv1 mines +3 stone (2 + 1)');
  a.close(); await sleep(300);

  console.log('\n[7] pick level persists across a restart');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);
  const c = new Bot('Crafter', URL); await c.connect({ guest });
  ok(c.self.up.pick === 1, 'Reinforced Pick (Lv1) persisted across restart');
  c.close(); await sleep(150);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' CRAFTING CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
