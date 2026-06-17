// RUNELANDS — world event (boss) tests.
// Verifies the Warlord boss spawns while people are online, is announced in chat, and is the
// tanky high-value enemy it should be.
//   run:  node test/boss.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2613, URL = 'ws://localhost:' + PORT;

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-boss-'));
  const srv = startServer({ port: PORT, dataDir, env: { BOSS_INTERVAL_MS:'500' } });
  await waitHealthy(URL);

  console.log('\n[1] a Warlord boss spawns while a player is online');
  const a = new Bot('Hero', URL); await a.connect();
  let boss = null;
  for (let i=0;i<40 && !boss;i++){ await sleep(100); boss = (a.state && a.state.slimes || []).find(s => s.type==='boss'); }
  ok(!!boss, 'a boss appeared in the world');
  ok(boss.hpMax === 360, 'boss is a 360 HP tank (worth hunting)');

  console.log('\n[2] the boss arrival is announced in chat');
  const announced = a.events.some(m => m.t==='chat' && /Warlord/i.test(m.msg||''));
  ok(announced, 'a chat event announced the Warlord');

  console.log('\n[3] only one boss at a time');
  await sleep(700); // another interval tick passed
  const bosses = (a.state && a.state.slimes || []).filter(s => s.type==='boss').length;
  ok(bosses === 1, 'still exactly one boss (no duplicates while one is alive)');

  a.close(); await sleep(120);
  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' BOSS CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
