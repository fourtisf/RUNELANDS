// Plotlands — scheduled world-event (Horde) test.
// On a timer (while players are online) the server spawns a coordinated surge of tougher
// monsters and announces it in chat. Deterministic: it's a timer + broadcast, not combat.
//   run:  node test/event.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2629, URL = 'ws://localhost:' + PORT;

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-event-'));
  // short horde interval so the event fires quickly; long boss interval so it doesn't interfere
  let srv = startServer({ port: PORT, dataDir, env: { HORDE_INTERVAL_MS:'1500', BOSS_INTERVAL_MS:'999999', SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL);

  console.log('\n[1] a scheduled horde event fires + announces');
  const a = new Bot('Watcher', URL); await a.connect({ guest: 'event-1' });
  const before = a.initMsg.slimes.length;
  const ann = await a.waitFor(m => m.t==='chat' && m.name==='👹 EVENT', 6000, 'horde announcement');
  ok(/horde/i.test(ann.msg), 'horde event announced in chat');

  console.log('\n[2] the horde adds enemies to the world');
  await a.waitUntil(b => b.state && b.state.slimes.length >= before + 4, 3000, 'enemy surge');
  ok(a.state.slimes.length >= before + 4, 'horde spawned a wave of enemies (' + before + ' → ' + a.state.slimes.length + ')');
  a.close(); await sleep(150);

  srv.kill(); await sleep(300);   // let the graceful-shutdown flush finish before removing the dir
  fs.rmSync(dataDir, { recursive:true, force:true, maxRetries:5, retryDelay:80 });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' WORLD-EVENT CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
