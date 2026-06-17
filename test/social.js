// Plotlands — social tests: leaderboard ranking + /pay peer transfer.
//   run:  node test/social.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTiles, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2615, URL = 'ws://localhost:' + PORT;
const FAST = { TREE_REGROW_MS:'250', SPAWN_PROTECT_MS:'200' };

async function earn(bot, T, n){
  await bot.moveTo(T.treeStand.x, T.treeStand.y);
  await chopUntilWood(bot, Math.ceil(n/2), T.tree);
  bot.send({ t:'shop', item:'sellwood' });
  await bot.waitUntil(b => b.self.coin>=n, 8000, 'coin>='+n);
}

async function main(){
  const T = findTiles();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'isle-social-'));
  const srv = startServer({ port: PORT, dataDir, env: FAST });
  await waitHealthy(URL);

  console.log('\n[1] leaderboard ranks the richer player higher');
  const rich = new Bot('Rich', URL); await rich.connect({ guest:'g-rich' });
  const poor = new Bot('Poor', URL); await poor.connect({ guest:'g-poor' });
  await earn(rich, T, 40);
  rich.send({ t:'leaderboard' });
  const lb = await rich.waitFor(m => m.t==='leaderboard', 3000, 'leaderboard reply');
  const names = lb.rows.map(r => r.name);
  ok(names.includes('Rich') && names.includes('Poor'), 'both players appear on the leaderboard');
  ok(names.indexOf('Rich') < names.indexOf('Poor'), 'Rich is ranked above Poor');
  ok(lb.rows[0].name === 'Rich' && lb.rows[0].score >= 40, 'Rich is #1 with the higher score');

  console.log('\n[2] /pay transfers coins to a nearby player');
  // stand both players on the same tile
  await rich.moveTo(T.grassStand.x, T.grassStand.y);
  await poor.moveTo(T.grassStand.x, T.grassStand.y);
  await sleep(200);
  const richBefore = rich.self.coin, poorBefore = poor.self.coin;
  rich.send({ t:'chat', msg:'/pay 10' });
  await poor.waitUntil(b => b.self.coin === poorBefore + 10, 3000, 'poor received 10');
  ok(poor.self.coin === poorBefore + 10, 'recipient gained 10 coin');
  ok(rich.self.coin === richBefore - 10, 'sender lost 10 coin');

  console.log('\n[3] /pay more than you have is rejected');
  const rb = rich.self.coin;
  rich.send({ t:'chat', msg:'/pay 999999' });
  await sleep(300);
  ok(rich.self.coin === rb, 'overpay rejected (balance unchanged)');

  rich.close(); poor.close(); await sleep(150);
  srv.kill(); await sleep(300); // let the graceful shutdown finish writing before we delete
  try{ fs.rmSync(dataDir, { recursive:true, force:true }); }catch(e){ /* OS will reap /tmp */ }
  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' SOCIAL CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
