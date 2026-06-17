// Plotlands — persistence tests.
// Proves that world edits and per-guest progress survive a full server restart
// (file backend), that returning players are restored, and that guests are isolated.
//   run:  node test/persistence.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TILE, center, findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');
const { FileStore } = require('../store');

const PORT = 2601, URL = 'ws://localhost:' + PORT;

async function main(){
  const TILES = findTiles();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-persist-'));
  const guest = 'guest-abc-123';
  const bkey = TILES.grassBuild.x + ',' + TILES.grassBuild.y;

  // ===== session 1: a new guest earns progress + builds, then disconnects =====
  console.log('\n[1] session 1: new guest earns progress and builds');
  let srv = startServer({ port: PORT, dataDir });
  await waitHealthy(URL);
  const b = new Bot('Beta', URL); await b.connect({ guest });
  ok(b.self.wood === 0 && b.self.lv === 1, 'new guest starts fresh (wood=0, lv=1)');

  await b.moveTo(TILES.treeStand.x, TILES.treeStand.y);
  await chopUntilWood(b, 3, TILES.tree);
  await b.moveTo(TILES.grassStand.x, TILES.grassStand.y);
  const built = b.waitFor(m => m.t==='edit' && m.kind==='build' && m.x===TILES.grassBuild.x && m.y===TILES.grassBuild.y, 4000, 'beta built fence');
  b.send({ t:'edit', kind:'build', bt:'fence', x:TILES.grassBuild.x, y:TILES.grassBuild.y });
  await built; await sleep(200); // let the post-build `self` (wood deduction) settle
  const savedWood = b.self.wood, savedLv = b.self.lv, savedXp = b.self.xp;
  console.log('    saved: wood=' + savedWood + ' lv=' + savedLv + ' xp=' + savedXp);
  ok(savedWood > 0 || savedXp > 0, 'beta accrued some progress to persist');
  b.close(); await sleep(250); // disconnect → account is saved

  // ===== restart the server (graceful SIGTERM), same data dir =====
  console.log('\n[2] restart server on the same data dir');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir });
  await waitHealthy(URL);

  // ===== session 2: same guest → world + progress restored =====
  console.log('\n[3] session 2: same guest reconnects → restored');
  const c = new Bot('Beta', URL); const init2 = await c.connect({ guest });
  ok(init2.buildings && init2.buildings[bkey], 'building persisted across restart');
  ok(c.self.wood === savedWood, 'guest wood (' + savedWood + ') persisted');
  ok(c.self.lv === savedLv && c.self.xp === savedXp, 'guest level/xp persisted');
  const standCenter = center(TILES.grassStand.x, TILES.grassStand.y);
  ok(init2.self.tp && Math.abs(init2.self.tp.x - standCenter.x) <= TILE && Math.abs(init2.self.tp.y - standCenter.y) <= TILE,
     'guest position restored (returns where they left off)');
  c.close(); await sleep(150);

  // ===== a different guest id starts fresh (account isolation) =====
  console.log('\n[4] a different guest id is isolated (starts fresh)');
  const d = new Bot('Gamma', URL); await d.connect({ guest: 'someone-else-999' });
  ok(d.self.wood === 0 && d.self.lv === 1, 'a different guest id starts fresh');
  d.close(); await sleep(150);

  // ===== claim level round-trips through the store layer (regression: house upgrades must persist) =====
  console.log('\n[5] claim level persists through the store backend');
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-claimlv-'));
  const cs = new FileStore({ dataDir: cdir, flushMs: 5 }); await cs.init();
  cs.saveClaim('10,10', 'owner-x', 'Xavier', 4); await cs.flush();
  const cs2 = new FileStore({ dataDir: cdir }); await cs2.init();
  const cw = await cs2.loadWorld();
  ok(cw.claims['10,10'] && cw.claims['10,10'].level === 4, 'upgraded house level (4) persisted');
  ok(cw.claims['10,10'].owner === 'owner-x', 'claim owner persisted alongside level');
  fs.rmSync(cdir, { recursive:true, force:true });

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' PERSISTENCE CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
