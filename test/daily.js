// RUNELANDS — daily-reward tests.
// Server-authoritative daily: the cooldown is enforced server-side, a return-streak grows the
// payout (then resets after the grace window), and lastDaily + dailyStreak persist across a
// restart. Uses short cooldown/grace via env so the streak logic is fast + deterministic.
//   run:  node test/daily.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2619, URL = 'ws://localhost:' + PORT;
const FAST = { DAILY_COOLDOWN_MS:'200', DAILY_GRACE_MS:'700', SPAWN_PROTECT_MS:'200' };

async function main(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-daily-'));
  const guest = 'daily-guest-1';
  let srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  // ===== a fresh account starts with a Day-1 daily ready =====
  console.log('\n[1] fresh account has a daily ready (Day 1, base reward)');
  const a = new Bot('Daily', URL); await a.connect({ guest });
  ok(a.initMsg.daily && a.initMsg.daily.ready === true, 'daily is ready on first join');
  ok(a.initMsg.daily.nextStreak === 1 && a.initMsg.daily.reward === 15, 'Day 1 reward is 15');

  // ===== claiming pays out =====
  console.log('\n[2] claiming pays the reward');
  a.send({ t:'claimdaily' });
  await a.waitUntil(b => b.self.coin >= 15, 2000, 'reward paid');
  ok(a.self.coin === 15, 'received 15 coin (Day 1)');

  // ===== the cooldown is enforced =====
  console.log('\n[3] an immediate re-claim is a no-op (cooldown)');
  a.send({ t:'claimdaily' }); await sleep(120);
  ok(a.self.coin === 15, 'coin unchanged inside the cooldown');

  // ===== returning within grace grows the streak =====
  console.log('\n[4] returning within the grace window grows the streak');
  await sleep(300);                       // >200 cooldown, <700 grace since the Day-1 claim
  a.send({ t:'claimdaily' });
  await a.waitUntil(b => b.self.coin >= 35, 2000, 'Day 2 reward paid');
  ok(a.self.coin === 35, 'Day 2 paid 20 (streak bonus)');

  // ===== returning after grace resets the streak =====
  console.log('\n[5] returning after the grace window resets the streak');
  await sleep(800);                       // >700 grace since the Day-2 claim
  a.send({ t:'claimdaily' });
  await a.waitUntil(b => b.self.coin >= 50, 2000, 'reset reward paid');
  ok(a.self.coin === 50, 'streak reset → paid 15 again');
  a.close(); await sleep(300);            // disconnect → account saved

  // ===== lastDaily + streak persist across a restart =====
  console.log('\n[6] lastDaily + streak persist across a restart');
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: { ...FAST, DAILY_COOLDOWN_MS:'3600000' } }); // 1h cooldown on reboot
  await waitHealthy(URL);
  const c = new Bot('Daily', URL); await c.connect({ guest });
  ok(c.initMsg.daily && c.initMsg.daily.ready === false, 'recent claim persisted (not ready under a 1h cooldown)');
  ok(c.initMsg.daily.streak === 1, 'dailyStreak (1) persisted across restart');
  ok(c.self.coin === 50, 'coin balance persisted');
  c.close(); await sleep(150);

  // ===== a no-account guest has no daily =====
  console.log('\n[7] a no-account guest has no daily');
  const d = new Bot('Anon', URL); await d.connect();   // join without a guest id
  ok(d.initMsg.daily === null, 'no daily status without an account');
  d.send({ t:'claimdaily' }); await sleep(200);
  ok(d.self.coin === 0, 'claim is a no-op without an account');
  d.close(); await sleep(150);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' DAILY-REWARD CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
