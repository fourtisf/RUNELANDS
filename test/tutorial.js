// Plotlands — onboarding completion-reward tests.
// The tutorial reward is granted SERVER-side exactly once per account: the first
// {tutdone} pays out, repeats are no-ops (un-farmable), and the "claimed" flag
// persists across a restart. Guests with progress-saving off get nothing.
//   run:  node test/tutorial.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2617, URL = 'ws://localhost:' + PORT;
const REWARD = 25;
const ENV = { TUTORIAL_REWARD: String(REWARD), SPAWN_PROTECT_MS: '200' };

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-tut-'));
  const guest = 'tutorial-guest-1';
  let srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);

  // ===== first completion pays the reward =====
  console.log('\n[1] first tutdone grants the reward');
  const a = new Bot('Newbie', URL); await a.connect({ guest });
  ok(a.self.coin === 0, 'new guest starts with 0 coin');
  a.send({ t:'tutdone' });
  await a.waitUntil(b => b.self.coin >= REWARD, 3000, 'reward granted');
  ok(a.self.coin === REWARD, 'received exactly ' + REWARD + ' coin');

  // ===== a repeat is a no-op (un-farmable) =====
  console.log('\n[2] a repeated tutdone grants nothing');
  a.send({ t:'tutdone' });
  await sleep(400);
  ok(a.self.coin === REWARD, 'coin unchanged after a 2nd tutdone');
  a.close(); await sleep(300);   // disconnect → account (incl. tut flag) is saved

  // ===== the claimed flag persists across a restart =====
  console.log('\n[3] reward stays claimed across a restart');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: ENV });
  await waitHealthy(URL);
  const c = new Bot('Newbie', URL); await c.connect({ guest });
  ok(c.self.coin === REWARD, 'coin (' + REWARD + ') persisted across restart');
  c.send({ t:'tutdone' });
  await sleep(400);
  ok(c.self.coin === REWARD, 'no second reward after restart (flag persisted)');
  c.close(); await sleep(150);

  // ===== a guest with no account (progress-saving off) cannot claim =====
  console.log('\n[4] a no-account guest gets no reward');
  const d = new Bot('Anon', URL); await d.connect();   // join without a guest id
  d.send({ t:'tutdone' });
  await sleep(400);
  ok(d.self.coin === 0, 'no reward without an account');
  d.close(); await sleep(150);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' ONBOARDING-REWARD CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
