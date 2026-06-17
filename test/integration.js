// Plotlands — economy + combat integration tests (anti-cheat).
// Boots a real server child and drives ws bots to prove the SERVER is authoritative:
// resources, progression, and HP/combat live server-side and validate every action.
//   run:  node test/integration.js     (or: npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, chopUntilWood, huntEnemy, startServer, waitHealthy } = require('./harness');

const PORT = 2599, URL = 'ws://localhost:' + PORT;

async function main(){
  const TILES = findTiles();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-econ-'));
  startServer({ port: PORT, dataDir });
  await waitHealthy(URL);

  // ===== Phase 1: join handshake gives fresh, server-owned stats =====
  console.log('\n[1] join → authoritative self snapshot');
  const a = new Bot('Alfa', URL); await a.connect();
  ok(a.self && a.self.wood === 0 && a.self.coin === 0, 'fresh player starts wood=0 coin=0');
  ok(a.self.hp === 100 && a.self.hpMax === 100 && a.self.lv === 1, 'fresh player hp=100 lv=1');
  ok(a.initMsg.slimes.length > 0 && a.initMsg.slimes.every(s => ['slime','sprite','wisp','brute','golem'].includes(s.type) && s.hpMax > 0),
     'enemies carry a type + hpMax (slime/sprite/wisp/brute/golem)');

  // ===== Phase 2: chop is validated + awarded server-side =====
  console.log('\n[2] chop a tree → +3 wood, +8 xp (server award)');
  await a.moveTo(TILES.treeStand.x, TILES.treeStand.y);
  a.send({ t:'edit', kind:'chop', x:TILES.tree.x, y:TILES.tree.y });
  await a.waitUntil(b => b.self.wood===3, 4000, 'wood=3 after chop');
  ok(a.self.wood === 3, 'chop awarded +3 wood');
  ok(a.self.xp === 8, 'chop awarded +8 xp');

  console.log('\n[2b] chop the same (now chopped) tree again → no double award');
  a.send({ t:'edit', kind:'chop', x:TILES.tree.x, y:TILES.tree.y });
  await sleep(300);
  ok(a.self.wood === 3, 'already-chopped tree gives no extra wood');

  console.log('\n[2c] chop a non-tree tile → rejected');
  a.send({ t:'edit', kind:'chop', x:TILES.grassStand.x, y:TILES.grassStand.y });
  await sleep(300);
  ok(a.self.wood === 3, 'chopping non-forest tile awards nothing');

  // ===== Phase 3: build spends wood, enforces cost, rejects when broke / occupied / far =====
  console.log('\n[3] build fence (cost 2) → wood 3→1, building broadcast');
  await a.moveTo(TILES.grassStand.x, TILES.grassStand.y);
  const fenceEdit = a.waitFor(m => m.t==='edit' && m.kind==='build' && m.x===TILES.grassBuild.x && m.y===TILES.grassBuild.y, 4000, 'fence edit broadcast');
  a.send({ t:'edit', kind:'build', bt:'fence', x:TILES.grassBuild.x, y:TILES.grassBuild.y });
  await fenceEdit; await a.waitUntil(b => b.self.wood===1, 4000, 'wood=1 after fence');
  ok(a.self.wood === 1, 'fence deducted 2 wood (3→1)');

  console.log('\n[3b] build house (cost 8) with only 1 wood → rejected');
  a.send({ t:'edit', kind:'build', bt:'house', x:TILES.grassStand.x, y:TILES.grassStand.y });
  await sleep(300);
  ok(a.self.wood === 1, 'cannot afford house → wood unchanged');

  console.log('\n[3c] build on an occupied tile → rejected');
  const before = a.self.wood;
  a.send({ t:'edit', kind:'build', bt:'fence', x:TILES.grassBuild.x, y:TILES.grassBuild.y });
  await sleep(300);
  ok(a.self.wood === before, 'cannot build on occupied tile');

  console.log('\n[3d] build out of range (far tile) → rejected');
  a.send({ t:'edit', kind:'build', bt:'fence', x:2, y:2 });
  await sleep(300);
  ok(a.self.wood === before, 'out-of-range build rejected');

  // ===== Phase 4: farm plant + grow + harvest, timed by the server =====
  console.log('\n[4] farm: top up wood (retry through regrow), then plant (cost 3)');
  await a.moveTo(TILES.treeStand.x, TILES.treeStand.y);
  await chopUntilWood(a, 4, TILES.tree); // 1 carried over + a regrown chop → >=4
  await a.moveTo(TILES.grassStand.x, TILES.grassStand.y);
  const woodBeforePlant = a.self.wood;
  a.send({ t:'edit', kind:'farm', x:TILES.grassStand.x, y:TILES.grassStand.y });
  await a.waitUntil(b => b.self.wood===woodBeforePlant-3, 4000, 'plant cost 3 wood');
  ok(a.self.wood === woodBeforePlant-3, 'planting deducted 3 wood');

  console.log('\n[4b] harvest before grown → rejected; after grow → +4 coin');
  a.send({ t:'edit', kind:'harvest', x:TILES.grassStand.x, y:TILES.grassStand.y });
  await sleep(150);
  ok(a.self.coin === 0, 'cannot harvest an unripe farm');
  await sleep(500); // FARM_GROW_MS=400 in tests
  a.send({ t:'edit', kind:'harvest', x:TILES.grassStand.x, y:TILES.grassStand.y });
  await a.waitUntil(b => b.self.coin===4, 4000, 'coin=4 after harvest');
  ok(a.self.coin === 4, 'ripe harvest awarded +4 coin');

  // ===== Phase 5: combat — enemies are server-simulated; kills award the killer =====
  console.log('\n[5] kill a basic slime → +5 coin to the killer');
  const coinBefore = a.self.coin;
  await killOneSlime(a, 'slime'); // target a basic slime (reward varies by enemy type)
  ok(a.self.coin === coinBefore+5, 'basic-slime kill awarded +5 coin (server)');

  // ===== Phase 6: merchant economy is server-side =====
  console.log('\n[6] merchant: sell wood');
  await a.moveTo(TILES.treeStand.x, TILES.treeStand.y);
  await chopUntilWood(a, a.self.wood+3, TILES.tree);
  const coinPreSell = a.self.coin, woodPreSell = a.self.wood;
  a.send({ t:'shop', item:'sellwood' });
  await a.waitUntil(b => b.self.wood===0, 4000, 'wood sold to 0');
  ok(a.self.coin === coinPreSell + woodPreSell*2, 'sell wood gave 2 coin each');
  ok(a.self.wood === 0, 'wood is 0 after selling all');

  console.log('\n[6b] land deed requires 50 coin (rejected when broke)');
  const coinNow = a.self.coin;
  if (coinNow < 50) { a.send({ t:'shop', item:'deed' }); await sleep(250); ok(a.self.deeds===0 && a.self.coin===coinNow, 'deed rejected without 50 coin'); }
  else { console.log('  (skipped: bot already has >=50 coin)'); }

  // ===== Phase 7: combat damage is server-authoritative =====
  console.log('\n[7] standing in slimes drains HP server-side');
  await takeDamage(a);
  ok(a.self.hp < 100, 'slime contact reduced HP on the server');

  a.close(); await sleep(150);
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' ECONOMY/COMBAT CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

// kill one enemy (optionally of a given type) — coin reflects the kill
async function killOneSlime(bot, type){
  const start = bot.self.coin;
  if (!await huntEnemy(bot, { attack:true, type, until:b => b.self.coin >= start+5 }))
    throw new Error('could not kill a ' + (type||'enemy') + ' in time');
}

// take contact damage by hunting enemies (walks us out of the safe hub on the way)
async function takeDamage(bot){
  if (!await huntEnemy(bot, { until:b => b.self.hp < 100 }))
    throw new Error('never took contact damage');
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
