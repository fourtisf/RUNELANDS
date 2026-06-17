// RUNELANDS — anti-grief tests.
// Two protections so nobody can spam structures or wall off / land-grab the spawn:
//   (1) a per-player building cap, and
//   (2) a protected no-build ring around spawn (NOBUILD_TILES) — build/claim refused inside it.
//   run:  node test/antigrief.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { W, H, T, tileAt, walkableTile, findTiles, pathTiles, walkPath, Bot, ok, passCount, sleep, chopUntilWood, startServer, waitHealthy } = require('./harness');

const PORT = 2627, URL = 'ws://localhost:' + PORT;

function buildFence(bot, x, y){   // resolves true if the server accepted the build (broadcast), else false
  const got = bot.waitFor(m => m.t==='edit' && m.kind==='build' && m.x===x && m.y===y, 2500, 'build').then(() => true, () => false);
  bot.send({ t:'edit', kind:'build', bt:'fence', x, y });
  return got;
}
// a grass tile safely OUTSIDE the 6-tile ring, with an adjacent walkable tile to stand on
function outsideRing(){
  const cx=Math.floor(W/2), cy=Math.floor(H/2), N=[[1,0],[-1,0],[0,1],[0,-1]], cand=[];
  for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){ const d=Math.hypot(x-cx,y-cy);
    if(d>6.6 && d<10 && tileAt(x,y)===T.GRASS){ for(const [dx,dy] of N) if(walkableTile(x+dx,y+dy)){ cand.push({build:{x,y},stand:{x:x+dx,y:y+dy},d}); break; } } }
  cand.sort((a,b)=>a.d-b.d); if(!cand.length) throw new Error('no out-of-ring grass tile found'); return cand[0];
}

async function main(){
  const TT = findTiles();
  const gb = TT.grassBuild, gs = TT.grassStand;
  const b2 = { x: gs.x-1, y: gs.y }, b3 = { x: gs.x, y: gs.y+1 };   // more grass adjacent to spawn (cleared core)

  // ===== (1) per-player building cap (ring disabled so we can build near spawn) =====
  console.log('\n[1] per-player building cap');
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-grief-a-'));
  let srv = startServer({ port: PORT, dataDir: dirA, env: { NOBUILD_TILES:'0', MAX_BUILDINGS:'2', TREE_REGROW_MS:'300', SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL);
  const a = new Bot('Builder', URL); await a.connect({ guest: 'grief-a' });
  await a.moveTo(TT.treeStand.x, TT.treeStand.y);
  await chopUntilWood(a, 6, TT.tree);
  await a.moveTo(gs.x, gs.y);
  ok(await buildFence(a, gb.x, gb.y), 'fence #1 built');
  ok(await buildFence(a, b2.x, b2.y), 'fence #2 built (reaches the cap of 2)');
  await a.waitUntil(b => b.self.wood <= 2, 2000, 'wood spent on 2 fences');
  const woodAt = a.self.wood;
  ok(!(await buildFence(a, b3.x, b3.y)), 'fence #3 rejected by the cap');
  await sleep(150);
  ok(a.self.wood === woodAt, 'the capped build spent no wood');
  a.close(); await sleep(150); srv.kill(); await sleep(350);
  fs.rmSync(dirA, { recursive:true, force:true });

  // ===== (2) protected spawn ring (build refused inside; allowed just outside) =====
  console.log('\n[2] protected spawn ring');
  const R = outsideRing();
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'isle-grief-b-'));
  srv = startServer({ port: PORT, dataDir: dirB, env: { NOBUILD_TILES:'6', TREE_REGROW_MS:'300', SPAWN_PROTECT_MS:'200' } });
  await waitHealthy(URL);
  const b = new Bot('Builder', URL); await b.connect({ guest: 'grief-b' });
  await b.moveTo(TT.treeStand.x, TT.treeStand.y);
  await chopUntilWood(b, 4, TT.tree);
  await b.moveTo(gs.x, gs.y);
  const w0 = b.self.wood;
  ok(!(await buildFence(b, gb.x, gb.y)), 'build inside the spawn ring is rejected');
  await sleep(150);
  ok(b.self.wood === w0, 'the rejected ring build spent no wood');
  await walkPath(b, pathTiles(gs, R.stand));                       // step just outside the ring
  ok(await buildFence(b, R.build.x, R.build.y), 'building just outside the ring works');
  b.close(); await sleep(150); srv.kill(); await sleep(200);
  fs.rmSync(dirB, { recursive:true, force:true });

  console.log('\n========================================');
  console.log('ALL ' + passCount() + ' ANTI-GRIEF CHECKS PASSED ✓');
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
