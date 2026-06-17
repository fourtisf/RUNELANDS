// RUNELANDS — fishing tests.
// 🎣 Fishing is a slower, water-side resource: cast at adjacent water for fish, gated by a
// per-player rod cooldown, only at water tiles, sellable at the merchant, and persisted.
//   run:  node test/fishing.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TILE, findWater, pathTiles, walkPath, Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2623, URL = 'ws://localhost:' + PORT;
const ENV = { FISH_COOLDOWN_MS:'400', SPAWN_PROTECT_MS:'200' };

async function main(){
  const { water, stand } = findWater();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-fishing-'));
  const guest = 'angler-guest-1';
  let srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);

  console.log('\n[1] a fresh guest has no fish');
  const a = new Bot('Angler', URL); await a.connect({ guest });
  ok(a.self.fish === 0, 'new guest starts with 0 fish');

  // walk from the spawn to the shore (BFS path — the coast is far + past obstacles)
  const sp = { x: Math.floor(a.initMsg.self.tp.x / TILE), y: Math.floor(a.initMsg.self.tp.y / TILE) };
  const route = pathTiles(sp, stand);
  ok(route && route.length > 0, 'found a walkable route to the shore (' + route.length + ' tiles)');
  await walkPath(a, route);

  console.log('\n[2] casting at water catches a fish');
  a.send({ t:'fish', x:water.x, y:water.y });
  await a.waitUntil(b => b.self.fish >= 1, 3000, 'fish caught');
  ok(a.self.fish === 1, 'cast caught +1 fish');

  console.log('\n[3] the rod cooldown rate-limits casts');
  a.send({ t:'fish', x:water.x, y:water.y }); await sleep(150);  // < 400ms cooldown
  ok(a.self.fish === 1, 'a too-soon cast caught nothing');

  console.log('\n[4] you cannot fish on land');
  await sleep(500);                                              // let the cooldown lapse
  a.send({ t:'fish', x:stand.x, y:stand.y }); await sleep(200);  // stand tile is land, not water
  ok(a.self.fish === 1, 'casting at a land tile caught nothing');

  console.log('\n[5] casting at water after the cooldown catches again');
  a.send({ t:'fish', x:water.x, y:water.y });
  await a.waitUntil(b => b.self.fish >= 2, 3000, 'second fish caught');
  ok(a.self.fish === 2, 'second valid cast caught +1 fish');

  console.log('\n[5b] eating a fish consumes it and grants XP');
  const xp0 = a.self.xp, lv0 = a.self.lv;
  a.send({ t:'eat' });
  await a.waitUntil(b => b.self.fish === 1, 2000, 'fish eaten');
  ok(a.self.fish === 1, 'eating consumed one fish (2 → 1)');
  ok(a.self.lv > lv0 || a.self.xp > xp0, 'eating a fish granted XP');
  a.close(); await sleep(300);

  console.log('\n[6] fish persists across a restart');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);
  const c = new Bot('Angler', URL); await c.connect({ guest });
  ok(c.self.fish === 1, 'fish balance (1) persisted across restart');

  console.log('\n[7] fish sells at the merchant');
  const coin0 = c.self.coin;
  c.send({ t:'shop', item:'sellfish' });
  await c.waitUntil(b => b.self.coin > coin0, 2000, 'fish sold');
  ok(c.self.coin === coin0 + 1*4 && c.self.fish === 0, 'sold 1 fish for 4 coin (4 each)');
  c.close(); await sleep(150);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' FISHING CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
