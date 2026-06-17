// RUNELANDS — mining tests.
// ⛏️ Mining gives the big map a purpose + a second resource: mine rock for stone, the
// depleted tile can't be re-mined until it regrows, stone sells at the merchant, and the
// stone balance persists across a restart.
//   run:  node test/mining.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findStone, Bot, ok, passCount, sleep, startServer, waitHealthy } = require('./harness');

const PORT = 2621, URL = 'ws://localhost:' + PORT;
const FAST = { STONE_REGROW_MS:'700', SPAWN_PROTECT_MS:'200' };

async function mineOnce(bot, stone){
  const got = bot.waitFor(m => m.t==='edit' && m.kind==='mine' && m.x===stone.x && m.y===stone.y, 3000, 'mine broadcast');
  bot.send({ t:'edit', kind:'mine', x:stone.x, y:stone.y });
  await got;
}

async function main(){
  const { stone, stand } = findStone();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-mining-'));
  const guest = 'miner-guest-1';
  let srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  console.log('\n[1] a fresh guest has no stone');
  const a = new Bot('Miner', URL); await a.connect({ guest });
  ok(a.self.stone === 0, 'new guest starts with 0 stone');

  console.log('\n[2] mining a rock awards stone');
  await a.moveTo(stand.x, stand.y);
  await mineOnce(a, stone);
  await a.waitUntil(b => b.self.stone >= 2, 2000, 'stone awarded');
  ok(a.self.stone === 2, 'mining a rock gave +2 stone');

  console.log('\n[3] a depleted rock cannot be re-mined until it regrows');
  a.send({ t:'edit', kind:'mine', x:stone.x, y:stone.y }); await sleep(300);
  ok(a.self.stone === 2, 'no extra stone from a depleted rock');

  console.log('\n[4] the rock regrows and can be mined again');
  await a.waitFor(m => m.t==='edit' && m.kind==='mineregrow' && m.x===stone.x && m.y===stone.y, 4000, 'rock regrew');
  await mineOnce(a, stone);
  await a.waitUntil(b => b.self.stone >= 4, 2000, 're-mined after regrow');
  ok(a.self.stone === 4, 'rock mined again after regrowing');

  console.log('\n[5] stone persists across a restart');
  a.close(); await sleep(300);
  srv.kill(); await sleep(450);
  srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);
  const c = new Bot('Miner', URL); await c.connect({ guest });
  ok(c.self.stone === 4, 'stone balance (4) persisted across restart');

  console.log('\n[6] stone sells at the merchant');
  const coin0 = c.self.coin;
  c.send({ t:'shop', item:'sellstone' });
  await c.waitUntil(b => b.self.coin > coin0, 2000, 'stone sold');
  ok(c.self.coin === coin0 + 4*3 && c.self.stone === 0, 'sold 4 stone for 12 coin (3 each)');
  c.close(); await sleep(150);

  srv.kill();
  fs.rmSync(dataDir, { recursive:true, force:true });
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' MINING CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
