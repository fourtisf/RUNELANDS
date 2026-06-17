// Plotlands — new-player survivability tests.
// Verifies the safe hub (no damage at spawn), spawn protection, and out-of-combat HP regen —
// the fixes that make the game actually playable for a fresh player.
//   run:  node test/survival.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TILE, W, H, Bot, ok, passCount, sleep, huntEnemy, startServer, waitHealthy } = require('./harness');

const PORT = 2607, URL = 'ws://localhost:' + PORT;
const HUB = { x: (Math.floor(W/2)+0.5)*TILE, y: (Math.floor(H/2)+0.5)*TILE };

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-surv-'));
  // fast timers + a small safe hub (SAFE_TILES=2) so enemies are right outside — keeps the
  // damage/regen checks quick and reliable (the mechanic is identical at any hub size).
  startServer({ port: PORT, dataDir, env: { SPAWN_PROTECT_MS:'300', REGEN_DELAY_MS:'600', SAFE_TILES:'2' } });
  await waitHealthy(URL);

  // ===== safe hub: no damage while standing at spawn, even with enemies around =====
  console.log('\n[1] safe hub: standing at spawn takes no damage');
  const a = new Bot('Surv', URL); await a.connect();
  ok(a.self.hp === 100, 'spawns at full HP');
  // hold position at the hub for a while
  for (let i=0;i<25;i++){ a.send({t:'input', x:Math.round(HUB.x), y:Math.round(HUB.y), dir:0}); await sleep(80); }
  ok(a.self.hp === 100, 'no HP lost after ~2s in the safe hub');

  // ===== leave the hub, take damage, then regen back in the hub =====
  console.log('\n[2] take damage outside the hub, then regen');
  // hunting an enemy walks us out of the hub; enemies chase back, so contact damage lands.
  ok(await huntEnemy(a, { until:b => b.self.hp < 100 }), 'lost HP after leaving the safe hub');

  console.log('\n[3] HP regenerates after returning to safety');
  await a.moveTo(Math.floor(HUB.x/TILE), Math.floor(HUB.y/TILE)); // walk back into the safe hub
  const low = a.self.hp;                                          // HP once safely home
  await a.waitUntil(b => b.self.hp > low, 6000, 'HP regenerates in the hub');
  ok(a.self.hp > low, 'HP regenerated out of combat (' + low + ' → ' + a.self.hp + ')');

  a.close(); await sleep(150);
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' SURVIVABILITY CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
